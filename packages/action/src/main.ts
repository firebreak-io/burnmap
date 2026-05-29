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
  const token = core.getInput('github-token', { required: true });
  const webDist = core.getInput('web-dist') || resolveWebDist();

  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) {
    core.setFailed('burnmap must run on a pull_request event (no PR number in context)');
    return;
  }
  const { owner, repo } = context.repo;
  const sha = context.payload.pull_request?.head?.sha ?? context.sha;

  const s3 = new S3Client({ region });
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
        uploadAndPresign: (o) => uploadAndPresign({ client: s3, ...o }),
        upsertStickyComment: (o) => upsertStickyComment({ octokit, ...o }),
      },
      {
        planJsonPath, webDist, bucket, ttlSeconds,
        repo: `${owner}/${repo}`, owner, repoName: repo,
        prNumber, sha, outPng,
      },
    );
    core.info(`burnmap ${result.commentAction} comment ${result.commentId} → ${result.imageUrl}`);
    core.setOutput('image-url', result.imageUrl);
  } finally {
    rmSync(outPng, { force: true }); // remove the intermediate PNG (already uploaded to S3)
  }
}

main().catch((err: Error) => core.setFailed(err.message));
