# burnmap changes 1–3 (multi-plan, upload-only, captions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@burnmap/action` to (1) accept a glob of plan JSONs and render/upload one diagram each, (2) support an upload-only mode that skips the PR comment, and (3) bake an optional caption strip into each rendered PNG.

**Architecture:** A new `resolvePlans` step expands `plan-json` (literal path or glob) into a stable, deduped, canonical file list. `main.ts` loops over the list, rendering+uploading each plan independently, then composes a single sticky comment embedding all images (or skips the comment in upload-only mode). Captions are resolved per-plan from path/label inputs and composited onto each PNG by a new Chromium-based `captionPng` in `@burnmap/shoot`, reusing the existing screenshot pipeline. Per-plan S3 keys gain a path-derived slug only when more than one plan resolves, so single-plan runs stay byte- and key-identical to today.

**Tech Stack:** TypeScript (NodeNext, ES2022, strict), Node 22, vitest, `tinyglobby` (glob expansion), Playwright via `@burnmap/shoot` (rasterize + caption), `@actions/core` / `@actions/github`. Matches existing package conventions (`packages/action` is the template).

## Global Constraints

- TypeScript strict, NodeNext module resolution; ESM imports use `.js` extensions on relative paths. (copied from existing `packages/*/tsconfig.json`)
- Node 22 (`fs`/`path` builtins available; project pins Node 22.19). (verified `node --version`)
- Tests use vitest with dependency injection: real adapters wired in `main.ts`, mocks passed in unit tests. Never hit S3, Chromium, or GitHub in unit tests. (copied from `packages/action/test/run.test.ts`)
- Per-task commits, Conventional Commits style matching the existing log (`feat(action): …`, `feat(shoot): …`, `docs: …`).
- Backward compatibility is mandatory: an existing single-`plan-json` workflow with no other new inputs must produce a byte-identical PNG, an identical S3 key, and an identical comment body. (copied from change-1 acceptance criteria and change-2 "byte-identical to today")
- New action inputs default to today's behavior: `comment` defaults `true`, `labels-from` defaults `none`, `labels` defaults `""`. (copied from change specs)

---

## Task 0: Fix Docker build order to include `@burnmap/graph`

Phase 1 made `@burnmap/action` depend on `@burnmap/graph`, but `Dockerfile:13`
builds `parser web shoot action` and never builds `graph`, so the clean Docker
image build fails to resolve `@burnmap/graph` from `action`'s `tsc`. Fix the
order before adding more action code. (No unit test — this is a build-script
fix; verified by a Docker-equivalent clean build command.)

**Files:**
- Modify: `Dockerfile:13`

- [ ] **Step 1: Update the build order line**

Replace line 13 of `Dockerfile`:

```dockerfile
RUN npm run build -w @burnmap/parser -w @burnmap/web -w @burnmap/shoot -w @burnmap/graph -w @burnmap/action
```

Also update the comment just above it (lines 9–12) to mention graph:

```dockerfile
# Build in dependency order: parser -> web -> shoot -> graph -> action.
# `npm run build --workspaces` runs packages/* alphabetically (action first),
# so action's tsc fails to resolve @burnmap/{parser,shoot,graph} before they
# are built. Explicit order fixes the clean (Docker) build.
```

- [ ] **Step 2: Verify the build order compiles from clean dist**

Run:
```bash
rm -rf packages/*/dist && npm run build -w @burnmap/parser -w @burnmap/web -w @burnmap/shoot -w @burnmap/graph -w @burnmap/action
```
Expected: every `tsc`/`vite build` exits 0; `packages/graph/dist` and
`packages/action/dist` exist. (This reproduces the Docker build order locally.)

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): build @burnmap/graph before action in image"
```

---

# Change 1 — multi-plan input

Spec: `burnmap-changes/01-multi-plan-input.md`.

## Task 1: `resolvePlans` — glob expansion

**Files:**
- Create: `packages/action/src/plans.ts`
- Modify: `packages/action/package.json` (add `tinyglobby` dependency)
- Test: `packages/action/test/plans.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ResolvedPlan { path: string; rel: string }` — `path` is the
    canonical absolute path (symlinks resolved); `rel` is the path relative to
    `cwd`, forward slashes, no leading `./`.
  - `async function resolvePlans(pattern: string, cwd?: string): Promise<ResolvedPlan[]>`
    — returns matches sorted lexicographically by `path`, deduped by canonical
    `path`; throws `Error` when zero files match.

- [ ] **Step 1: Write the failing test**

```ts
// packages/action/test/plans.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolvePlans } from '../src/plans.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'burnmap-plans-'));
  mkdirSync(path.join(root, 'a'), { recursive: true });
  mkdirSync(path.join(root, 'b'), { recursive: true });
  writeFileSync(path.join(root, 'a', 'plan.json'), '{}');
  writeFileSync(path.join(root, 'b', 'plan.json'), '{}');
  writeFileSync(path.join(root, 'top.json'), '{}');
  // symlink pointing at an existing real file → must dedupe by canonical path
  symlinkSync(path.join(root, 'a', 'plan.json'), path.join(root, 'link.json'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolvePlans', () => {
  it('resolves a single literal path to one entry', async () => {
    const out = await resolvePlans('top.json', root);
    expect(out).toHaveLength(1);
    expect(out[0]!.rel).toBe('top.json');
  });

  it('expands a recursive glob, sorted lexicographically by canonical path', async () => {
    const out = await resolvePlans('**/plan.json', root);
    expect(out.map((p) => p.rel)).toEqual(['a/plan.json', 'b/plan.json']);
  });

  it('dedupes a symlink that resolves to an already-matched real file', async () => {
    const out = await resolvePlans('*.json', root);
    // top.json + link.json(→a/plan.json); link dedupes against a/plan.json only
    // if a/plan.json is also matched. With *.json (non-recursive) only top.json
    // and link.json match; link canonicalizes to a/plan.json (outside the match
    // set), so both remain — one canonical top.json, one canonical a/plan.json.
    expect(out.map((p) => p.rel).sort()).toEqual(['a/plan.json', 'top.json']);
  });

  it('throws a clear error when nothing matches', async () => {
    await expect(resolvePlans('nope/*.json', root)).rejects.toThrow(/no plan files matched/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- plans`
Expected: FAIL — cannot find module `../src/plans.js`.

- [ ] **Step 3: Add `tinyglobby` to `packages/action/package.json`**

Add to `dependencies` (keep alphabetical with the existing `@burnmap/*` entries):

```json
    "tinyglobby": "^0.2.10",
```

Run: `npm install`
Expected: `tinyglobby` resolves as a direct dependency; lockfile updated.

- [ ] **Step 4: Write `plans.ts`**

```ts
// packages/action/src/plans.ts
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';

export interface ResolvedPlan {
  /** Canonical absolute path (symlinks resolved). */
  path: string;
  /** Path relative to cwd, forward slashes, no leading "./". */
  rel: string;
}

/** Expand a literal path or glob into a stable, deduped, canonical plan list. */
export async function resolvePlans(
  pattern: string,
  cwd: string = process.cwd(),
): Promise<ResolvedPlan[]> {
  const matches = await glob(pattern, { cwd, absolute: true, onlyFiles: true, dot: false });

  const byCanonical = new Map<string, ResolvedPlan>();
  for (const m of matches) {
    let canonical: string;
    try {
      canonical = realpathSync(m);
    } catch {
      canonical = path.resolve(m);
    }
    if (byCanonical.has(canonical)) continue;
    const rel = path.relative(cwd, canonical).split(path.sep).join('/');
    byCanonical.set(canonical, { path: canonical, rel });
  }

  const out = [...byCanonical.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (out.length === 0) {
    throw new Error(`no plan files matched "${pattern}" (cwd: ${cwd})`);
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- plans`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/action/src/plans.ts packages/action/test/plans.test.ts packages/action/package.json package-lock.json
git commit -m "feat(action): resolvePlans expands plan-json path or glob"
```

---

## Task 2: Per-plan S3 key slug

**Files:**
- Modify: `packages/action/src/s3.ts`
- Test: `packages/action/test/s3.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `s3Key` gains an optional `slug?: string`. Key shape becomes
  `burnmap/<repo>/<pr>/<sha>[-arch][-<slug>].png`. When `slug` is omitted the
  key is identical to today (backward compatible). The `-arch` suffix, when
  present, comes before the slug.

- [ ] **Step 1: Add failing tests to `s3.test.ts`**

Append inside the existing `describe('s3Key', …)` block (or add one if absent):

```ts
  it('omits the slug by default (backward compatible)', () => {
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc' })).toBe('burnmap/o/r/7/abc.png');
  });

  it('appends a slug after the optional -arch suffix', () => {
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc', slug: 'deadbe' }))
      .toBe('burnmap/o/r/7/abc-deadbe.png');
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc', kind: 'arch', slug: 'deadbe' }))
      .toBe('burnmap/o/r/7/abc-arch-deadbe.png');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- s3`
Expected: FAIL — `slug` not accepted / key string mismatch.

- [ ] **Step 3: Extend `s3Key` in `s3.ts`**

Replace the `S3KeyParts` interface and `s3Key` function:

```ts
export interface S3KeyParts {
  repo: string;      // "owner/repo"
  prNumber: number;
  sha: string;
  kind?: 'plan' | 'arch';
  /** Short path-derived discriminator; appended only for multi-plan runs. */
  slug?: string;
}

/** Stable, per-commit object key: burnmap/<owner>/<repo>/<pr>/<sha>[-arch][-<slug>].png */
export function s3Key({ repo, prNumber, sha, kind = 'plan', slug }: S3KeyParts): string {
  const archSuffix = kind === 'arch' ? '-arch' : '';
  const slugSuffix = slug ? `-${slug}` : '';
  return `burnmap/${repo}/${prNumber}/${sha}${archSuffix}${slugSuffix}.png`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- s3`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/s3.ts packages/action/test/s3.test.ts
git commit -m "feat(action): optional path slug in s3Key for multi-plan runs"
```

---

## Task 3: `planSlug` helper

A deterministic short hash of a plan's relative path, used as the S3 slug so two
plans named `plan.json` in different directories don't collide.

**Files:**
- Modify: `packages/action/src/plans.ts`
- Test: `packages/action/test/plans.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function planSlug(rel: string): string` — first 8 hex chars of
  `sha256(rel)`. Deterministic across runs for the same `rel`.

- [ ] **Step 1: Add the failing test**

Append to `packages/action/test/plans.test.ts`:

```ts
import { planSlug } from '../src/plans.js';

describe('planSlug', () => {
  it('is deterministic and 8 hex chars', () => {
    const a = planSlug('a/plan.json');
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(planSlug('a/plan.json')).toBe(a);
  });

  it('differs for different paths', () => {
    expect(planSlug('a/plan.json')).not.toBe(planSlug('b/plan.json'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- plans`
Expected: FAIL — `planSlug` is not exported.

- [ ] **Step 3: Add `planSlug` to `plans.ts`**

Add at the top imports:

```ts
import { createHash } from 'node:crypto';
```

Add the function (after `resolvePlans`):

```ts
/** Short, stable discriminator for a plan's relative path (S3 key slug). */
export function planSlug(rel: string): string {
  return createHash('sha256').update(rel).digest('hex').slice(0, 8);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- plans`
Expected: PASS (4 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/plans.ts packages/action/test/plans.test.ts
git commit -m "feat(action): planSlug hashes a plan path for stable S3 keys"
```

---

## Task 4: Split rendering from commenting — `renderPlanImage`

Extract the parse→shoot→upload core of `run()` into a comment-free function so
`main.ts` can render many plans into one comment. `run()` keeps its current
contract (renders + comments a single plan) by delegating to the new function,
so its existing tests stay green.

**Files:**
- Modify: `packages/action/src/run.ts`
- Test: `packages/action/test/run.test.ts`

**Interfaces:**
- Consumes: `RunDeps`, `RunInputs` (existing).
- Produces:
  - `interface RenderedImage { model: import('@burnmap/parser').ChangeModel; imageUrl: string }`
  - `async function renderPlanImage(deps: RunDeps, inputs: RunInputs & { slug?: string }): Promise<RenderedImage>`
    — parse, shoot, upload (key uses `inputs.slug`); returns the parsed model and
    presigned URL. Does **not** comment.
  - `run()` unchanged signature/return; now built on `renderPlanImage` + comment.

- [ ] **Step 1: Add a failing test for `renderPlanImage`**

Append to `packages/action/test/run.test.ts`:

```ts
import { renderPlanImage } from '../src/run.js';

describe('renderPlanImage', () => {
  it('renders + uploads with a slugged key and does NOT comment', async () => {
    const d = deps();
    const res = await renderPlanImage(d as never, { ...inputs, slug: 'deadbe' });
    expect(d.uploadAndPresign).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'burnmap/firebreak-io/infra/142/a1b9c2f-deadbe.png' }),
    );
    expect(d.upsertStickyComment).not.toHaveBeenCalled();
    expect(res.imageUrl).toBe('https://signed.example/x.png');
    expect(res.model.meta).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- run`
Expected: FAIL — `renderPlanImage` is not exported.

- [ ] **Step 3: Refactor `run.ts`**

Replace the body of `run.ts` from the `run` function downward with:

```ts
export interface RenderedImage {
  model: ChangeModel;
  imageUrl: string;
}

/** parse → screenshot → upload+presign. No PR comment. */
export async function renderPlanImage(
  deps: RunDeps,
  inputs: RunInputs & { slug?: string },
): Promise<RenderedImage> {
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

  const key = s3Key({ repo: inputs.repo, prNumber: inputs.prNumber, sha: inputs.sha, slug: inputs.slug });
  const imageUrl = await deps.uploadAndPresign({
    bucket: inputs.bucket, key, body: deps.readPng(inputs.outPng), ttlSeconds: inputs.ttlSeconds,
  });
  return { model, imageUrl };
}

/** parse → screenshot → upload+presign → upsert sticky comment. */
export async function run(deps: RunDeps, inputs: RunInputs): Promise<RunResult> {
  const { model, imageUrl } = await renderPlanImage(deps, inputs);
  const body = buildCommentBody(model, imageUrl);
  const { action, id } = await deps.upsertStickyComment({
    owner: inputs.owner, repo: inputs.repoName, prNumber: inputs.prNumber,
    marker: commentMarker(inputs.prNumber), body,
  });
  return { imageUrl, commentAction: action, commentId: id };
}
```

(Leave the imports, `RunDeps`, `RunInputs`, and `RunResult` declarations above
unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- run`
Expected: PASS — both the original `run` tests and the new `renderPlanImage` test.

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/run.ts packages/action/test/run.test.ts
git commit -m "refactor(action): extract renderPlanImage from run"
```

---

## Task 5: Split rendering from commenting — `renderArchImage`

Same split for the arch path.

**Files:**
- Modify: `packages/action/src/arch-run.ts`
- Test: `packages/action/test/arch-run.test.ts`

**Interfaces:**
- Consumes: `ArchRunDeps`, `ArchRunInputs` (existing, which already carry an
  optional `changes` for "both" mode tinting).
- Produces:
  - `interface RenderedArch { meta: import('@burnmap/graph').ArchMeta; imageUrl: string }`
  - `async function renderArchImage(deps: ArchRunDeps, inputs: ArchRunInputs & { slug?: string }): Promise<RenderedArch>`
    — render arch PNG, upload under the arch key (with optional slug); no comment.
  - `runArch()` unchanged signature/return; built on `renderArchImage` + comment.

- [ ] **Step 1: Add a failing test for `renderArchImage`**

Append to `packages/action/test/arch-run.test.ts`:

```ts
import { renderArchImage } from '../src/arch-run.js';

describe('renderArchImage', () => {
  it('renders + uploads under the slugged arch key and does NOT comment', async () => {
    const deps = {
      readPlanJson: vi.fn(() => plan),
      archToPng: vi.fn(async (_p, _m, out) => out),
      readPng: vi.fn(() => Buffer.from('PNG')),
      uploadAndPresign: vi.fn(async () => 'https://signed/arch.png'),
      upsertStickyComment: vi.fn(async () => ({ action: 'created' as const, id: 1 })),
    };
    const res = await renderArchImage(deps as never, {
      planJsonPath: 'plan.json', bucket: 'b', ttlSeconds: 60,
      repo: 'o/r', owner: 'o', repoName: 'r', prNumber: 7, sha: 'abc',
      outPng: '/tmp/x-arch.png', slug: 'deadbe',
    });
    expect(deps.uploadAndPresign).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'burnmap/o/r/7/abc-arch-deadbe.png' }),
    );
    expect(deps.upsertStickyComment).not.toHaveBeenCalled();
    expect(res.imageUrl).toBe('https://signed/arch.png');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- arch-run`
Expected: FAIL — `renderArchImage` is not exported.

- [ ] **Step 3: Refactor `arch-run.ts`**

Replace the `runArch` function with the split pair (keep all the interface
declarations above it unchanged):

```ts
export interface RenderedArch {
  meta: ArchMeta;
  imageUrl: string;
}

/** parse config → render arch PNG → upload+presign. No PR comment. */
export async function renderArchImage(
  deps: ArchRunDeps,
  inputs: ArchRunInputs & { slug?: string },
): Promise<RenderedArch> {
  const plan = deps.readPlanJson(inputs.planJsonPath);
  const meta: ArchMeta = {
    repo: inputs.repo,
    prNumber: inputs.prNumber,
    commitSha: inputs.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  await deps.archToPng(plan, meta, inputs.outPng, inputs.changes);

  const key = s3Key({
    repo: inputs.repo, prNumber: inputs.prNumber, sha: inputs.sha, kind: 'arch', slug: inputs.slug,
  });
  const imageUrl = await deps.uploadAndPresign({
    bucket: inputs.bucket, key, body: deps.readPng(inputs.outPng), ttlSeconds: inputs.ttlSeconds,
  });
  return { meta, imageUrl };
}

/** render arch image → upsert the arch sticky comment. */
export async function runArch(deps: ArchRunDeps, inputs: ArchRunInputs): Promise<ArchRunResult> {
  const { meta, imageUrl } = await renderArchImage(deps, inputs);
  const body = buildArchCommentBody(meta, imageUrl);
  const { action, id } = await deps.upsertStickyComment({
    owner: inputs.owner, repo: inputs.repoName, prNumber: inputs.prNumber,
    marker: archCommentMarker(inputs.prNumber), body,
  });
  return { imageUrl, commentAction: action, commentId: id };
}
```

> If the existing `arch-run.ts` does not already thread `inputs.changes` into
> `archToPng` (it accepts a 4th `changes` arg per `main.ts`), keep the existing
> call shape; the `ArchRunDeps.archToPng` signature is
> `(plan, meta, outPath, changes?) => Promise<string>`. Match whatever the
> current file declares.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- arch-run`
Expected: PASS — original `runArch` test and the new `renderArchImage` test.

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/arch-run.ts packages/action/test/arch-run.test.ts
git commit -m "refactor(action): extract renderArchImage from runArch"
```

---

## Task 6: Multi-image comment bodies

A single sticky comment that embeds N plan images (and N arch images), used only
when more than one plan resolves. Single-plan runs keep using the existing
`buildCommentBody` / `buildArchCommentBody` for byte-identical output.

**Files:**
- Modify: `packages/action/src/comment.ts`
- Modify: `packages/action/src/arch-comment.ts`
- Test: `packages/action/test/comment.test.ts`
- Test: `packages/action/test/arch-comment.test.ts`

**Interfaces:**
- Consumes: `ChangeModel` (parser), `ArchMeta` (graph), `commentMarker`,
  `archCommentMarker`.
- Produces:
  - `interface MultiCommentItem { rel: string; imageUrl: string; caption?: string }`
  - `function buildMultiCommentBody(prNumber: number, repo: string, sha: string, items: MultiCommentItem[]): string`
    — marker first line, one section per item: a heading (`caption` if set, else
    `rel`) then the image. (Captions are wired in Task 12; here `caption` is just
    an optional override of the heading text.)
  - `function buildArchMultiCommentBody(prNumber: number, repo: string, sha: string, items: MultiCommentItem[]): string`
    — same shape under the arch marker.

- [ ] **Step 1: Add the failing test (plan)**

Append to `packages/action/test/comment.test.ts`:

```ts
import { buildMultiCommentBody } from '../src/comment.js';

describe('buildMultiCommentBody', () => {
  it('starts with the plan marker and embeds one section per item', () => {
    const body = buildMultiCommentBody(7, 'o/r', 'abc', [
      { rel: 'a/plan.json', imageUrl: 'https://s/a.png' },
      { rel: 'b/plan.json', imageUrl: 'https://s/b.png', caption: 'B module' },
    ]);
    expect(body.startsWith('<!-- burnmap:pr-7 -->')).toBe(true);
    expect(body).toContain('a/plan.json');
    expect(body).toContain('![burnmap plan](https://s/a.png)');
    expect(body).toContain('B module');           // caption overrides the heading
    expect(body).toContain('![burnmap plan](https://s/b.png)');
  });
});
```

- [ ] **Step 2: Add the failing test (arch)**

Append to `packages/action/test/arch-comment.test.ts`:

```ts
import { buildArchMultiCommentBody } from '../src/arch-comment.js';

describe('buildArchMultiCommentBody', () => {
  it('starts with the arch marker and embeds one section per item', () => {
    const body = buildArchMultiCommentBody(7, 'o/r', 'abc', [
      { rel: 'a/plan.json', imageUrl: 'https://s/a.png' },
    ]);
    expect(body.startsWith('<!-- burnmap:arch:pr-7 -->')).toBe(true);
    expect(body).toContain('a/plan.json');
    expect(body).toContain('![burnmap architecture](https://s/a.png)');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -w @burnmap/action -- comment`
Expected: FAIL — `buildMultiCommentBody` / `buildArchMultiCommentBody` not exported.

- [ ] **Step 4: Add `buildMultiCommentBody` to `comment.ts`**

Add the type and function (after `buildCommentBody`):

```ts
export interface MultiCommentItem {
  rel: string;
  imageUrl: string;
  caption?: string;
}

/** One sticky comment embedding several plan diagrams (multi-plan runs). */
export function buildMultiCommentBody(
  prNumber: number,
  repo: string,
  sha: string,
  items: MultiCommentItem[],
): string {
  const lines: string[] = [
    commentMarker(prNumber),
    `### 🔥 burnmap — plans for \`${repo}\` @ \`${sha}\``,
    '',
  ];
  for (const it of items) {
    lines.push(`**${it.caption ?? it.rel}**`, '', `![burnmap plan](${it.imageUrl})`, '');
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Add `buildArchMultiCommentBody` to `arch-comment.ts`**

```ts
import type { MultiCommentItem } from './comment.js';

/** One sticky comment embedding several architecture diagrams (multi-plan runs). */
export function buildArchMultiCommentBody(
  prNumber: number,
  repo: string,
  sha: string,
  items: MultiCommentItem[],
): string {
  const lines: string[] = [
    archCommentMarker(prNumber),
    `### 🗺 burnmap — architecture for \`${repo}\` @ \`${sha}\``,
    '',
  ];
  for (const it of items) {
    lines.push(`**${it.caption ?? it.rel}**`, '', `![burnmap architecture](${it.imageUrl})`, '');
  }
  return lines.join('\n');
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @burnmap/action -- comment`
Expected: PASS (existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add packages/action/src/comment.ts packages/action/src/arch-comment.ts packages/action/test/comment.test.ts packages/action/test/arch-comment.test.ts
git commit -m "feat(action): multi-image comment bodies for plan and arch"
```

---

## Task 7: Orchestrate multi-plan in `main.ts` + `image-urls` output

Wire `resolvePlans` and the per-plan loop into `main.ts`. Single-plan runs take
the existing single path (byte-identical comment); multi-plan runs render each
plan and post one aggregated comment. Always set `image-urls`.

**Files:**
- Modify: `packages/action/src/main.ts`
- Modify: `packages/action/src/index.ts` (export new symbols)
- Modify: `action.yml` (add `image-urls` output)

**Interfaces:**
- Consumes: `resolvePlans`, `planSlug`, `renderPlanImage`, `renderArchImage`,
  `buildMultiCommentBody`, `buildArchMultiCommentBody`, `run`, `runArch`.
- Produces: action outputs `image-url` (first URL, lexicographic) and
  `image-urls` (JSON array of all URLs in stable order).

> `main.ts` has no unit test today (it is the composition root, exercised via
> the `run`/`runArch`/`plans` unit tests). This task is verified by the action
> build plus the full action suite. Keep all logic delegated to the
> already-tested helpers so `main.ts` stays a thin wiring layer.

- [ ] **Step 1: Rewrite the render/orchestration section of `main.ts`**

Replace everything from the `const outPng = …` line (currently `main.ts:66`)
through the end of the `try { … } finally { … }` block with:

```ts
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
        uploadAndPresign: (o: Parameters<typeof uploadAndPresign>[0] extends never ? never : {
          bucket: string; key: string; body: Buffer; ttlSeconds: number;
        }) => uploadAndPresign({ client: s3, presignClient: presignS3, ...o }),
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
        planItems.push({ rel: plan.rel, imageUrl: r.imageUrl });
      }

      if (mode === 'arch' || mode === 'both') {
        const a = await renderArchImage(
          { ...sharedDeps, archToPng: (p, m, out, c) => archToPng(p, m, out, c ? { changes: c } : undefined) },
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
        archItems.push({ rel: plan.rel, imageUrl: a.imageUrl });
      }
    }

    // Comments: single plan keeps the byte-identical legacy body; multi posts one
    // aggregated comment per render kind.
    if (mode === 'plan' || mode === 'both') {
      if (multi) {
        await upsertStickyComment({
          octokit, owner, repo, prNumber,
          marker: commentMarker(prNumber),
          body: buildMultiCommentBody(prNumber, `${owner}/${repo}`, sha, planItems),
        });
      } else {
        await upsertStickyComment({
          octokit, owner, repo, prNumber,
          marker: commentMarker(prNumber),
          body: buildCommentBody(
            parsePlan(JSON.parse(readFileSync(plans[0]!.path, 'utf8')) as RawPlan, {
              repo: `${owner}/${repo}`, prNumber, commitSha: sha,
              terraformVersion: 'unknown', generatedAt: new Date().toISOString(),
            }),
            planUrls[0]!,
          ),
        });
      }
    }
    if (mode === 'arch' || mode === 'both') {
      const archBody = multi
        ? buildArchMultiCommentBody(prNumber, `${owner}/${repo}`, sha, archItems)
        : buildArchCommentBody(
            { repo: `${owner}/${repo}`, prNumber, commitSha: sha, terraformVersion: 'unknown', generatedAt: new Date().toISOString() },
            archUrls[0]!,
          );
      await upsertStickyComment({ octokit, owner, repo, prNumber, marker: archCommentMarker(prNumber), body: archBody });
    }

    // Outputs: image-url is the first plan URL (or first arch URL in arch mode).
    const primary = (mode === 'arch' ? archUrls : planUrls);
    const all = (mode === 'arch' ? archUrls : planUrls);
    for (const u of [...planUrls, ...archUrls]) core.setSecret(u);
    if (primary[0]) core.setOutput('image-url', primary[0]);
    core.setOutput('image-urls', JSON.stringify(all));
    if (mode === 'both' || mode === 'arch') {
      if (archUrls[0]) core.setOutput('arch-image-url', archUrls[0]);
    }
  } finally {
    for (const f of tmpFiles) rmSync(f, { force: true });
  }
}
```

> **Note on the legacy single-plan comment:** the previous `main.ts` built the
> comment from the model returned by `run()`. The rewrite above re-parses for the
> single-plan comment, which loses the original `terraformVersion`. To keep the
> single-plan comment byte-identical, instead call the existing `run()` /
> `runArch()` helpers for the `plans.length === 1` case (they already build the
> exact legacy body) and only use the per-plan loop for `multi`. Implement the
> single-plan branch by calling `run()`/`runArch()` exactly as the pre-change
> `main.ts` did, capturing `result.imageUrl` into `planUrls`/`archUrls` for the
> outputs. Use the loop above only when `multi` is true.

- [ ] **Step 2: Simplify per the note — single-plan delegates to `run`/`runArch`**

Restructure Step 1's code so that:
- `if (!multi)`: call `run(...)` and/or `runArch(...)` exactly as the original
  `main.ts` (Phase 1) did, pushing their `result.imageUrl` into `planUrls` /
  `archUrls`. Do not post a separate aggregated comment in this branch.
- `else` (multi): run the per-plan loop, collecting `planItems`/`archItems`, then
  post the aggregated comment(s).
- After both branches: set `image-url` (first), `image-urls` (JSON array of the
  active mode's URLs), and `arch-image-url` when applicable; mask every URL.

This keeps the single-plan path byte-identical (same `run`/`runArch` bodies) and
confines new behavior to the multi branch.

- [ ] **Step 3: Add the imports to `main.ts`**

Ensure these are imported near the existing `@burnmap/*` and `./` imports:

```ts
import { parsePlan } from '@burnmap/parser';
import { resolvePlans, planSlug } from './plans.js';
import { run, renderPlanImage } from './run.js';
import { runArch, renderArchImage } from './arch-run.js';
import { commentMarker, buildCommentBody, buildMultiCommentBody, type MultiCommentItem } from './comment.js';
import { archCommentMarker, buildArchCommentBody, buildArchMultiCommentBody } from './arch-comment.js';
```

(`parsePlan` is already imported in the current file; don't duplicate it.)

- [ ] **Step 4: Export new symbols from `index.ts`**

Add to `packages/action/src/index.ts`:

```ts
export { resolvePlans, planSlug, type ResolvedPlan } from './plans.js';
export { renderPlanImage, type RenderedImage } from './run.js';
export { renderArchImage, type RenderedArch } from './arch-run.js';
export { buildMultiCommentBody, type MultiCommentItem } from './comment.js';
export { buildArchMultiCommentBody } from './arch-comment.js';
```

- [ ] **Step 5: Add the `image-urls` output to `action.yml`**

Under `outputs:` add:

```yaml
  image-urls:
    description: JSON array of all presigned diagram URLs, in stable (lexicographic) order.
```

- [ ] **Step 6: Build and run the full action suite**

Run: `npm run build -w @burnmap/action && npm test -w @burnmap/action`
Expected: `tsc` compiles; all action tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/action/src/main.ts packages/action/src/index.ts action.yml
git commit -m "feat(action): multi-plan input — render each, aggregate comment, image-urls output"
```

---

# Change 2 — upload-only mode (`comment: false`)

Spec: `burnmap-changes/02-upload-only-mode.md`.

## Task 8: `comment` input gating

Gate all PR-discovery and comment work on a new `comment` input (default
`true`). When `false`: don't require a PR context or token, skip every comment
upsert, still upload and set outputs, and suppress the "no PR" failure.

**Files:**
- Modify: `packages/action/src/main.ts`
- Modify: `action.yml` (add `comment` input; relax `github-token` requirement)

**Interfaces:**
- Consumes: `core.getBooleanInput`.
- Produces: no new exported symbols; behavioral gate inside `main.ts`.

> Verified by the action build + suite and the manual smoke in Task 14. `main.ts`
> stays a thin wiring layer.

- [ ] **Step 1: Read and validate the `comment` input early in `main()`**

After the `mode` validation block, add:

```ts
  const wantComment = core.getBooleanInput('comment'); // defaults true via action.yml
```

- [ ] **Step 2: Relax token + PR requirements when `comment` is false**

Replace the current token read (`main.ts:26`) and the PR-number guard
(`main.ts:52-56`) with comment-gated versions:

```ts
  // Token is only needed to post a comment. In upload-only mode it is optional;
  // warn if supplied but unused.
  const token = wantComment
    ? core.getInput('github-token', { required: true })
    : core.getInput('github-token');
  if (!wantComment && token) {
    core.warning('burnmap: github-token is ignored when comment: false.');
  }

  const prNumber = context.payload.pull_request?.number ?? 0;
  if (wantComment && !prNumber) {
    core.setFailed('burnmap must run on a pull_request event to post a comment (set comment: false for upload-only).');
    return;
  }
```

- [ ] **Step 3: Only construct Octokit when commenting**

Replace the unconditional `const octokit = getOctokit(token);` with:

```ts
  const octokit = wantComment ? getOctokit(token) : undefined;
```

- [ ] **Step 4: Gate every `upsertStickyComment` call on `wantComment`**

In both the single-plan (`run`/`runArch`) and multi-plan branches:
- When `wantComment` is false, do **not** call `run()`/`runArch()` (they comment).
  Instead always use `renderPlanImage`/`renderArchImage` and skip the aggregated
  comment block.
- When `wantComment` is true, keep the Task 7 behavior (single → `run`/`runArch`;
  multi → render loop + aggregated comment).

Concretely, restructure the orchestration so the **render** always happens via
`renderPlanImage`/`renderArchImage` collecting URLs, and the **comment** is a
separate, `wantComment`-gated step:

```ts
  const wantPlan = mode === 'plan' || mode === 'both';
  const wantArch = mode === 'arch' || mode === 'both';
  // ... render loop fills planUrls/archUrls/planItems/archItems ...

  if (wantComment && octokit) {
    if (wantPlan) {
      const body = multi
        ? buildMultiCommentBody(prNumber, `${owner}/${repo}`, sha, planItems)
        : buildCommentBody(planModels[0]!, planUrls[0]!);
      await upsertStickyComment({ octokit, owner, repo, prNumber, marker: commentMarker(prNumber), body });
    }
    if (wantArch) {
      const body = multi
        ? buildArchMultiCommentBody(prNumber, `${owner}/${repo}`, sha, archItems)
        : buildArchCommentBody(archMetas[0]!, archUrls[0]!);
      await upsertStickyComment({ octokit, owner, repo, prNumber, marker: archCommentMarker(prNumber), body });
    }
  }
```

To make the single-plan comment byte-identical without re-parsing, have the
render loop also collect `planModels: ChangeModel[]` (from `renderPlanImage`'s
returned `model`) and `archMetas: ArchMeta[]` (from `renderArchImage`'s returned
`meta`). This supersedes the Task 7 "single delegates to `run()`" approach:
single-plan now renders via `renderPlanImage` and builds the legacy body from the
returned `model`, which carries the real `terraformVersion` — byte-identical to
`run()`'s body. Update the comment-gated block accordingly and drop the direct
`run()`/`runArch()` calls from `main.ts`.

- [ ] **Step 5: Add the `comment` input to `action.yml` and relax `github-token`**

Add under `inputs:`:

```yaml
  comment:
    description: "Post a sticky PR comment with the diagram(s). Set false for upload-only (no PR/token needed)."
    required: false
    default: "true"
```

Change the `github-token` input to drop the hard default-requirement framing
(keep the default token, but it is now optional in upload-only mode):

```yaml
  github-token:
    description: Token used to post the PR comment (unused when comment: false).
    required: false
    default: ${{ github.token }}
```

- [ ] **Step 6: Build and run the full action suite**

Run: `npm run build -w @burnmap/action && npm test -w @burnmap/action`
Expected: compiles; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/action/src/main.ts action.yml
git commit -m "feat(action): comment input enables upload-only mode"
```

---

# Change 3 — per-image captions

Spec: `burnmap-changes/03-image-captions.md`.

## Task 9: `resolveCaption` — caption source resolution

**Files:**
- Create: `packages/action/src/captions.ts`
- Test: `packages/action/test/captions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LabelsFrom = 'none' | 'filename' | 'path-parent' | 'relative-path'`
  - `function parseLabels(json: string): Record<string, string>` — parse the
    `labels` input; `''` → `{}`; malformed → throw with a clear message.
  - `function resolveCaption(rel: string, opts: { labelsFrom: LabelsFrom; labels: Record<string, string> }): string | undefined`
    — `labels[rel]` wins; else derive from `labelsFrom`; `none`/empty →
    `undefined`. Strips control chars/newlines; truncates to 80 chars + `…`
    (caller logs the full label).

- [ ] **Step 1: Write the failing test**

```ts
// packages/action/test/captions.test.ts
import { describe, it, expect } from 'vitest';
import { parseLabels, resolveCaption } from '../src/captions.js';

describe('parseLabels', () => {
  it('treats empty string as no labels', () => {
    expect(parseLabels('')).toEqual({});
  });
  it('parses a JSON object', () => {
    expect(parseLabels('{"a/plan.json":"A"}')).toEqual({ 'a/plan.json': 'A' });
  });
  it('throws on malformed JSON', () => {
    expect(() => parseLabels('{nope')).toThrow(/labels/i);
  });
});

describe('resolveCaption', () => {
  const L = (labels: Record<string, string> = {}, labelsFrom: any = 'none') => ({ labels, labelsFrom });

  it('returns undefined for none with no labels', () => {
    expect(resolveCaption('plans/net/plan.json', L())).toBeUndefined();
  });
  it('derives filename without extension', () => {
    expect(resolveCaption('plans/network.json', L({}, 'filename'))).toBe('network');
  });
  it('derives the parent directory name', () => {
    expect(resolveCaption('plans/network/plan.json', L({}, 'path-parent'))).toBe('network');
  });
  it('uses the full relative path', () => {
    expect(resolveCaption('plans/network/plan.json', L({}, 'relative-path'))).toBe('plans/network/plan.json');
  });
  it('lets explicit labels override labels-from', () => {
    expect(resolveCaption('plans/network/plan.json', L({ 'plans/network/plan.json': 'NET' }, 'path-parent'))).toBe('NET');
  });
  it('strips newlines/control chars', () => {
    expect(resolveCaption('x', L({ x: 'a\nb\tc' }, 'none'))).toBe('a b c');
  });
  it('truncates to 80 chars with an ellipsis', () => {
    const long = 'z'.repeat(200);
    const out = resolveCaption('x', L({ x: long }, 'none'))!;
    expect(out.length).toBe(81); // 80 chars + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
  it('treats an empty derived/explicit caption as none', () => {
    expect(resolveCaption('x', L({ x: '   ' }, 'none'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- captions`
Expected: FAIL — cannot find module `../src/captions.js`.

- [ ] **Step 3: Write `captions.ts`**

```ts
// packages/action/src/captions.ts
import path from 'node:path';

export type LabelsFrom = 'none' | 'filename' | 'path-parent' | 'relative-path';

const MAX = 80;

/** Parse the `labels` JSON-object input. Empty → {}. Malformed → throws. */
export function parseLabels(json: string): Record<string, string> {
  const trimmed = json.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`labels: invalid JSON object (${(err as Error).message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('labels: must be a JSON object of { "relative/path": "caption" }');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string') throw new Error(`labels: value for "${k}" must be a string`);
    out[k] = v;
  }
  return out;
}

function derive(rel: string, from: LabelsFrom): string {
  switch (from) {
    case 'filename': return path.basename(rel, '.json');
    case 'path-parent': return path.basename(path.dirname(rel));
    case 'relative-path': return rel;
    case 'none': default: return '';
  }
}

/** Clean control chars/newlines and truncate. */
function clean(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const oneLine = raw.replace(/[ -]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return oneLine.length > MAX ? `${oneLine.slice(0, MAX)}…` : oneLine;
}

/** Resolve the caption for one plan. labels[rel] wins over labels-from. */
export function resolveCaption(
  rel: string,
  opts: { labelsFrom: LabelsFrom; labels: Record<string, string> },
): string | undefined {
  const explicit = opts.labels[rel];
  const raw = explicit !== undefined ? explicit : derive(rel, opts.labelsFrom);
  return clean(raw);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- captions`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/action/src/captions.ts packages/action/test/captions.test.ts
git commit -m "feat(action): resolveCaption + parseLabels for per-plan captions"
```

---

## Task 10: `captionPng` in `@burnmap/shoot`

Composite a caption strip onto an existing PNG by wrapping it (as a data URI)
plus a caption `<div>` in HTML and screenshotting via the existing `capture`
pipeline. Uniform for plan and arch PNGs; no new image dependency.

**Files:**
- Create: `packages/shoot/src/caption.ts`
- Modify: `packages/shoot/src/index.ts`
- Test: `packages/shoot/test/caption.test.ts`

**Interfaces:**
- Consumes: `capture` (existing).
- Produces: `async function captionPng(png: Buffer, caption: string, outPath: string): Promise<string>`
  — writes a captioned PNG to `outPath` and returns it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shoot/test/caption.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captionPng } from '../src/caption.js';

// a 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const out = path.join(tmpdir(), `burnmap-caption-${process.pid}.png`);
afterAll(() => rmSync(out, { force: true }));

describe('captionPng', () => {
  it('produces a non-empty PNG with the caption composited', async () => {
    await captionPng(PNG, 'ec-dev / network', out);
    const bytes = readFileSync(out);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
  }, 30000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/shoot -- caption`
Expected: FAIL — cannot find module `../src/caption.js`.

- [ ] **Step 3: Write `caption.ts`**

```ts
// packages/shoot/src/caption.ts
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture } from './capture.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Composite a caption strip above an existing PNG and screenshot the result. */
export async function captionPng(png: Buffer, caption: string, outPath: string): Promise<string> {
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  // Caption strip: dark bg, light single-line sans-serif text, ~32px tall.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .captioned{display:inline-block;background:#1a1614}
    .cap{height:32px;line-height:32px;padding:0 12px;color:#e8d8cf;
      font:13px/32px "Noto Sans","DejaVu Sans",ui-sans-serif,system-ui,sans-serif;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #3a302b}
    .cap-img{display:block}
  </style></head><body>
  <div class="captioned"><div class="cap">${esc(caption)}</div>
  <img class="cap-img" src="${dataUri}"></div>
  <script>
    // signal readiness only once the embedded image has decoded
    const img = document.querySelector('.cap-img');
    if (img.complete) window.__BURNMAP_READY__ = true;
    else img.onload = () => { window.__BURNMAP_READY__ = true; };
  </script></body></html>`;

  const htmlPath = path.join(tmpdir(), `burnmap-caption-${process.pid}-${outPath.length}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  try {
    await capture({ shotHtmlPath: htmlPath, outPath, selector: '.captioned' });
    return outPath;
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
```

- [ ] **Step 4: Export it from `index.ts`**

Add to `packages/shoot/src/index.ts`:

```ts
export { captionPng } from './caption.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @burnmap/shoot -- caption`
Expected: PASS (1 test). Requires Playwright Chromium (already used by the
existing shoot tests); run `npx playwright install chromium` if missing.

- [ ] **Step 6: Commit**

```bash
git add packages/shoot/src/caption.ts packages/shoot/src/index.ts packages/shoot/test/caption.test.ts
git commit -m "feat(shoot): captionPng composites a caption strip onto a PNG"
```

---

## Task 11: Bundle caption fonts in the Docker image

The caption strip needs broad Unicode coverage that does not depend on
host fonts. Install Noto + DejaVu in the action image; the caption CSS already
references them first.

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Install fonts before `npm ci`**

Add after the `WORKDIR /burnmap` line (the Playwright jammy base is Debian/Ubuntu
with `apt-get`):

```dockerfile
# Fonts for caption rendering (broad Unicode coverage; don't rely on host fonts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Verify the image still builds (font layer + build order)**

Run (requires Docker; if Docker is unavailable, skip and note it in the PR):
```bash
docker build -t burnmap-caption-check .
```
Expected: build succeeds through the font install and the `npm run build` layer.

If Docker is unavailable in this environment, instead confirm the Dockerfile is
syntactically consistent and that the caption CSS font-family names match the
installed packages (`Noto Sans`, `DejaVu Sans`). Note the skipped Docker build in
the commit body.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build(docker): bundle Noto + DejaVu fonts for caption rendering"
```

---

## Task 12: Wire captions into `main.ts`

Resolve a caption per plan and, when present, composite it onto the rendered PNG
before upload. Pass the caption through to the multi-image comment headings.

**Files:**
- Modify: `packages/action/src/main.ts`
- Modify: `action.yml` (add `labels-from`, `labels` inputs)

**Interfaces:**
- Consumes: `resolveCaption`, `parseLabels`, `LabelsFrom` (Task 9), `captionPng`
  (Task 10).
- Produces: no new exports; behavior inside `main.ts`.

> Verified by the action build + suite and the Task 14 smoke (the per-plan
> caption resolution itself is unit-tested in Task 9; the compositing in Task 10).

- [ ] **Step 1: Read and validate the caption inputs in `main()`**

After the `comment` input read:

```ts
  const labelsFrom = (core.getInput('labels-from') || 'none') as LabelsFrom;
  const VALID_LABELS_FROM = ['none', 'filename', 'path-parent', 'relative-path'];
  if (!VALID_LABELS_FROM.includes(labelsFrom)) {
    core.setFailed(`labels-from must be one of ${VALID_LABELS_FROM.join(' | ')} (got "${labelsFrom}")`);
    return;
  }
  let labels: Record<string, string>;
  try {
    labels = parseLabels(core.getInput('labels'));
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
    return;
  }
```

- [ ] **Step 2: Warn about `labels` keys that match no resolved plan**

After `resolvePlans`:

```ts
  const relSet = new Set(plans.map((p) => p.rel));
  for (const key of Object.keys(labels)) {
    if (!relSet.has(key)) core.warning(`burnmap: labels key "${key}" matched no resolved plan.`);
  }
```

- [ ] **Step 3: Composite the caption onto each PNG before upload**

Inside the per-plan loop, compute the caption once and, when present, caption the
PNG produced by render before it is uploaded. Because `renderPlanImage` uploads
internally, move captioning ahead of upload by captioning in a `readPng` wrapper:
pass a `readPng` that, when a caption exists, runs `captionPng` on the freshly
captured PNG to a sibling path and returns those bytes.

```ts
      const caption = resolveCaption(plan.rel, { labelsFrom, labels });
      if (caption) core.info(`burnmap: caption for ${plan.rel}: ${caption}`);

      const readPngCaptioned = async (p: string): Promise<Buffer> => {
        const raw = readFileSync(p);
        if (!caption) return raw;
        const capPath = `${p}.cap.png`;
        tmpFiles.push(capPath);
        await captionPng(raw, caption, capPath);
        return readFileSync(capPath);
      };
```

`renderPlanImage`/`renderArchImage` call `deps.readPng(outPng)` synchronously
today. To allow async captioning, change `RunDeps.readPng` /
`ArchRunDeps.readPng` to return `Buffer | Promise<Buffer>` and `await` it at the
call site. Make that small change in `run.ts` and `arch-run.ts`:

```ts
// run.ts and arch-run.ts: in the deps interface
readPng: (path: string) => Buffer | Promise<Buffer>;
// at the upload call site
body: await deps.readPng(inputs.outPng),
```

Then in `main.ts` pass `readPng: readPngCaptioned` (per-plan) into the shared
deps. The existing unit-test mocks return a `Buffer` synchronously, which still
satisfies `Buffer | Promise<Buffer>` — no test changes needed.

- [ ] **Step 4: Thread the caption into comment items**

When pushing to `planItems` / `archItems`, include the caption:

```ts
        planItems.push({ rel: plan.rel, imageUrl: r.imageUrl, caption });
        // ...
        archItems.push({ rel: plan.rel, imageUrl: a.imageUrl, caption });
```

- [ ] **Step 5: Add the inputs to `action.yml`**

Under `inputs:`:

```yaml
  labels-from:
    description: "Auto-derive a per-image caption from the plan path: none | filename | path-parent | relative-path."
    required: false
    default: none
  labels:
    description: 'Explicit per-plan captions as a JSON object {"relative/path":"caption"}; overrides labels-from.'
    required: false
    default: ""
```

- [ ] **Step 6: Build and run the full action + shoot suites**

Run: `npm run build -w @burnmap/shoot -w @burnmap/action && npm test -w @burnmap/shoot -w @burnmap/action`
Expected: compiles; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/action/src/main.ts packages/action/src/run.ts packages/action/src/arch-run.ts action.yml
git commit -m "feat(action): bake per-plan captions into rendered PNGs"
```

---

## Task 13: Regression test — `none` caption is a no-op

Lock the byte-equivalence guarantee: with `labels-from: none` and no `labels`,
`resolveCaption` returns `undefined`, so no captioning runs and the PNG is
unchanged. (The PNG byte-equivalence itself is guaranteed by skipping
`captionPng` entirely; this test pins the decision point.)

**Files:**
- Modify: `packages/action/test/captions.test.ts`

- [ ] **Step 1: Add the regression test**

Append:

```ts
describe('caption no-op (regression)', () => {
  it('none + no labels yields undefined for every path shape', () => {
    const opts = { labelsFrom: 'none' as const, labels: {} };
    for (const rel of ['plan.json', 'a/plan.json', 'a/b/c/plan.json']) {
      expect(resolveCaption(rel, opts)).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npm test -w @burnmap/action -- captions`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/action/test/captions.test.ts
git commit -m "test(action): none caption is a no-op (byte-equivalence guard)"
```

---

## Task 14: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new inputs/outputs**

Add a section to `README.md` after the existing Inputs table (mirror the existing
table style):

```markdown
## Multiple plans, upload-only, and captions

`plan-json` accepts a single path **or** a glob (expanded inside the action):

    plan-json: 'plans/**/*.json'

Each resolved plan renders and uploads independently. Outputs:

- `image-url` — the first URL (lexicographic order).
- `image-urls` — a JSON array of all URLs in stable order. Parse with
  `fromJSON()` in a workflow.

Set `comment: false` for upload-only mode — burnmap uploads and returns
`image-urls` without touching the PR (no `pull-requests: write` or `github-token`
needed). Use this when your workflow composes its own comment from `image-urls`.

Add a caption strip to each PNG with `labels-from` (`none` default, `filename`,
`path-parent`, `relative-path`) or explicit `labels` (a JSON object keyed by the
plan path relative to the working directory, which overrides `labels-from`):

    labels-from: path-parent

    labels: |
      { "plans/ec-dev/network/plan.json": "ec-dev / network" }
```

- [ ] **Step 2: Run the entire test suite and build across all workspaces**

Run: `npm test && npm run build`
Expected: every package's tests PASS; all builds compile.

- [ ] **Step 3: End-to-end CLI smoke (arch SVG still works; non-action regression)**

Run:
```bash
npx tsx packages/graph/src/cli.ts packages/graph/test/fixtures/nested-modules.json --out /tmp/arch.svg --repo o/r --sha test
head -c 60 /tmp/arch.svg; echo
```
Expected: prints `/tmp/arch.svg`; the file starts with `<svg`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: multi-plan input, upload-only mode, and captions"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Change 1: glob expansion (Task 1), stable sort + symlink dedupe (Task 1),
    per-plan S3 key with path slug (Tasks 2–3), per-plan render without comment
    (Tasks 4–5), one aggregated comment (Task 6), `image-url`/`image-urls`
    outputs + zero-match failure + >25 warning (Task 7). Single-plan
    byte/key/comment identity preserved by the `!multi` branch (Tasks 7–8).
  - Change 2: `comment` input, token/PR relaxation, suppressed no-PR failure,
    upload-still-happens, token-unused warning (Task 8).
  - Change 3: `labels-from` + `labels` resolution and precedence, control-char
    stripping, truncation, malformed-JSON failure, unmatched-key warning
    (Tasks 9, 12), caption strip composited into the PNG (Task 10), bundled fonts
    for Unicode (Task 11), `none` no-op byte-equivalence (Task 13).
  - Docs for all three (Task 14). Prerequisite Docker build-order fix (Task 0).
- **Placeholder scan:** every code step contains complete code; no TBD/TODO.
  Task 7 Step 1 shows a first-cut orchestration and Step 2 explicitly supersedes
  it with the simpler single/multi split; Task 8 Step 4 further consolidates
  rendering through `renderPlanImage`/`renderArchImage` and collects
  `planModels`/`archMetas` so single-plan comments stay byte-identical without
  re-parsing. Implement the Task 8 form (it is the final shape).
- **Type consistency:** `s3Key` gains optional `slug` (Task 2), used by
  `renderPlanImage`/`renderArchImage` (Tasks 4–5) and `main.ts` (Task 7).
  `MultiCommentItem { rel, imageUrl, caption? }` defined in Task 6, consumed in
  Tasks 7 and 12. `RenderedImage.model` / `RenderedArch.meta` (Tasks 4–5) feed
  the single-plan legacy comment bodies in Task 8. `LabelsFrom` (Task 9) used in
  Task 12. `readPng` widened to `Buffer | Promise<Buffer>` in Task 12 across
  `run.ts`/`arch-run.ts`; existing mocks returning `Buffer` remain valid.
- **Known intentional limits (documented):** no combined-diagram mode (per-plan
  only); captions are single-line, top-strip only; arch-mode `image-urls` returns
  arch URLs (plan/both modes return plan URLs as the primary list).
```
