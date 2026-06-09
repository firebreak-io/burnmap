import type { RawPlan, ChangeModel } from '@burnmap/parser';
import type { ArchMeta } from '@burnmap/graph';
import { s3Key } from './s3.js';
import { archCommentMarker, buildArchCommentBody } from './arch-comment.js';

export interface ArchRunDeps {
  readPlanJson: (path: string) => RawPlan;
  archToPng: (plan: RawPlan, meta: ArchMeta, outPath: string, changes?: ChangeModel) => Promise<string>;
  readPng: (path: string) => Buffer;
  uploadAndPresign: (opts: {
    bucket: string; key: string; body: Buffer; ttlSeconds: number;
  }) => Promise<string>;
  upsertStickyComment: (opts: {
    owner: string; repo: string; prNumber: number; marker: string; body: string;
  }) => Promise<{ action: 'created' | 'updated'; id: number }>;
}

export interface ArchRunInputs {
  planJsonPath: string;
  bucket: string;
  ttlSeconds: number;
  repo: string;
  owner: string;
  repoName: string;
  prNumber: number;
  sha: string;
  outPng: string;
  /** When set (e.g. "both" mode), changed resources are tinted on the diagram. */
  changes?: ChangeModel;
}

export interface ArchRunResult {
  imageUrl: string;
  commentAction: 'created' | 'updated';
  commentId: number;
}

/** parse config → render arch PNG → upload+presign → upsert the arch sticky comment. */
export async function runArch(deps: ArchRunDeps, inputs: ArchRunInputs): Promise<ArchRunResult> {
  const plan = deps.readPlanJson(inputs.planJsonPath);
  const meta: ArchMeta = {
    repo: inputs.repo,
    prNumber: inputs.prNumber,
    commitSha: inputs.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  await deps.archToPng(plan, meta, inputs.outPng, inputs.changes);

  const key = s3Key({ repo: inputs.repo, prNumber: inputs.prNumber, sha: inputs.sha, kind: 'arch' });
  const imageUrl = await deps.uploadAndPresign({
    bucket: inputs.bucket, key, body: deps.readPng(inputs.outPng), ttlSeconds: inputs.ttlSeconds,
  });

  const body = buildArchCommentBody(meta, imageUrl);
  const { action, id } = await deps.upsertStickyComment({
    owner: inputs.owner, repo: inputs.repoName, prNumber: inputs.prNumber,
    marker: archCommentMarker(inputs.prNumber), body,
  });

  return { imageUrl, commentAction: action, commentId: id };
}
