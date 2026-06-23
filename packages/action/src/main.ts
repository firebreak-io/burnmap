import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { S3Client } from '@aws-sdk/client-s3';
import type { RawPlan } from '@burnmap/parser';
import { parsePlan } from '@burnmap/parser';
import { resolveWebDist, writeShotHtml, cleanupShotHtml, capture } from '@burnmap/shoot';
import { archToPng } from '@burnmap/graph';
import type { ArchMeta } from '@burnmap/graph';
import { uploadAndPresign } from './s3.js';
import { upsertStickyComment } from './github.js';
import type { ChangeModel } from '@burnmap/parser';
import { renderPlanImage } from './run.js';
import { renderArchImage } from './arch-run.js';
import { commentMarker, buildCommentBody, buildMultiCommentBody, type MultiCommentItem } from './comment.js';
import { archCommentMarker, buildArchCommentBody, buildArchMultiCommentBody } from './arch-comment.js';
import { resolvePlans, planSlug } from './plans.js';

async function main(): Promise<void> {
  const planJsonPath = core.getInput('plan-json', { required: true });
  const bucket = core.getInput('s3-bucket', { required: true });
  const region = core.getInput('aws-region') || process.env.AWS_REGION || 'us-west-2';
  const ttlSeconds = Number(core.getInput('url-ttl-seconds') || '86400');
  // S3 SigV4 presigned URLs cap at 7 days (604800s); reject NaN / out-of-range early.
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 604800) {
    core.setFailed('url-ttl-seconds must be an integer between 1 and 604800 (S3 presigned-URL max is 7 days)');
    return;
  }
  const token = core.getInput('github-token', { required: true });
  const webDist = core.getInput('web-dist') || resolveWebDist();

  const mode = (core.getInput('mode') || 'plan').toLowerCase();
  if (!['plan', 'arch', 'both'].includes(mode)) {
    core.setFailed(`mode must be one of plan | arch | both (got "${mode}")`);
    return;
  }

  // Optional long-lived credentials used ONLY to presign the GET URL. The
  // upload keeps using the ambient (OIDC) creds; presigning with static creds
  // lets the URL stay valid up to 7 days so GitHub's Camo proxy can cache the
  // image before it expires. Both must be set together, or neither.
  const presignKeyId = core.getInput('presign-access-key-id');
  const presignSecret = core.getInput('presign-secret-access-key');
  if (Boolean(presignKeyId) !== Boolean(presignSecret)) {
    core.setFailed('presign-access-key-id and presign-secret-access-key must be set together');
    return;
  }
  if (presignKeyId) {
    // Mask both so neither leaks into (potentially public) Actions logs via an
    // AWS SDK error or debug output that echoes the credentials.
    core.setSecret(presignKeyId);
    core.setSecret(presignSecret);
  }

  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) {
    core.setFailed('burnmap must run on a pull_request event (no PR number in context)');
    return;
  }
  const { owner, repo } = context.repo;
  const sha = context.payload.pull_request?.head?.sha ?? context.sha;

  const s3 = new S3Client({ region });
  const presignS3 = presignKeyId
    ? new S3Client({ region, credentials: { accessKeyId: presignKeyId, secretAccessKey: presignSecret } })
    : undefined;
  const octokit = getOctokit(token);

  // Expand plan-json (single path or glob) into a stable, deduped list.
  const plans = await resolvePlans(planJsonPath);
  if (plans.length > 25) {
    core.warning(`burnmap: ${plans.length} plans matched; render time scales linearly.`);
  }
  const multi = plans.length > 1;

  const planUrls: string[] = [];
  const archUrls: string[] = [];
  const planItems: MultiCommentItem[] = [];
  const archItems: MultiCommentItem[] = [];
  const planModels: ChangeModel[] = [];
  const archMetas: ArchMeta[] = [];
  const tmpFiles: string[] = [];

  try {
    for (const plan of plans) {
      const slug = multi ? planSlug(plan.rel) : undefined;
      const suffix = slug ? `-${slug}` : '';
      const outPng = path.join(tmpdir(), `burnmap-${sha}${suffix}.png`);
      const outArchPng = path.join(tmpdir(), `burnmap-${sha}${suffix}-arch.png`);
      tmpFiles.push(outPng, outArchPng);

      const rawPlan = JSON.parse(readFileSync(plan.path, 'utf8')) as RawPlan;
      const sharedDeps = {
        readPlanJson: () => rawPlan,
        readPng: (p: string) => readFileSync(p),
        uploadAndPresign: (o: { bucket: string; key: string; body: Buffer; ttlSeconds: number }) =>
          uploadAndPresign({ client: s3, presignClient: presignS3, ...o }),
        upsertStickyComment: (o: { owner: string; repo: string; prNumber: number; marker: string; body: string }) =>
          upsertStickyComment({ octokit, ...o }),
      };

      if (mode === 'plan' || mode === 'both') {
        const r = await renderPlanImage(
          { ...sharedDeps, writeShotHtml, cleanupShotHtml, capture: (o) => capture(o) },
          {
            planJsonPath: plan.path, webDist, bucket, ttlSeconds,
            repo: `${owner}/${repo}`, owner, repoName: repo, prNumber, sha, outPng, slug,
          },
        );
        planUrls.push(r.imageUrl);
        planModels.push(r.model);
        planItems.push({ rel: plan.rel, imageUrl: r.imageUrl });
      }

      if (mode === 'arch' || mode === 'both') {
        const a = await renderArchImage(
          {
            ...sharedDeps,
            archToPng: (p, m, out, c) => archToPng(p, m, out, c ? { changes: c } : undefined),
          },
          {
            planJsonPath: plan.path, bucket, ttlSeconds,
            repo: `${owner}/${repo}`, owner, repoName: repo, prNumber, sha, outPng: outArchPng, slug,
            changes: mode === 'both'
              ? parsePlan(rawPlan, {
                  repo: `${owner}/${repo}`, prNumber, commitSha: sha,
                  terraformVersion: rawPlan.terraform_version ?? 'unknown',
                  generatedAt: new Date().toISOString(),
                })
              : undefined,
          },
        );
        archUrls.push(a.imageUrl);
        archMetas.push(a.meta);
        archItems.push({ rel: plan.rel, imageUrl: a.imageUrl });
      }
    }

    // Comments: single-plan keeps byte-identical legacy body; multi posts one
    // aggregated comment per render kind.
    if (mode === 'plan' || mode === 'both') {
      const body = multi
        ? buildMultiCommentBody(prNumber, `${owner}/${repo}`, sha, planItems)
        : buildCommentBody(planModels[0]!, planUrls[0]!);
      await upsertStickyComment({ octokit, owner, repo, prNumber, marker: commentMarker(prNumber), body });
    }
    if (mode === 'arch' || mode === 'both') {
      const body = multi
        ? buildArchMultiCommentBody(prNumber, `${owner}/${repo}`, sha, archItems)
        : buildArchCommentBody(archMetas[0]!, archUrls[0]!);
      await upsertStickyComment({ octokit, owner, repo, prNumber, marker: archCommentMarker(prNumber), body });
    }

    // Outputs: image-url is the first plan URL (or first arch URL in arch mode).
    const primaryList = mode === 'arch' ? archUrls : planUrls;
    for (const u of [...planUrls, ...archUrls]) core.setSecret(u);
    if (primaryList[0]) core.setOutput('image-url', primaryList[0]);
    core.setOutput('image-urls', JSON.stringify(primaryList));
    if ((mode === 'both' || mode === 'arch') && archUrls[0]) {
      core.setOutput('arch-image-url', archUrls[0]);
    }
  } finally {
    for (const f of tmpFiles) rmSync(f, { force: true });
  }
}

main().catch((err: unknown) => core.setFailed(err instanceof Error ? err.message : String(err)));
