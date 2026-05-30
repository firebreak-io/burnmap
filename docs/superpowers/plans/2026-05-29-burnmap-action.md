# burnmap Action (`@burnmap/action`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@burnmap/action` — the GitHub Action that ties the pipeline together in CI: parse a `tofu show -json` plan → screenshot the diagram (Phase 3) → upload the PNG to a private S3 bucket and presign it → create/update a single sticky PR comment with the embedded image + a text fallback. Plus the OpenTofu for the bucket and the GitHub-OIDC role.

**Architecture:** Pure, unit-tested building blocks — `buildCommentBody`, `s3Key`, `uploadAndPresign` (mocked AWS SDK), `upsertStickyComment` (mocked Octokit) — composed by a dependency-injected `run` orchestrator that is fully testable with mocks. A thin `main` reads GitHub Action inputs and wires real clients. A Docker action pins Playwright/chromium. OpenTofu provisions the bucket (private) + OIDC role.

**Tech Stack:** TypeScript (ESM), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `@actions/core` + `@actions/github` (Octokit), Vitest + `aws-sdk-client-mock`, OpenTofu, Docker. Depends on `@burnmap/parser` and `@burnmap/shoot` (workspace).

**Spec:** `docs/superpowers/specs/2026-05-29-burnmap-plan-visualizer-design.md` (CI integration, comment lifecycle, security).
**Depends on:** Phases 1–3, all complete on this branch's ancestry.

---

## Scope notes

- **Live end-to-end is out of scope for automated tests.** Real S3 uploads, real PR-comment posting, `docker build`, and `tofu apply` require the user's AWS account, a test repo/PR, and explicit confirmation (per repo policy: never `tofu apply` without confirmation). Automated coverage here is: pure logic + AWS SDK mocked + Octokit mocked + `tofu validate`. A "Live verification" checklist at the end lists what the user runs manually.
- **Security (from the spec):** the model is already secret-redacted by the parser; the comment never embeds raw values. S3 is private; the image is reached via a short-TTL presigned URL (GitHub's Camo proxy fetches+caches it once at render time, so it keeps displaying after the URL expires). The bucket blocks all public access.
- **Sticky comment:** one comment per PR, keyed by a hidden marker `<!-- burnmap:pr-{n} -->`, edited in place on each push.

## File structure (this phase)

```
action.yml                     # Docker GitHub Action definition (REPO ROOT — build context = whole workspace)
Dockerfile                     # REPO ROOT — node + chromium, builds the workspace
packages/action/
  package.json                 # @burnmap/action
  tsconfig.json
  vitest.config.ts
  src/
    comment.ts                 # commentMarker(), buildCommentBody()
    s3.ts                      # s3Key(), uploadAndPresign()
    github.ts                  # upsertStickyComment()
    run.ts                     # orchestrator (DI for testability)
    main.ts                    # action entry: read inputs, wire real clients
    index.ts                   # public exports
  test/
    comment.test.ts
    s3.test.ts
    github.test.ts
    run.test.ts
  infra/                       # OpenTofu (validated, not applied here)
    versions.tf
    variables.tf
    s3.tf
    iam.tf
    outputs.tf
```

---

## Task 1: Scaffold `@burnmap/action`

**Files:**
- Create: `packages/action/package.json`
- Create: `packages/action/tsconfig.json`
- Create: `packages/action/vitest.config.ts`

- [ ] **Step 1: Create the package manifest**

`packages/action/package.json`:
```json
{
  "name": "@burnmap/action",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@burnmap/parser": "*",
    "@burnmap/shoot": "*",
    "@actions/core": "^1.11.0",
    "@actions/github": "^6.0.0",
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "aws-sdk-client-mock": "^4.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`packages/action/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create the Vitest config**

`packages/action/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Install deps**

Run: `npm install`
Expected: installs AWS SDK, @actions/*, aws-sdk-client-mock; links workspace deps. No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/action/package.json packages/action/tsconfig.json packages/action/vitest.config.ts package-lock.json
git commit -m "chore(action): scaffold @burnmap/action (aws sdk + octokit + vitest)"
```

---

## Task 2: `comment.ts` — sticky marker + comment body

**Files:**
- Create: `packages/action/src/comment.ts`
- Test: `packages/action/test/comment.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/action/test/comment.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { commentMarker, buildCommentBody } from '../src/comment.js';
import type { ChangeModel } from '@burnmap/parser';

const model: ChangeModel = {
  meta: { repo: 'firebreak-io/infra', prNumber: 142, commitSha: 'a1b9c2f', terraformVersion: '1.12.1', generatedAt: '2026-05-29T00:00:00Z' },
  summary: { create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 },
  modules: [
    { module: 'module.data', types: [{ type: 'aws_db_instance', resources: [
      { address: 'module.data.aws_db_instance.main', module: 'module.data', type: 'aws_db_instance', name: 'main', provider: 'aws', action: 'replace', attrs: [], dangerScore: 100, dangerReasons: ['forces replacement: engine_version'] },
    ] }] },
    { module: '', types: [{ type: 'aws_security_group_rule', resources: [
      { address: 'aws_security_group_rule.legacy', module: '', type: 'aws_security_group_rule', name: 'legacy', provider: 'aws', action: 'delete', attrs: [], dangerScore: 70, dangerReasons: ['resource will be destroyed'] },
    ] }] },
  ],
  outputs: [],
};

describe('commentMarker', () => {
  it('is a stable HTML comment keyed by PR number', () => {
    expect(commentMarker(142)).toBe('<!-- burnmap:pr-142 -->');
  });
});

describe('buildCommentBody', () => {
  const body = buildCommentBody(model, 'https://s3.example/shot.png');

  it('starts with the sticky marker so it can be found and updated', () => {
    expect(body.startsWith('<!-- burnmap:pr-142 -->')).toBe(true);
  });

  it('embeds the image and a counts line (omitting zero counts)', () => {
    expect(body).toContain('![burnmap plan](https://s3.example/shot.png)');
    expect(body).toContain('**4 to add');
    expect(body).toContain('1 to destroy**');
    expect(body).not.toContain('to read'); // zero counts omitted
  });

  it('includes a collapsible plain-text manifest fallback with addresses and a danger marker', () => {
    expect(body).toContain('<details>');
    expect(body).toContain('module.data.aws_db_instance.main');
    expect(body).toContain('aws_security_group_rule.legacy');
    expect(body).toMatch(/⚠.*aws_db_instance\.main/); // high-risk flagged in the fallback
  });

  it('references repo and commit in the heading', () => {
    expect(body).toContain('firebreak-io/infra');
    expect(body).toContain('a1b9c2f');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/action && npx vitest run test/comment.test.ts`
Expected: FAIL — cannot resolve `../src/comment.js`.

- [ ] **Step 3: Write the implementation**

`packages/action/src/comment.ts`:
```ts
import type { ChangeModel } from '@burnmap/parser';

const GLYPH: Record<string, string> = {
  create: '+', update: '~', replace: '±', delete: '×', 'no-op': '·', read: '?',
};
const HIGH_RISK = 60;

/** Hidden marker that identifies burnmap's single sticky comment on a PR. */
export function commentMarker(prNumber: number): string {
  return `<!-- burnmap:pr-${prNumber} -->`;
}

function countsLine(s: ChangeModel['summary']): string {
  const parts: string[] = [];
  if (s.create) parts.push(`${s.create} to add`);
  if (s.update) parts.push(`${s.update} to change`);
  if (s.replace) parts.push(`${s.replace} to replace`);
  if (s.delete) parts.push(`${s.delete} to destroy`);
  return `**${parts.join(' · ') || 'no changes'}**`;
}

function manifestLines(model: ChangeModel): string {
  const lines: string[] = [];
  for (const m of model.modules) {
    lines.push(`${m.module || 'root'}`);
    for (const t of m.types) {
      for (const rc of t.resources) {
        const flag = rc.dangerScore >= HIGH_RISK ? '⚠ ' : '  ';
        lines.push(`  ${flag}${GLYPH[rc.action] ?? '?'} ${rc.address}`);
      }
    }
  }
  return lines.join('\n');
}

/** Build the full sticky-comment markdown body. */
export function buildCommentBody(model: ChangeModel, imageUrl: string): string {
  const { meta } = model;
  return [
    commentMarker(meta.prNumber),
    `### 🔥 burnmap — plan for \`${meta.repo}\` @ \`${meta.commitSha}\``,
    '',
    countsLine(model.summary),
    '',
    `![burnmap plan](${imageUrl})`,
    '',
    '<details><summary>Plain-text manifest</summary>',
    '',
    '```',
    manifestLines(model),
    '```',
    '',
    '</details>',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/action && npx vitest run test/comment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/comment.ts packages/action/test/comment.test.ts
git commit -m "feat(action): sticky comment marker + body builder"
```

---

## Task 3: `s3.ts` — key + upload/presign

**Files:**
- Create: `packages/action/src/s3.ts`
- Test: `packages/action/test/s3.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/action/test/s3.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Key, uploadAndPresign } from '../src/s3.js';

// Mock the presigner to a deterministic URL.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/shot.png?sig=abc'),
}));

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('s3Key', () => {
  it('namespaces by owner/repo/pr/sha', () => {
    expect(s3Key({ repo: 'firebreak-io/infra', prNumber: 142, sha: 'a1b9c2f' }))
      .toBe('burnmap/firebreak-io/infra/142/a1b9c2f.png');
  });
});

describe('uploadAndPresign', () => {
  it('uploads the PNG (private) and returns a presigned GET url', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const client = new S3Client({ region: 'us-east-1' });
    const url = await uploadAndPresign({
      client, bucket: 'burnmap-shots', key: 'burnmap/x/y/1/s.png',
      body: Buffer.from('PNGDATA'), ttlSeconds: 3600,
    });
    expect(url).toBe('https://signed.example/shot.png?sig=abc');
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]!.input).toMatchObject({
      Bucket: 'burnmap-shots',
      Key: 'burnmap/x/y/1/s.png',
      ContentType: 'image/png',
    });
    // the presigned GET must target the same bucket/key with the requested TTL
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: { Bucket: 'burnmap-shots', Key: 'burnmap/x/y/1/s.png' } }),
      { expiresIn: 3600 },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/action && npx vitest run test/s3.test.ts`
Expected: FAIL — cannot resolve `../src/s3.js`.

- [ ] **Step 3: Write the implementation**

`packages/action/src/s3.ts`:
```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3KeyParts {
  repo: string;      // "owner/repo"
  prNumber: number;
  sha: string;
}

/** Stable, per-commit object key: burnmap/<owner>/<repo>/<pr>/<sha>.png */
export function s3Key({ repo, prNumber, sha }: S3KeyParts): string {
  return `burnmap/${repo}/${prNumber}/${sha}.png`;
}

export interface UploadOptions {
  client: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  ttlSeconds: number;
}

/** Upload the PNG to a private bucket and return a short-TTL presigned GET URL. */
export async function uploadAndPresign(opts: UploadOptions): Promise<string> {
  const { client, bucket, key, body, ttlSeconds } = opts;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'image/png',
  }));
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/action && npx vitest run test/s3.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/s3.ts packages/action/test/s3.test.ts
git commit -m "feat(action): s3 key + upload/presign (private bucket, short-TTL url)"
```

---

## Task 4: `github.ts` — sticky comment upsert

**Files:**
- Create: `packages/action/src/github.ts`
- Test: `packages/action/test/github.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/action/test/github.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { upsertStickyComment } from '../src/github.js';

function fakeOctokit(existing: Array<{ id: number; body: string }>) {
  return {
    paginate: vi.fn(async () => existing),
    rest: {
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(async () => ({ data: { id: 999 } })),
        updateComment: vi.fn(async () => ({ data: { id: existing[0]?.id ?? 0 } })),
      },
    },
  };
}

const base = { owner: 'firebreak-io', repo: 'infra', prNumber: 142, marker: '<!-- burnmap:pr-142 -->' };

describe('upsertStickyComment', () => {
  it('creates a comment when none with the marker exists', async () => {
    const octokit = fakeOctokit([{ id: 1, body: 'unrelated comment' }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nhi' });
    expect(res.action).toBe('created');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing marked comment in place', async () => {
    const octokit = fakeOctokit([{ id: 77, body: '<!-- burnmap:pr-142 -->\nold' }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nnew' });
    expect(res.action).toBe('updated');
    expect(res.id).toBe(77);
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('skips comments with a null body (GitHub returns body:null for empty comments) and creates', async () => {
    const octokit = fakeOctokit([{ id: 2, body: null as unknown as string }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nhi' });
    expect(res.action).toBe('created');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/action && npx vitest run test/github.test.ts`
Expected: FAIL — cannot resolve `../src/github.js`.

- [ ] **Step 3: Write the implementation**

`packages/action/src/github.ts`:
```ts
import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

export interface UpsertOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  marker: string;
  body: string;
}

export interface UpsertResult {
  action: 'created' | 'updated';
  id: number;
}

/** Create burnmap's comment, or update the existing one identified by the marker. */
export async function upsertStickyComment(opts: UpsertOptions): Promise<UpsertResult> {
  const { octokit, owner, repo, prNumber, marker, body } = opts;

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return { action: 'updated', id: existing.id };
  }
  const created = await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  return { action: 'created', id: created.data.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/action && npx vitest run test/github.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/github.ts packages/action/test/github.test.ts
git commit -m "feat(action): sticky comment upsert (find-by-marker, update-or-create)"
```

---

## Task 5: `run.ts` — orchestrator (dependency-injected)

**Files:**
- Create: `packages/action/src/run.ts`
- Test: `packages/action/test/run.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/action/test/run.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { run } from '../src/run.js';

function deps() {
  return {
    readPlanJson: vi.fn(() => ({ terraform_version: '1.12.1', resource_changes: [], output_changes: {} })),
    writeShotHtml: vi.fn(() => '/web/dist/__burnmap_shot.html'),
    cleanupShotHtml: vi.fn(),
    capture: vi.fn(async () => '/tmp/shot.png'),
    readPng: vi.fn(() => Buffer.from('PNG')),
    uploadAndPresign: vi.fn(async () => 'https://signed.example/x.png'),
    upsertStickyComment: vi.fn(async () => ({ action: 'created' as const, id: 5 })),
  };
}

const inputs = {
  planJsonPath: '/p/plan.json',
  webDist: '/web/dist',
  bucket: 'burnmap-shots',
  ttlSeconds: 3600,
  repo: 'firebreak-io/infra',
  owner: 'firebreak-io',
  repoName: 'infra',
  prNumber: 142,
  sha: 'a1b9c2f',
  outPng: '/tmp/shot.png',
};

describe('run', () => {
  it('parses → shoots → uploads → upserts a comment with the presigned url', async () => {
    const d = deps();
    const res = await run(d as never, inputs);

    expect(d.writeShotHtml).toHaveBeenCalledWith('/web/dist', expect.objectContaining({ meta: expect.any(Object) }));
    expect(d.capture).toHaveBeenCalledWith(expect.objectContaining({ shotHtmlPath: '/web/dist/__burnmap_shot.html', outPath: '/tmp/shot.png' }));
    expect(d.uploadAndPresign).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'burnmap-shots', key: 'burnmap/firebreak-io/infra/142/a1b9c2f.png' }));
    const commentArgs = d.upsertStickyComment.mock.calls[0]![0];
    expect(commentArgs.body).toContain('https://signed.example/x.png');
    expect(commentArgs.marker).toBe('<!-- burnmap:pr-142 -->');
    expect(res.commentAction).toBe('created');
  });

  it('always cleans up the temp shot HTML, even if capture throws', async () => {
    const d = deps();
    d.capture = vi.fn(async () => { throw new Error('boom'); });
    await expect(run(d as never, inputs)).rejects.toThrow('boom');
    expect(d.cleanupShotHtml).toHaveBeenCalledWith('/web/dist');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/action && npx vitest run test/run.test.ts`
Expected: FAIL — cannot resolve `../src/run.js`.

- [ ] **Step 3: Write the implementation**

`packages/action/src/run.ts`:
```ts
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
  ttlSeconds: number;
  repo: string;       // "owner/repo"
  owner: string;
  repoName: string;
  prNumber: number;
  sha: string;
  /** Where capture writes the PNG. Caller-owned: the caller (main.ts) chose this
   *  path and is responsible for removing it; run() treats it as an output. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/action && npx vitest run test/run.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/run.ts packages/action/test/run.test.ts
git commit -m "feat(action): DI orchestrator (parse → shoot → upload → comment)"
```

---

## Task 6: `main.ts`, `index.ts`, `action.yml`, `Dockerfile`

The thin runtime wrapper. Not unit-tested (it only wires Action inputs to real clients); verified by `tsc` + static checks. Live behavior is in the user's "Live verification" checklist.

**Files:**
- Create: `packages/action/src/main.ts`
- Create: `packages/action/src/index.ts`
- Create: `action.yml` (repo root — so the Docker build context is the whole workspace)
- Create: `Dockerfile` (repo root)

- [ ] **Step 1: Write `main.ts`**

`packages/action/src/main.ts`:
```ts
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
```

- [ ] **Step 2: Write `index.ts`**

`packages/action/src/index.ts`:
```ts
export { commentMarker, buildCommentBody } from './comment.js';
export { s3Key, uploadAndPresign } from './s3.js';
export { upsertStickyComment } from './github.js';
export { run, type RunDeps, type RunInputs, type RunResult } from './run.js';
```

- [ ] **Step 3: Write `action.yml` (at the repo root)**

`action.yml` (repo root):
```yaml
name: burnmap
description: Render a tofu/terraform plan as a diagram and post it as a sticky PR comment.
inputs:
  plan-json:
    description: Path to `tofu show -json <plan>` output.
    required: true
  s3-bucket:
    description: S3 bucket for the rendered PNG (private).
    required: true
  github-token:
    description: Token used to post the PR comment.
    default: ${{ github.token }}
  aws-region:
    description: AWS region for the S3 client.
    required: false
    default: us-east-1
  url-ttl-seconds:
    description: Presigned URL TTL (seconds). GitHub's Camo proxy caches the image at render time.
    required: false
    default: "86400"
  web-dist:
    description: Override path to the built @burnmap/web dist (defaults to the bundled one).
    required: false
outputs:
  image-url:
    description: Presigned URL of the uploaded diagram.
runs:
  using: docker
  image: Dockerfile
```

- [ ] **Step 4: Write `Dockerfile` (at the repo root)**

`Dockerfile` (repo root) — the build context is the whole workspace, so it can `COPY` the root manifests and all packages:
```dockerfile
# Pin a Playwright image so chromium + system deps are present and reproducible.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /burnmap
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build --workspaces --if-present

ENTRYPOINT ["node", "/burnmap/packages/action/dist/main.js"]
```

- [ ] **Step 5: Verify it compiles and the YAML is valid**

Run: `cd packages/action && npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors.
Run (from repo root): `node -e "const y=require('fs').readFileSync('action.yml','utf8'); if(!/using: docker/.test(y)||!/plan-json/.test(y)){process.exit(1)} console.log('action.yml OK')"`
Expected: `action.yml OK`.

- [ ] **Step 6: Build the package**

Run: `cd packages/action && npm run build`
Expected: `dist/` with `main.js`, `run.js`, `s3.js`, `github.js`, `comment.js`, `index.js` + `.d.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/action/src/main.ts packages/action/src/index.ts action.yml Dockerfile
git commit -m "feat(action): action entry, action.yml (docker, root), Dockerfile, public exports"
```

---

## Task 7: OpenTofu — private bucket + GitHub-OIDC role

Provisions the infrastructure. **Validated only** — do NOT `tofu apply` (repo policy: never apply without explicit confirmation). The user applies it during Live verification.

**Files:**
- Create: `packages/action/infra/versions.tf`
- Create: `packages/action/infra/variables.tf`
- Create: `packages/action/infra/s3.tf`
- Create: `packages/action/infra/iam.tf`
- Create: `packages/action/infra/outputs.tf`

- [ ] **Step 1: Write `versions.tf`**

`packages/action/infra/versions.tf`:
```hcl
# Bootstrap module: local state is intentional. This provisions one bucket + one
# role, applied once by an operator. Add a `backend "s3"` block here if the infra
# grows or is applied by more than one person on a shared AWS account.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}
```

- [ ] **Step 2: Write `variables.tf`**

`packages/action/infra/variables.tf`:
```hcl
variable "region" {
  description = "AWS region for the burnmap bucket."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Globally-unique S3 bucket name for rendered plan images."
  type        = string
}

variable "github_repo" {
  description = "owner/repo allowed to assume the upload role via OIDC."
  type        = string
}

variable "image_expiry_days" {
  description = "Days after which rendered images are expired from the bucket."
  type        = number
  default     = 30
}
```

- [ ] **Step 3: Write `s3.tf`**

`packages/action/infra/s3.tf`:
```hcl
resource "aws_s3_bucket" "shots" {
  bucket = var.bucket_name
}

# Private: block every form of public access.
resource "aws_s3_bucket_public_access_block" "shots" {
  bucket                  = aws_s3_bucket.shots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "shots" {
  bucket = aws_s3_bucket.shots.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Expire rendered images; reviewers reach them via short-TTL presigned URLs
# (and GitHub's Camo proxy caches the bytes at comment-render time).
resource "aws_s3_bucket_lifecycle_configuration" "shots" {
  bucket = aws_s3_bucket.shots.id
  rule {
    id     = "expire-shots"
    status = "Enabled"
    filter {
      prefix = "burnmap/"
    }
    expiration {
      days = var.image_expiry_days
    }
  }
}
```

- [ ] **Step 4: Write `iam.tf`**

`packages/action/infra/iam.tf`:
```hcl
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "uploader" {
  name               = "burnmap-uploader"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "put_shots" {
  statement {
    # PutObject to upload the rendered PNG. GetObject because the action presigns
    # a GET URL signed by THIS role — S3 authorizes the presigned request as the
    # signing principal, so without GetObject the embedded image URL 403s.
    actions   = ["s3:PutObject", "s3:GetObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.shots.arn}/burnmap/*"]
  }
}

resource "aws_iam_role_policy" "put_shots" {
  name   = "burnmap-put-shots"
  role   = aws_iam_role.uploader.id
  policy = data.aws_iam_policy_document.put_shots.json
}
```

- [ ] **Step 5: Write `outputs.tf`**

`packages/action/infra/outputs.tf`:
```hcl
output "bucket_name" {
  description = "Bucket holding rendered plan images."
  value       = aws_s3_bucket.shots.id
}

output "uploader_role_arn" {
  description = "Role the GitHub Action assumes via OIDC to upload images."
  value       = aws_iam_role.uploader.arn
}
```

- [ ] **Step 6: Format + validate (no apply, no backend)**

Run: `cd packages/action/infra && tofu fmt -check && tofu init -backend=false && tofu validate`
Expected: `fmt` reports no changes; `init` installs the AWS provider; `validate` prints "Success! The configuration is valid."

> Do NOT run `tofu plan` or `tofu apply` here — that requires AWS credentials and is part of Live verification.

- [ ] **Step 7: Commit**

```bash
git add packages/action/infra/
git commit -m "feat(action): opentofu for private bucket + github-oidc uploader role"
```

---

## Self-review notes (author)

- **Spec coverage:** GitHub Action wrapper (Tasks 1/6 — `action.yml` Docker action). Parse→shoot→upload→comment pipeline (Task 5). S3 private + presigned short-TTL URL (Tasks 3/7). Sticky comment, marker-keyed, update-in-place (Tasks 2/4). Text-summary line + `<details>` plaintext fallback in the comment (Task 2). Per-SHA S3 key (Task 3). Bucket blocks public access + lifecycle expiry; OIDC role scoped to the repo with `s3:PutObject` on the `burnmap/*` prefix (Task 7).
- **Security:** model is pre-redacted by the parser; comment embeds only the presigned URL + redacted manifest. Bucket is private (public access fully blocked); reviewers see the image via Camo's cache of the presigned URL.
- **Type consistency:** `run`'s `RunDeps`/`RunInputs` thread the same fields used by `s3Key`, `buildCommentBody`, `commentMarker`, `uploadAndPresign`, `upsertStickyComment`. `main.ts` wires real impls matching those signatures and reuses `@burnmap/shoot`'s `writeShotHtml/cleanupShotHtml/capture/resolveWebDist` and `@burnmap/parser`'s `parsePlan`.
- **Out of automated scope (Live verification, below):** real S3 upload, real PR-comment posting, `docker build`, `tofu plan/apply`.

## Live verification checklist (user-run; needs AWS + a test PR)

1. `cd packages/action/infra && tofu plan -var bucket_name=<unique> -var github_repo=firebreak-io/burnmap` → review; `tofu apply` only after confirmation.
2. `docker build -t burnmap-action .` (from repo root; uses the root `Dockerfile`) → image builds.
3. In a test PR workflow: configure OIDC creds for `burnmap-uploader`, run `tofu plan -out=tfplan && tofu show -json tfplan > plan.json`, then invoke the action with `plan-json: plan.json`, `s3-bucket: <bucket>`.
4. Confirm the sticky comment appears with the embedded diagram; push again and confirm the same comment updates (no duplicate).

---

## burnmap is feature-complete after this phase

Phases 1–4 deliver the full v1: `tofu show -json` → a styled, secret-safe diagram posted as a sticky PR comment. Future work (per the spec, out of scope): the hosted interactive service + dependency-graph overlay (goal C).
