import type { ChangeMeta, ChangeModel, RawPlan } from '@burnmap/parser';
import { parsePlan } from '@burnmap/parser';
import { s3Key } from './s3.js';
import { commentMarker, buildCommentBody } from './comment.js';

/** Injected dependencies — real implementations are wired in main.ts; tests pass mocks. */
export interface RunDeps {
  readPlanJson: (path: string) => RawPlan;
  writeShotHtml: (webDist: string, model: ChangeModel) => string;
  cleanupShotHtml: (webDist: string) => void;
  capture: (opts: { shotHtmlPath: string; outPath: string }) => Promise<string>;
  readPng: (path: string) => Buffer;
  uploadAndPresign: (opts: {
    bucket: string; key: string; body: Buffer; ttlSeconds: number;
  }) => Promise<string>;
  upsertStickyComment: (opts: {
    owner: string; repo: string; prNumber: number; marker: string; body: string;
  }) => Promise<{ action: 'created' | 'updated'; id: number }>;
}

export interface RunInputs {
  planJsonPath: string;
  webDist: string;
  bucket: string;
  region: string;
  ttlSeconds: number;
  repo: string;       // "owner/repo"
  owner: string;
  repoName: string;
  prNumber: number;
  sha: string;
  outPng: string;
}

export interface RunResult {
  imageUrl: string;
  commentAction: 'created' | 'updated';
  commentId: number;
}

/** parse → screenshot → upload+presign → upsert sticky comment. */
export async function run(deps: RunDeps, inputs: RunInputs): Promise<RunResult> {
  const plan = deps.readPlanJson(inputs.planJsonPath);
  const meta: ChangeMeta = {
    repo: inputs.repo,
    prNumber: inputs.prNumber,
    commitSha: inputs.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };
  const model = parsePlan(plan, meta);

  const shotHtml = deps.writeShotHtml(inputs.webDist, model);
  try {
    await deps.capture({ shotHtmlPath: shotHtml, outPath: inputs.outPng });
  } finally {
    deps.cleanupShotHtml(inputs.webDist);
  }

  const key = s3Key({ repo: inputs.repo, prNumber: inputs.prNumber, sha: inputs.sha });
  const imageUrl = await deps.uploadAndPresign({
    bucket: inputs.bucket, key, body: deps.readPng(inputs.outPng), ttlSeconds: inputs.ttlSeconds,
  });

  const body = buildCommentBody(model, imageUrl);
  const { action, id } = await deps.upsertStickyComment({
    owner: inputs.owner, repo: inputs.repoName, prNumber: inputs.prNumber,
    marker: commentMarker(inputs.prNumber), body,
  });

  return { imageUrl, commentAction: action, commentId: id };
}
