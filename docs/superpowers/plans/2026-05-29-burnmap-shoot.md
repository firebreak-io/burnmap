# burnmap Shoot (`@burnmap/shoot`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@burnmap/shoot` — a Playwright harness that loads the built `@burnmap/web` SPA from disk with an injected `ChangeModel`, waits for `window.__BURNMAP_READY__`, and screenshots the diagram to a PNG. Includes two small `@burnmap/web` hardenings the screenshot contract depends on (relative asset paths; an error boundary so READY always fires).

**Architecture:** Pure, unit-tested helpers (`buildShotHtml` HTML injector, `resolveWebDist`, `writeShotHtml`) plus one browser-driving function (`capture`) and a CLI that reuses `@burnmap/parser`'s `parsePlan`. The web app is built static (Vite, `base:'./'`) so it loads under `file://`; shoot injects `window.__BURNMAP_DATA__` into the built HTML before the bundle runs.

**Tech Stack:** TypeScript (ESM), Playwright (chromium), Vitest. Depends on `@burnmap/parser` and `@burnmap/web` (workspace). Node 22.

**Spec:** `docs/superpowers/specs/2026-05-29-burnmap-plan-visualizer-design.md` (the `shoot` step + Approach 1).
**Depends on:** Phase 1 (`@burnmap/parser`) and Phase 2 (`@burnmap/web`), both complete on this branch's ancestry.

---

## Scope notes

- **No exact-pixel visual-regression baseline.** Cross-platform/font differences make pixel-diff screenshots flaky; the spec's "visual regression" need is already met by Phase 2's deterministic **DOM snapshot**. Phase 3's browser test instead asserts the output is a **valid PNG of the expected dimensions** (magic bytes + width), which is stable across environments. This is a deliberate, documented departure from a literal pixel baseline.
- **Two `@burnmap/web` changes live here** because the screenshot contract owns them (per the Phase 2 final-review note): relative asset base (`base:'./'`) and an `ErrorBoundary` so `__BURNMAP_READY__` fires even if a malformed model is injected. They are small and tested.
- `capture` bounds the READY wait with a timeout and throws a clear error if it never fires — a render failure produces a loud error, never a hang.

## File structure (this phase)

```
packages/web/
  vite.config.ts                 # MODIFY: add base: './'
  src/components/ErrorBoundary.tsx   # NEW
  src/main.tsx                   # MODIFY: wrap <App> in <ErrorBoundary>
  test/ErrorBoundary.test.tsx    # NEW
packages/shoot/
  package.json                   # @burnmap/shoot
  tsconfig.json
  vitest.config.ts
  src/
    html.ts                      # buildShotHtml() — inject window.__BURNMAP_DATA__
    web-dist.ts                  # resolveWebDist(), writeShotHtml(), cleanupShotHtml()
    capture.ts                   # capture() — Playwright screenshot
    cli.ts                       # burnmap-shoot CLI (parse plan → model → png)
    index.ts                     # public exports
  test/
    html.test.ts
    web-dist.test.ts
    capture.test.ts              # browser test (needs chromium)
    cli.test.ts                  # browser test (needs chromium)
```

---

## Task 1: Web — relative asset base for `file://` loading

**Files:**
- Modify: `packages/web/vite.config.ts`

- [ ] **Step 1: Set the relative base**

Replace the contents of `packages/web/vite.config.ts` with:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app loads from a file:// path (the shoot harness
  // opens dist/index.html directly rather than via a web server).
  base: './',
  build: { outDir: 'dist' },
});
```

- [ ] **Step 2: Rebuild and verify asset refs are now relative**

Run: `cd packages/web && npm run build && grep -oE '(src|href)="[^"]*"' dist/index.html`
Expected: paths now begin with `./assets/...` (not `/assets/...`).

- [ ] **Step 3: Confirm tests still pass**

Run: `cd packages/web && npx vitest run`
Expected: 30 passed (the DOM snapshot is unaffected by the build base).

- [ ] **Step 4: Commit**

```bash
git add packages/web/vite.config.ts
git commit -m "fix(web): relative asset base so the built app loads under file://"
```

---

## Task 2: Web — ErrorBoundary so READY always fires

If a malformed model is ever injected, App render throws; an error boundary renders a visible fallback so the tree still mounts and `markReady` (scheduled in main.tsx) fires — the screenshot harness gets an error card, never a hang.

**Files:**
- Create: `packages/web/src/components/ErrorBoundary.tsx`
- Modify: `packages/web/src/main.tsx`
- Test: `packages/web/test/ErrorBoundary.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/test/ErrorBoundary.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders children when there is no error', () => {
    render(<ErrorBoundary><p>hello</p></ErrorBoundary>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders a fallback card (not a crash) when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // silence React error log
    const { container } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(container.querySelector('.card')).not.toBeNull();
    expect(screen.getByText(/failed to render/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/ErrorBoundary.test.tsx`
Expected: FAIL — cannot resolve `../src/components/ErrorBoundary`.

- [ ] **Step 3: Write the implementation**

`packages/web/src/components/ErrorBoundary.tsx`:
```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

/**
 * Catches render errors (e.g. a malformed injected model) and shows a visible
 * error card instead of an empty crash. This keeps the DOM stable so the
 * screenshot harness captures something and the READY signal still fires.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for debugging; render path already handled.
    console.error('burnmap render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="wrap">
          <div className="card">
            <div className="body">
              <p className="reason">burnmap failed to render this plan: {this.state.error.message}</p>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/ErrorBoundary.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wrap App in the boundary**

In `packages/web/src/main.tsx`, change the render call. Replace:
```tsx
createRoot(container).render(
  <StrictMode>
    <App model={model} />
  </StrictMode>,
);
```
with:
```tsx
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App model={model} />
    </ErrorBoundary>
  </StrictMode>,
);
```
And add this import near the other component imports at the top of `main.tsx`:
```tsx
import { ErrorBoundary } from './components/ErrorBoundary';
```

- [ ] **Step 6: Full web suite + build**

Run: `cd packages/web && npx vitest run && npm run build`
Expected: 32 tests pass; build clean.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/ErrorBoundary.tsx packages/web/src/main.tsx packages/web/test/ErrorBoundary.test.tsx
git commit -m "feat(web): error boundary so a bad model renders an error card, not a hang"
```

---

## Task 3: Scaffold `@burnmap/shoot` + install chromium

**Files:**
- Create: `packages/shoot/package.json`
- Create: `packages/shoot/tsconfig.json`
- Create: `packages/shoot/vitest.config.ts`

- [ ] **Step 1: Create the package manifest**

`packages/shoot/package.json`:
```json
{
  "name": "@burnmap/shoot",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "burnmap-shoot": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@burnmap/parser": "*",
    "@burnmap/web": "*",
    "playwright": "^1.60.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`packages/shoot/tsconfig.json`:
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

`packages/shoot/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000, // browser tests need headroom
    hookTimeout: 30000,
  },
});
```

- [ ] **Step 4: Install workspace deps + the chromium browser**

Run: `npm install`
Then: `npx playwright install chromium`
Expected: deps install; chromium downloads (~150 MB) with "is already installed" or a success message.

- [ ] **Step 5: Commit**

```bash
git add packages/shoot/package.json packages/shoot/tsconfig.json packages/shoot/vitest.config.ts package-lock.json
git commit -m "chore(shoot): scaffold @burnmap/shoot (playwright + vitest)"
```

---

## Task 4: `buildShotHtml` — safe data injection

**Files:**
- Create: `packages/shoot/src/html.ts`
- Test: `packages/shoot/test/html.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shoot/test/html.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildShotHtml } from '../src/html.js';

const BUILT = `<!DOCTYPE html><html><head><title>burnmap</title></head>` +
  `<body><div id="root"></div><script type="module" crossorigin src="./assets/index-abc.js"></script></body></html>`;

describe('buildShotHtml', () => {
  it('injects window.__BURNMAP_DATA__ before the module script', () => {
    const out = buildShotHtml(BUILT, { summary: { create: 1 } });
    expect(out).toContain('window.__BURNMAP_DATA__ = {"summary":{"create":1}};');
    // injected before the bundle so it runs first
    expect(out.indexOf('__BURNMAP_DATA__')).toBeLessThan(out.indexOf('<script type="module"'));
    // bundle reference preserved
    expect(out).toContain('./assets/index-abc.js');
  });

  it('escapes < so a value containing </script> cannot break out', () => {
    const out = buildShotHtml(BUILT, { evil: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script><script>alert(1)');
    expect(out).toContain('\\u003c/script>'); // escaped form present
  });

  it('throws if the built HTML has no module script tag', () => {
    expect(() => buildShotHtml('<html><head></head><body></body></html>', {})).toThrow(/module script/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shoot && npx vitest run test/html.test.ts`
Expected: FAIL — cannot resolve `../src/html.js`.

- [ ] **Step 3: Write the implementation**

`packages/shoot/src/html.ts`:
```ts
const MODULE_SCRIPT = '<script type="module"';

/**
 * Insert `window.__BURNMAP_DATA__ = <model>` as an inline script immediately
 * before the app's module bundle, so the data exists when the bundle runs.
 * `<` is escaped to `<` so a string value containing `</script>` cannot
 * break out of the inline script.
 */
export function buildShotHtml(builtHtml: string, model: unknown): string {
  const idx = builtHtml.indexOf(MODULE_SCRIPT);
  if (idx === -1) {
    throw new Error('buildShotHtml: no module script tag found in built HTML');
  }
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const inject = `<script>window.__BURNMAP_DATA__ = ${json};</script>`;
  return builtHtml.slice(0, idx) + inject + builtHtml.slice(idx);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shoot && npx vitest run test/html.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shoot/src/html.ts packages/shoot/test/html.test.ts
git commit -m "feat(shoot): buildShotHtml safe data injector"
```

---

## Task 5: `resolveWebDist`, `writeShotHtml`, `cleanupShotHtml`

**Files:**
- Create: `packages/shoot/src/web-dist.ts`
- Test: `packages/shoot/test/web-dist.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shoot/test/web-dist.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveWebDist, writeShotHtml, cleanupShotHtml, SHOT_HTML_NAME } from '../src/web-dist.js';

const tmps: string[] = [];
function fakeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'burnmap-dist-'));
  tmps.push(dir);
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!DOCTYPE html><html><head></head><body><div id="root"></div>' +
      '<script type="module" src="./assets/app.js"></script></body></html>',
    'utf8',
  );
  return dir;
}

afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('resolveWebDist', () => {
  it('points at the built @burnmap/web dist directory containing index.html', () => {
    const dist = resolveWebDist();
    expect(dist.endsWith(path.join('web', 'dist'))).toBe(true);
    expect(existsSync(path.join(dist, 'index.html'))).toBe(true); // requires web to be built
  });
});

describe('writeShotHtml / cleanupShotHtml', () => {
  it('writes the injected HTML into the dist dir and removes it on cleanup', () => {
    const dist = fakeDist();
    const out = writeShotHtml(dist, { summary: { create: 2 } });
    expect(out).toBe(path.join(dist, SHOT_HTML_NAME));
    expect(readFileSync(out, 'utf8')).toContain('window.__BURNMAP_DATA__ = {"summary":{"create":2}};');
    cleanupShotHtml(dist);
    expect(existsSync(out)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shoot && npx vitest run test/web-dist.test.ts`
Expected: FAIL — cannot resolve `../src/web-dist.js`.

> If `resolveWebDist`'s assertion fails because `@burnmap/web` is not built, run `npm run build -w @burnmap/web` first. The web build is a prerequisite of this package.

- [ ] **Step 3: Write the implementation**

`packages/shoot/src/web-dist.ts`:
```ts
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildShotHtml } from './html.js';

/** Filename for the temporary injected HTML, written inside dist so ./assets resolve. */
export const SHOT_HTML_NAME = '__burnmap_shot.html';

/** Absolute path to the built @burnmap/web dist directory. */
export function resolveWebDist(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve('@burnmap/web/package.json');
  return path.join(path.dirname(pkgJson), 'dist');
}

/** Write the injected HTML into the dist dir; returns its absolute path. */
export function writeShotHtml(webDist: string, model: unknown): string {
  let builtHtml: string;
  try {
    builtHtml = readFileSync(path.join(webDist, 'index.html'), 'utf8');
  } catch {
    throw new Error(
      `writeShotHtml: @burnmap/web build not found at ${webDist} — run "npm run build -w @burnmap/web" first`,
    );
  }
  const outPath = path.join(webDist, SHOT_HTML_NAME);
  writeFileSync(outPath, buildShotHtml(builtHtml, model), 'utf8');
  return outPath;
}

/** Remove the temporary injected HTML (best-effort). */
export function cleanupShotHtml(webDist: string): void {
  rmSync(path.join(webDist, SHOT_HTML_NAME), { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shoot && npm run build -w @burnmap/web >/dev/null 2>&1; cd packages/shoot && npx vitest run test/web-dist.test.ts`
(Equivalently: ensure `@burnmap/web` is built, then run the test from `packages/shoot`.)
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shoot/src/web-dist.ts packages/shoot/test/web-dist.test.ts
git commit -m "feat(shoot): resolve web dist + write/cleanup injected shot HTML"
```

---

## Task 6: `capture` — Playwright screenshot (browser test)

**Files:**
- Create: `packages/shoot/src/capture.ts`
- Test: `packages/shoot/test/capture.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shoot/test/capture.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture } from '../src/capture.js';
import { resolveWebDist, writeShotHtml, cleanupShotHtml } from '../src/web-dist.js';

const outDir = mkdtempSync(path.join(tmpdir(), 'burnmap-shot-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

// A minimal-but-valid ChangeModel — avoids importing web's source across packages.
const model = {
  meta: { repo: 'firebreak-io/infra', prNumber: 1, commitSha: 'abc', terraformVersion: '1.12.1', generatedAt: '2026-05-29T00:00:00Z' },
  summary: { create: 1, update: 0, delete: 0, replace: 0, noop: 0, read: 0 },
  modules: [
    { module: '', types: [{ type: 'aws_s3_bucket', resources: [
      { address: 'aws_s3_bucket.logs', module: '', type: 'aws_s3_bucket', name: 'logs', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
    ] }] },
  ],
  outputs: [],
};

// PNG magic number: 89 50 4E 47 0D 0A 1A 0A
function isPng(buf: Buffer): boolean {
  return buf.length > 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

describe('capture', () => {
  it('screenshots the rendered diagram to a valid PNG', async () => {
    const webDist = resolveWebDist();
    const shotHtml = writeShotHtml(webDist, model);
    const outPath = path.join(outDir, 'shot.png');
    try {
      const result = await capture({ shotHtmlPath: shotHtml, outPath });
      expect(result).toBe(outPath);
      const buf = readFileSync(outPath);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(1000); // non-trivial image
    } finally {
      cleanupShotHtml(webDist);
    }
  });

  it('throws a clear error if READY never fires (bad html, short timeout)', async () => {
    const webDist = resolveWebDist();
    // write an HTML with no bundle so READY is never set
    const path2 = path.join(webDist, '__burnmap_never_ready.html');
    rmSync(path2, { force: true });
    const fs = await import('node:fs');
    fs.writeFileSync(path2, '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    try {
      await expect(capture({ shotHtmlPath: path2, outPath: path.join(outDir, 'x.png'), readyTimeoutMs: 1500 }))
        .rejects.toThrow(/ready/i);
    } finally {
      rmSync(path2, { force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shoot && npx vitest run test/capture.test.ts`
Expected: FAIL — cannot resolve `../src/capture.js`.

- [ ] **Step 3: Write the implementation**

`packages/shoot/src/capture.ts`:
```ts
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

export interface CaptureOptions {
  /** Absolute path to the injected HTML file (inside the web dist dir). */
  shotHtmlPath: string;
  /** Where to write the PNG. */
  outPath: string;
  /** Render width in CSS px (the card maxes at 720 + padding). */
  width?: number;
  /** How long to wait for window.__BURNMAP_READY__ before failing. */
  readyTimeoutMs?: number;
  /** Element to screenshot. */
  selector?: string;
}

/** Load the built SPA, wait for READY, and screenshot the diagram to a PNG. */
export async function capture(opts: CaptureOptions): Promise<string> {
  const {
    shotHtmlPath, outPath, width = 760, readyTimeoutMs = 15000, selector = '.card',
  } = opts;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      deviceScaleFactor: 2, // crisp output
    });
    await page.goto(pathToFileURL(shotHtmlPath).href);
    try {
      await page.waitForFunction(
        () => (window as unknown as { __BURNMAP_READY__?: boolean }).__BURNMAP_READY__ === true,
        undefined,
        { timeout: readyTimeoutMs },
      );
    } catch {
      throw new Error(
        `capture: page never signalled __BURNMAP_READY__ within ${readyTimeoutMs}ms (${shotHtmlPath})`,
      );
    }
    await page.locator(selector).first().screenshot({ path: outPath });
    return outPath;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shoot && npx vitest run test/capture.test.ts`
Expected: PASS (2 tests). First run launches chromium; allow time.

- [ ] **Step 5: Commit**

```bash
git add packages/shoot/src/capture.ts packages/shoot/test/capture.test.ts
git commit -m "feat(shoot): capture() — playwright screenshot with bounded READY wait"
```

---

## Task 7: CLI `burnmap-shoot` + public exports

**Files:**
- Create: `packages/shoot/src/cli.ts`
- Create: `packages/shoot/src/index.ts`
- Test: `packages/shoot/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shoot/test/cli.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'burnmap-cli-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const PLAN = {
  format_version: '1.2',
  terraform_version: '1.12.1',
  resource_changes: [
    {
      address: 'aws_s3_bucket.logs', mode: 'managed', type: 'aws_s3_bucket', name: 'logs',
      provider_name: 'registry.terraform.io/hashicorp/aws',
      change: { actions: ['create'], before: null, after: { bucket: 'logs' } },
    },
  ],
  output_changes: {},
};

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

describe('burnmap-shoot cli', () => {
  it('parses a plan json and writes a PNG', () => {
    const planPath = path.join(work, 'plan.json');
    const outPath = path.join(work, 'out.png');
    writeFileSync(planPath, JSON.stringify(PLAN), 'utf8');

    execFileSync('npx', ['tsx', cli, planPath, '--out', outPath, '--repo', 'firebreak-io/infra', '--pr', '7', '--sha', 'deadbee'], {
      encoding: 'utf8', env: { ...process.env },
    });

    expect(existsSync(outPath)).toBe(true);
    expect(isPng(readFileSync(outPath))).toBe(true);
  });

  it('exits non-zero when --out is missing', () => {
    const planPath = path.join(work, 'plan2.json');
    writeFileSync(planPath, JSON.stringify(PLAN), 'utf8');
    expect(() => execFileSync('npx', ['tsx', cli, planPath], { encoding: 'utf8' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shoot && npx vitest run test/cli.test.ts`
Expected: FAIL — cannot find `../src/cli.ts`.

- [ ] **Step 3: Write the implementations**

`packages/shoot/src/cli.ts`:
```ts
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlan, type RawPlan, type ChangeMeta } from '@burnmap/parser';
import { resolveWebDist, writeShotHtml, cleanupShotHtml } from './web-dist.js';
import { capture } from './capture.js';

interface Flags {
  planPath?: string;
  out?: string;
  repo: string;
  pr: number;
  sha: string;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { repo: '', pr: 0, sha: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--out': flags.out = argv[++i]; break;
      case '--repo': flags.repo = argv[++i] ?? ''; break;
      case '--pr': {
        const v = argv[++i];
        flags.pr = v === undefined ? Number.NaN : Number(v);
        break;
      }
      case '--sha': flags.sha = argv[++i] ?? ''; break;
      default:
        if (!arg.startsWith('--')) flags.planPath = arg;
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.planPath || !flags.out) {
    process.stderr.write('usage: burnmap-shoot <plan.json> --out <file.png> [--repo R] [--pr N] [--sha S]\n');
    process.exit(2);
  }
  if (Number.isNaN(flags.pr)) {
    process.stderr.write('error: --pr requires a numeric value\n');
    process.exit(2);
  }

  let plan: RawPlan;
  try {
    plan = JSON.parse(readFileSync(flags.planPath, 'utf8')) as RawPlan;
  } catch (err) {
    process.stderr.write(`error: cannot read plan ${flags.planPath}: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const meta: ChangeMeta = {
    repo: flags.repo,
    prNumber: flags.pr,
    commitSha: flags.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  const model = parsePlan(plan, meta);
  const webDist = resolveWebDist();
  const shotHtml = writeShotHtml(webDist, model);
  try {
    await capture({ shotHtmlPath: shotHtml, outPath: flags.out });
    process.stdout.write(`${flags.out}\n`);
  } finally {
    cleanupShotHtml(webDist);
  }
}

main().catch((err: Error) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
```

`packages/shoot/src/index.ts`:
```ts
export { buildShotHtml } from './html.js';
export { resolveWebDist, writeShotHtml, cleanupShotHtml, SHOT_HTML_NAME } from './web-dist.js';
export { capture, type CaptureOptions } from './capture.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shoot && npx vitest run test/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + build**

Run: `cd packages/shoot && npx vitest run && npm run build`
Expected: all shoot tests pass; `dist/` produced with `cli.js`, `index.js`, `capture.js`, `html.js`, `web-dist.js` + `.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/shoot/src/cli.ts packages/shoot/src/index.ts packages/shoot/test/cli.test.ts
git commit -m "feat(shoot): burnmap-shoot CLI (plan json → png) reusing parsePlan"
```

---

## Self-review notes (author)

- **Spec coverage:** load built SPA from disk (Approach 1) — `web-dist.ts` + `base:'./'` (Tasks 1/5). Inject `window.__BURNMAP_DATA__` — `html.ts` (Task 4). Wait for `window.__BURNMAP_READY__` then screenshot — `capture.ts` (Task 6). PNG output — Tasks 6/7. CLI reusing the parser — Task 7. READY-always-fires hardening (from Phase 2 final review) — ErrorBoundary (Task 2) + bounded READY timeout (Task 6).
- **Pixel visual-regression intentionally omitted** (Scope notes) — flaky cross-platform; Phase 2 DOM snapshot is the regression guard. Browser tests assert valid-PNG + non-trivial size instead.
- **Type consistency:** `capture(CaptureOptions)`, `writeShotHtml(webDist, model)`, `buildShotHtml(builtHtml, model)`, `resolveWebDist()`, `cleanupShotHtml(webDist)` signatures are consistent across Tasks 4–7. CLI reuses `parsePlan`, `RawPlan`, `ChangeMeta` from `@burnmap/parser` (real exports verified in Phase 1).
- **Out of this phase:** S3 upload + presign and the GitHub sticky comment are Phase 4 (`@burnmap/action`). `capture` returns a local PNG path; Phase 4 consumes it.
- **Browser dependency:** Tasks 6–7 require `npx playwright install chromium` (Task 3 Step 4). These tests are slower; the vitest config raises timeouts to 30s.

---

## Next phase

After this plan is executed and green, **Phase 4 — `@burnmap/action`**: the GitHub Action that runs `tofu show -json` → parse → shoot → upload the PNG to S3 (private, short-TTL presigned URL) → create/update the sticky PR comment, plus the OpenTofu for the bucket/OIDC role.
