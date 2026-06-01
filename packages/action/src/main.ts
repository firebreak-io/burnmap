import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { S3Client } from '@aws-sdk/client-s3';
import type { RawPlan } from '@burnmap/parser';
import { resolveWebDist, writeShotHtml, cleanupShotHtml, capture } from '@burnmap/shoot';
import { uploadAndPresign } from './s3.js';
import { upsertStickyComment } from './github.js';
import { run } from './run.js';

async function main(): Promise<void> {
  const planJsonPath = core.getInput('plan-json', { required: true });
  const bucket = core.getInput('s3-bucket', { required: true });
  const region = core.getInput('aws-region') || process.env.AWS_REGION || 'us-east-1';
  const ttlSeconds = Number(core.getInput('url-ttl-seconds') || '86400');
  // S3 SigV4 presigned URLs cap at 7 days (604800s); reject NaN / out-of-range early.
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 604800) {
    core.setFailed('url-ttl-seconds must be an integer between 1 and 604800 (S3 presigned-URL max is 7 days)');
    return;
  }
  const token = core.getInput('github-token', { required: true });
  const webDist = core.getInput('web-dist') || resolveWebDist();

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
  try {
    const result = await run(
      {
        readPlanJson: (p) => JSON.parse(readFileSync(p, 'utf8')) as RawPlan,
        writeShotHtml,
        cleanupShotHtml,
        capture: (o) => capture(o),
        readPng: (p) => readFileSync(p),
        uploadAndPresign: (o) => uploadAndPresign({ client: s3, presignClient: presignS3, ...o }),
        upsertStickyComment: (o) => upsertStickyComment({ octokit, ...o }),
      },
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
  } finally {
    rmSync(outPng, { force: true }); // remove the intermediate PNG (already uploaded to S3)
  }
}

main().catch((err: unknown) => core.setFailed(err instanceof Error ? err.message : String(err)));
