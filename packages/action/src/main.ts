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
import { uploadAndPresign } from './s3.js';
import { upsertStickyComment } from './github.js';
import { run, type RunDeps } from './run.js';
import { runArch } from './arch-run.js';

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

  const outPng = path.join(tmpdir(), `burnmap-${sha}.png`);
  const outArchPng = path.join(tmpdir(), `burnmap-${sha}-arch.png`);

  // Read+parse the plan once; both render paths reuse this object.
  const rawPlan = JSON.parse(readFileSync(planJsonPath, 'utf8')) as RawPlan;
  // Infrastructure adapters shared by the plan and arch render paths.
  const sharedDeps: Pick<RunDeps, 'readPlanJson' | 'readPng' | 'uploadAndPresign' | 'upsertStickyComment'> = {
    readPlanJson: () => rawPlan,
    readPng: (p) => readFileSync(p),
    uploadAndPresign: (o) => uploadAndPresign({ client: s3, presignClient: presignS3, ...o }),
    upsertStickyComment: (o) => upsertStickyComment({ octokit, ...o }),
  };

  try {
    if (mode === 'plan' || mode === 'both') {
      const result = await run(
        { ...sharedDeps, writeShotHtml, cleanupShotHtml, capture: (o) => capture(o) },
        {
          planJsonPath, webDist, bucket, ttlSeconds,
          repo: `${owner}/${repo}`, owner, repoName: repo,
          prNumber, sha, outPng,
        },
      );
      // The presigned URL is a bearer credential for the image — mask it so it
      // never appears in (potentially public) Actions logs, including the output.
      core.setSecret(result.imageUrl);
      core.setOutput('image-url', result.imageUrl);
      core.info(`burnmap ${result.commentAction} comment ${result.commentId} (image uploaded)`);
    }

    if (mode === 'arch' || mode === 'both') {
      const archResult = await runArch(
        {
          ...sharedDeps,
          archToPng: (plan, meta, out, changes) => archToPng(plan, meta, out, changes ? { changes } : undefined),
        },
        {
          planJsonPath, bucket, ttlSeconds,
          repo: `${owner}/${repo}`, owner, repoName: repo,
          prNumber, sha, outPng: outArchPng,
          // In "both" mode, tint the architecture with the PR's changes.
          changes: mode === 'both'
            ? parsePlan(rawPlan, {
                repo: `${owner}/${repo}`, prNumber, commitSha: sha,
                terraformVersion: rawPlan.terraform_version ?? 'unknown',
                generatedAt: new Date().toISOString(),
              })
            : undefined,
        },
      );
      core.setSecret(archResult.imageUrl);
      core.setOutput('arch-image-url', archResult.imageUrl);
      core.info(`burnmap ${archResult.commentAction} arch comment ${archResult.commentId}`);
    }
  } finally {
    rmSync(outPng, { force: true });
    rmSync(outArchPng, { force: true });
  }
}

main().catch((err: unknown) => core.setFailed(err instanceof Error ? err.message : String(err)));
