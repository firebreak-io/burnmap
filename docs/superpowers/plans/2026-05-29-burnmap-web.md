# burnmap Web (`@burnmap/web`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@burnmap/web` — a static React + Vite SPA that renders a `@burnmap/parser` `ChangeModel` as the approved hybrid diff view (danger index up top + single-source detail in place), driven by an injected `window.__BURNMAP_DATA__`, and signals `window.__BURNMAP_READY__` once settled so it can be screenshotted deterministically.

**Architecture:** A small set of focused, prop-driven React components composed by `App`. All decision logic (what's high-risk, how to format an attribute) lives in pure, unit-tested view-model helpers — components only render. Data enters once via `window.__BURNMAP_DATA__` (falling back to a bundled sample in dev). The exact visual design is the approved mockup; its CSS is reproduced verbatim as `theme.css`.

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest + jsdom + @testing-library/react. Consumes types from the already-built `@burnmap/parser` workspace package.

**Spec:** `docs/superpowers/specs/2026-05-29-burnmap-plan-visualizer-design.md` (see "Visual design").
**Approved mockup to reproduce:** `.superpowers/brainstorm/76713-1780033952/content/hybrid.html`.

---

## Scope notes

- **Pixel visual-regression is deferred to Phase 3 (`@burnmap/shoot`)**, which owns the Playwright browser infra and drives the *built* SPA. Phase 2's regression guard is a deterministic **DOM snapshot** of the full render (Task 8). This keeps Phase 2 hermetic (no browser download) and avoids duplicating Playwright setup. The `window.__BURNMAP_READY__` signal is established here (Task 9) because it is the SPA's responsibility; Phase 3 will consume it.
- The web app consumes only **types** from `@burnmap/parser` (it renders a `ChangeModel`; it does not parse). Import with `import type { ... } from '@burnmap/parser'`.

## File structure (this phase)

```
packages/web/
  package.json                 # @burnmap/web
  tsconfig.json
  vite.config.ts               # build config
  vitest.config.ts             # jsdom + setup
  test/setup.ts                # @testing-library/jest-dom
  index.html                   # Vite entry; loads main.tsx
  src/
    theme.css                  # design tokens + all diagram styles (from mockup)
    glyphs.ts                  # ACTION_GLYPH / ACTION_LABEL / ACTION_KIND maps
    model-view.ts              # pure view helpers: isHighRisk, highRiskList, formatAttr, relativeAddress, formatValue
    sample-data.ts             # a typed sample ChangeModel for dev + tests
    ready.ts                   # markReady(win) — sets the screenshot-ready flag
    main.tsx                   # entry: read window data (or sample), mount App, signal ready
    components/
      SummaryPills.tsx
      DangerIndex.tsx
      ResourceRow.tsx
      ModuleGroupView.tsx
      Outputs.tsx
      App.tsx
  test/
    model-view.test.ts
    glyphs.test.ts
    sample-data.test.ts
    SummaryPills.test.tsx
    ResourceRow.test.tsx
    DangerIndex.test.tsx
    ModuleGroupView.test.tsx
    Outputs.test.tsx
    App.test.tsx
    ready.test.ts
```

**Responsibilities:** `model-view.ts` + `glyphs.ts` hold all logic and are pure. Each component renders one piece of the view from props. `main.tsx`/`ready.ts` are the only files touching `window`/DOM bootstrapping.

---

## Task 1: Scaffold `@burnmap/web`

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/test/setup.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/theme.css`

- [ ] **Step 1: Create the package manifest**

`packages/web/package.json`:
```json
{
  "name": "@burnmap/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@burnmap/parser": "*"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create the Vite config**

`packages/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
});
```

- [ ] **Step 4: Create the Vitest config + test setup**

`packages/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
```

`packages/web/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create the Vite HTML entry**

`packages/web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>burnmap</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create the theme stylesheet (reproduced from the approved mockup)**

`packages/web/src/theme.css`:
```css
:root {
  --bg: #0d1117; --panel: #161b22; --panel2: #1c2230; --border: #30363d;
  --text: #e6edf3; --muted: #8b949e;
  --create: #3fb950; --update: #d29922; --replace: #db6d28; --destroy: #f85149;
  --create-bg: rgba(63,185,80,.12); --update-bg: rgba(210,153,34,.12);
  --replace-bg: rgba(219,109,40,.14); --destroy-bg: rgba(248,81,73,.14);
}
* { box-sizing: border-box; }
body {
  margin: 0; background: #010409; color: var(--text);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  padding: 28px;
}
.wrap { max-width: 720px; margin: 0 auto; }
.card { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--bg); }
.card-head {
  display: flex; align-items: center; gap: 10px; padding: 14px 18px;
  background: var(--panel); border-bottom: 1px solid var(--border);
}
.brand { font-weight: 700; letter-spacing: .02em; }
.brand .spark { color: var(--replace); }
.ctx { margin-left: auto; color: var(--muted); font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
.body { padding: 16px 18px; }

.summary { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px;
  border-radius: 999px; font-weight: 600; font-size: 12.5px; border: 1px solid var(--border);
}
.pill .n { font-variant-numeric: tabular-nums; }
.pill.create { color: var(--create); background: var(--create-bg); border-color: var(--create); }
.pill.update { color: var(--update); background: var(--update-bg); border-color: var(--update); }
.pill.replace { color: var(--replace); background: var(--replace-bg); border-color: var(--replace); }
.pill.destroy { color: var(--destroy); background: var(--destroy-bg); border-color: var(--destroy); }

.index {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  border: 1px solid var(--destroy); background: var(--destroy-bg); border-radius: 9px;
  padding: 9px 12px; margin-bottom: 18px;
}
.index .lbl { color: var(--destroy); font-weight: 700; font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
.chip {
  font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; text-decoration: none;
  padding: 4px 9px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel2); color: var(--text);
}
.chip:hover { border-color: #58a6ff; }
.chip .tag { font-weight: 700; margin-right: 5px; }
.chip .tag.r { color: var(--replace); }
.chip .tag.d { color: var(--destroy); }

.group { margin-bottom: 14px; }
.group-h {
  font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  margin: 0 0 7px; font-weight: 700; display: flex; gap: 8px; align-items: center;
}
.group-h .cnt { color: var(--border); }

.row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
  background: var(--panel); border: 1px solid var(--border);
}
.glyph {
  width: 20px; height: 20px; border-radius: 5px; flex: 0 0 auto; display: flex; align-items: center;
  justify-content: center; font-weight: 800; font-size: 13px; color: #010409;
}
.g-create { background: var(--create); } .g-update { background: var(--update); }
.g-replace { background: var(--replace); } .g-destroy { background: var(--destroy); }
.addr { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
.addr .type { color: var(--muted); }
.badge {
  margin-left: auto; font-size: 10.5px; font-weight: 700; padding: 3px 7px; border-radius: 5px;
  text-transform: uppercase; letter-spacing: .04em;
}
.badge.force { background: var(--replace-bg); color: var(--replace); border: 1px solid var(--replace); }
.badge.del { background: var(--destroy-bg); color: var(--destroy); border: 1px solid var(--destroy); }

.item { margin-bottom: 6px; border-left: 3px solid transparent; }
.item.hot {
  border-left: 3px solid var(--destroy); border-radius: 8px;
  background: linear-gradient(90deg, var(--destroy-bg), transparent 60%);
}
.item.hot .row { background: transparent; border: none; border-radius: 0; }
.detail { padding: 2px 10px 9px 40px; }
.reason { color: var(--destroy); font-size: 11.5px; margin: 0 0 6px; }
.attr { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; color: var(--muted); margin: 2px 0; }
.attr .k { color: var(--text); }
.attr .was { color: var(--destroy); }
.attr .now { color: var(--create); }
.attr .forces { color: var(--replace); font-weight: 600; }
.more { color: var(--muted); font-size: 11.5px; margin-left: 40px; padding-bottom: 6px; }

.outputs { margin-top: 4px; }
.out-action { margin-left: auto; color: var(--muted); font-size: 11.5px; }
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: installs React/Vite/testing deps; `@burnmap/parser` is linked from the workspace. No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/web/package.json packages/web/tsconfig.json packages/web/vite.config.ts packages/web/vitest.config.ts packages/web/test/setup.ts packages/web/index.html packages/web/src/theme.css package-lock.json
git commit -m "chore(web): scaffold @burnmap/web (vite + react + vitest)"
```

---

## Task 2: View-model helpers + glyph maps

**Files:**
- Create: `packages/web/src/glyphs.ts`
- Create: `packages/web/src/model-view.ts`
- Test: `packages/web/test/glyphs.test.ts`
- Test: `packages/web/test/model-view.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/web/test/glyphs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ACTION_GLYPH, ACTION_LABEL, ACTION_KIND } from '../src/glyphs';

describe('glyph maps', () => {
  it('maps every action to a glyph, label, and css kind', () => {
    expect(ACTION_GLYPH.create).toBe('+');
    expect(ACTION_GLYPH.update).toBe('~');
    expect(ACTION_GLYPH.replace).toBe('±');
    expect(ACTION_GLYPH.delete).toBe('×');
    expect(ACTION_LABEL.delete).toBe('destroy');
    expect(ACTION_LABEL.replace).toBe('replace');
    // css "kind" token drives color classes; delete renders as the "destroy" palette
    expect(ACTION_KIND.delete).toBe('destroy');
    expect(ACTION_KIND.create).toBe('create');
  });
});
```

`packages/web/test/model-view.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  HIGH_RISK_THRESHOLD, isHighRisk, highRiskList, formatValue, formatAttr, relativeAddress, MAX_VALUE_LEN,
} from '../src/model-view';
import type { ChangeModel, ResourceChange, AttrChange } from '@burnmap/parser';

function rc(p: Partial<ResourceChange>): ResourceChange {
  return {
    address: 'aws_x.y', module: '', type: 'aws_x', name: 'y', provider: 'p',
    action: 'update', attrs: [], dangerScore: 0, dangerReasons: [], ...p,
  };
}

describe('isHighRisk', () => {
  it('is true at or above the threshold, false below', () => {
    expect(isHighRisk(rc({ dangerScore: HIGH_RISK_THRESHOLD }))).toBe(true);
    expect(isHighRisk(rc({ dangerScore: HIGH_RISK_THRESHOLD - 1 }))).toBe(false);
  });
});

describe('highRiskList', () => {
  it('flattens all modules and returns only high-risk, sorted by danger desc', () => {
    const model = {
      modules: [
        { module: 'module.vpc', types: [{ type: 'aws_subnet', resources: [rc({ address: 'a', dangerScore: 10 })] }] },
        { module: 'module.data', types: [{ type: 'aws_db_instance', resources: [
          rc({ address: 'db', dangerScore: 100, action: 'replace' }),
        ] }] },
        { module: '', types: [{ type: 'aws_s3_bucket', resources: [rc({ address: 'bk', dangerScore: 70, action: 'delete' })] }] },
      ],
    } as unknown as ChangeModel;
    expect(highRiskList(model).map((r) => r.address)).toEqual(['db', 'bk']);
  });
});

describe('formatValue', () => {
  it('quotes strings and JSON-encodes everything else', () => {
    expect(formatValue('t3.micro')).toBe('"t3.micro"');
    expect(formatValue(200)).toBe('200');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(true)).toBe('true');
  });

  it('escapes embedded quotes and newlines so display strings stay well-formed', () => {
    expect(formatValue('a"b')).toBe('"a\\"b"');
    expect(formatValue('line1\nline2')).toBe('"line1\\nline2"');
  });

  it('truncates very long values with an ellipsis', () => {
    const out = formatValue('x'.repeat(500));
    expect(out.length).toBe(MAX_VALUE_LEN + 1); // 120 chars + '…'
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('formatAttr', () => {
  it('renders before → after with quoted strings', () => {
    const a: AttrChange = { path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: false };
    expect(formatAttr(a)).toBe('engine_version "14.7" → "15.4"');
  });
  it('shows «sensitive» without quotes for sensitive attrs', () => {
    const a: AttrChange = { path: 'password', before: '«sensitive»', after: '«sensitive»', sensitive: true, unknown: false, forcesReplacement: false };
    expect(formatAttr(a)).toBe('password «sensitive» → «sensitive»');
  });
  it('shows (known after apply) without quotes for unknown after', () => {
    const a: AttrChange = { path: 'arn', before: 'old', after: '(known after apply)', sensitive: false, unknown: true, forcesReplacement: false };
    expect(formatAttr(a)).toBe('arn "old" → (known after apply)');
  });
});

describe('relativeAddress', () => {
  it('strips the module prefix', () => {
    expect(relativeAddress(rc({ address: 'module.vpc.aws_subnet.public[0]', module: 'module.vpc' }))).toBe('aws_subnet.public[0]');
  });
  it('returns the full address for the root module', () => {
    expect(relativeAddress(rc({ address: 'aws_s3_bucket.logs', module: '' }))).toBe('aws_s3_bucket.logs');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run test/glyphs.test.ts test/model-view.test.ts`
Expected: FAIL — cannot resolve `../src/glyphs` / `../src/model-view`.

- [ ] **Step 3: Write the implementations**

`packages/web/src/glyphs.ts`:
```ts
import type { Action } from '@burnmap/parser';

/** Single-character glyph drawn in the colored square for each action. */
export const ACTION_GLYPH: Record<Action, string> = {
  create: '+', update: '~', replace: '±', delete: '×', 'no-op': '·', read: '?',
};

/** Human label used in summary pills and badges. */
export const ACTION_LABEL: Record<Action, string> = {
  create: 'create', update: 'change', replace: 'replace', delete: 'destroy', 'no-op': 'no-op', read: 'read',
};

/**
 * CSS color token: maps an action to one of create|update|replace|destroy.
 * `no-op`/`read` are filtered out of the manifest by the parser, so they never
 * reach the palette in practice; they fall back to the neutral `update` token.
 */
export const ACTION_KIND: Record<Action, string> = {
  create: 'create', update: 'update', replace: 'replace', delete: 'destroy', 'no-op': 'update', read: 'update',
};
```

`packages/web/src/model-view.ts`:
```ts
import type { AttrChange, ChangeModel, ResourceChange } from '@burnmap/parser';

/** Resources scoring at or above this are surfaced in the danger index and rendered "hot". */
export const HIGH_RISK_THRESHOLD = 60;

export function isHighRisk(rc: ResourceChange): boolean {
  return rc.dangerScore >= HIGH_RISK_THRESHOLD;
}

/** All high-risk resources across every module, most dangerous first. */
export function highRiskList(model: ChangeModel): ResourceChange[] {
  return model.modules
    .flatMap((m) => m.types.flatMap((t) => t.resources))
    .filter(isHighRisk)
    .sort((a, b) => b.dangerScore - a.dangerScore || a.address.localeCompare(b.address));
}

/** Longest attribute value we display inline before truncating, to protect row layout. */
export const MAX_VALUE_LEN = 120;

/**
 * Render a JSON value for display. `JSON.stringify` gives correctly-quoted,
 * fully-escaped output for strings (handling embedded quotes/newlines/tabs) and
 * the natural form for numbers/booleans/null/objects. Long values are truncated
 * so a giant blob (e.g. an inline IAM policy) can't blow out the row.
 */
export function formatValue(value: unknown): string {
  const s = JSON.stringify(value) ?? String(value);
  return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s;
}

/** "path before → after", with markers (sensitive / known-after-apply) shown unquoted. */
export function formatAttr(attr: AttrChange): string {
  const before = attr.sensitive ? '«sensitive»' : formatValue(attr.before);
  const after = attr.sensitive
    ? '«sensitive»'
    : attr.unknown
      ? '(known after apply)'
      : formatValue(attr.after);
  return `${attr.path} ${before} → ${after}`;
}

/**
 * Drop the "module.x." prefix so a row shows type.name within its group.
 * Invariant: for non-root resources the parser's `address` starts with
 * `${module}.`. If a future address format diverges, this falls back to the
 * full address (the row would then show a redundant module prefix).
 */
export function relativeAddress(rc: ResourceChange): string {
  if (rc.module && rc.address.startsWith(`${rc.module}.`)) {
    return rc.address.slice(rc.module.length + 1);
  }
  return rc.address;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/glyphs.test.ts test/model-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/glyphs.ts packages/web/src/model-view.ts packages/web/test/glyphs.test.ts packages/web/test/model-view.test.ts
git commit -m "feat(web): view-model helpers and glyph maps"
```

---

## Task 3: Sample `ChangeModel` for dev + tests

**Files:**
- Create: `packages/web/src/sample-data.ts`
- Test: `packages/web/test/sample-data.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/test/sample-data.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sampleModel } from '../src/sample-data';
import { highRiskList } from '../src/model-view';
import type { Action } from '@burnmap/parser';

describe('sampleModel', () => {
  it('is a realistic model with two high-risk changes (matches the design mockup)', () => {
    expect(sampleModel.summary).toEqual({ create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 });
    const hot = highRiskList(sampleModel);
    expect(hot.map((r) => r.action).sort()).toEqual(['delete', 'replace']);
    // module.data is present and contains the forced DB replace
    const data = sampleModel.modules.find((m) => m.module === 'module.data');
    expect(data).toBeDefined();
    expect(JSON.stringify(sampleModel)).not.toContain('hunter2'); // no real secrets baked in
  });

  it('has a summary that reconciles with the actual resources (no phantom counts)', () => {
    const all = sampleModel.modules.flatMap((m) => m.types.flatMap((t) => t.resources));
    const counted = (a: Action) => all.filter((r) => r.action === a).length;
    expect(counted('create')).toBe(sampleModel.summary.create);
    expect(counted('update')).toBe(sampleModel.summary.update);
    expect(counted('delete')).toBe(sampleModel.summary.delete);
    expect(counted('replace')).toBe(sampleModel.summary.replace);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/sample-data.test.ts`
Expected: FAIL — cannot resolve `../src/sample-data`.

- [ ] **Step 3: Write the implementation**

`packages/web/src/sample-data.ts`:
```ts
import type { ChangeModel } from '@burnmap/parser';

/** A representative model used by the dev server and tests. Mirrors the design mockup. */
export const sampleModel: ChangeModel = {
  meta: {
    repo: 'firebreak-io/infra',
    prNumber: 142,
    commitSha: 'a1b9c2f',
    terraformVersion: '1.12.1',
    generatedAt: '2026-05-29T00:00:00Z',
  },
  summary: { create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 },
  modules: [
    {
      module: 'module.data',
      types: [
        {
          type: 'aws_db_instance',
          resources: [
            {
              address: 'module.data.aws_db_instance.main',
              module: 'module.data',
              type: 'aws_db_instance',
              name: 'main',
              provider: 'registry.terraform.io/hashicorp/aws',
              action: 'replace',
              attrs: [
                { path: 'allocated_storage', before: 100, after: 200, sensitive: false, unknown: false, forcesReplacement: false },
                { path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: true },
              ],
              dangerScore: 100,
              dangerReasons: [
                'replacement recreates a stateful resource — possible data loss/downtime',
                'forces replacement: engine_version',
              ],
            },
          ],
        },
      ],
    },
    {
      module: 'module.vpc',
      types: [
        {
          type: 'aws_subnet',
          resources: [
            { address: 'module.vpc.aws_subnet.public[0]', module: 'module.vpc', type: 'aws_subnet', name: 'public', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
            { address: 'module.vpc.aws_subnet.public[1]', module: 'module.vpc', type: 'aws_subnet', name: 'public', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
            { address: 'module.vpc.aws_subnet.public[2]', module: 'module.vpc', type: 'aws_subnet', name: 'public', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
          ],
        },
        {
          type: 'aws_route_table',
          resources: [
            {
              address: 'module.vpc.aws_route_table.main', module: 'module.vpc', type: 'aws_route_table', name: 'main', provider: 'aws',
              action: 'update',
              attrs: [{ path: 'route[0].gateway_id', before: null, after: '(known after apply)', sensitive: false, unknown: true, forcesReplacement: false }],
              dangerScore: 20, dangerReasons: [],
            },
          ],
        },
      ],
    },
    {
      module: 'module.app',
      types: [
        {
          type: 'aws_security_group_rule',
          resources: [
            { address: 'module.app.aws_security_group_rule.https', module: 'module.app', type: 'aws_security_group_rule', name: 'https', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
          ],
        },
        {
          type: 'aws_ecs_service',
          resources: [
            {
              address: 'module.app.aws_ecs_service.web', module: 'module.app', type: 'aws_ecs_service', name: 'web', provider: 'aws',
              action: 'update',
              attrs: [{ path: 'tags.Version', before: '1.4.0', after: '1.5.0', sensitive: false, unknown: false, forcesReplacement: false }],
              dangerScore: 5, dangerReasons: [],
            },
          ],
        },
      ],
    },
    {
      module: '',
      types: [
        {
          type: 'aws_security_group_rule',
          resources: [
            { address: 'aws_security_group_rule.legacy_ingress', module: '', type: 'aws_security_group_rule', name: 'legacy_ingress', provider: 'aws', action: 'delete', attrs: [], dangerScore: 70, dangerReasons: ['resource will be destroyed'] },
          ],
        },
      ],
    },
  ],
  outputs: [
    { name: 'db_endpoint', action: 'update', sensitive: false },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/sample-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/sample-data.ts packages/web/test/sample-data.test.ts
git commit -m "feat(web): sample ChangeModel for dev and tests"
```

---

## Task 4: `SummaryPills` component

**Files:**
- Create: `packages/web/src/components/SummaryPills.tsx`
- Test: `packages/web/test/SummaryPills.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/test/SummaryPills.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryPills } from '../src/components/SummaryPills';

describe('SummaryPills', () => {
  it('shows add/change/replace/destroy counts with labels', () => {
    render(<SummaryPills summary={{ create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 }} />);
    expect(screen.getByText('add')).toBeInTheDocument();
    expect(screen.getByText('change')).toBeInTheDocument();
    expect(screen.getByText('replace')).toBeInTheDocument();
    expect(screen.getByText('destroy')).toBeInTheDocument();
    // counts render in tabular spans
    expect(screen.getAllByText('4')[0]).toBeInTheDocument();
  });

  it('omits a pill when its count is zero', () => {
    render(<SummaryPills summary={{ create: 0, update: 0, delete: 0, replace: 3, noop: 5, read: 0 }} />);
    expect(screen.queryByText('add')).not.toBeInTheDocument();
    expect(screen.getByText('replace')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/SummaryPills.test.tsx`
Expected: FAIL — cannot resolve `../src/components/SummaryPills`.

- [ ] **Step 3: Write the implementation**

`packages/web/src/components/SummaryPills.tsx`:
```tsx
import type { ChangeSummary } from '@burnmap/parser';

interface Pill { kind: string; label: string; count: number; }

export function SummaryPills({ summary }: { summary: ChangeSummary }) {
  const pills: Pill[] = [
    { kind: 'create', label: 'add', count: summary.create },
    { kind: 'update', label: 'change', count: summary.update },
    { kind: 'replace', label: 'replace', count: summary.replace },
    { kind: 'destroy', label: 'destroy', count: summary.delete },
  ];
  return (
    <div className="summary">
      {pills.filter((p) => p.count > 0).map((p) => (
        <span key={p.kind} className={`pill ${p.kind}`}>
          <span className="n">{p.count}</span> {p.label}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/SummaryPills.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/SummaryPills.tsx packages/web/test/SummaryPills.test.tsx
git commit -m "feat(web): SummaryPills component"
```

---

## Task 5: `ResourceRow` component

Renders one resource: a row (glyph + address + optional badge) and, for high-risk or update changes, the attached detail (reasons + attribute diffs / compact summary). This is the most complex component.

**Files:**
- Create: `packages/web/src/components/ResourceRow.tsx`
- Test: `packages/web/test/ResourceRow.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/test/ResourceRow.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceRow } from '../src/components/ResourceRow';
import type { ResourceChange } from '@burnmap/parser';

function rc(p: Partial<ResourceChange>): ResourceChange {
  return {
    address: 'aws_x.y', module: '', type: 'aws_x', name: 'y', provider: 'p',
    action: 'create', attrs: [], dangerScore: 10, dangerReasons: [], ...p,
  };
}

describe('ResourceRow', () => {
  it('renders a bare row for a create (no detail)', () => {
    const { container } = render(<ResourceRow rc={rc({ address: 'module.vpc.aws_subnet.public[0]', module: 'module.vpc', type: 'aws_subnet', action: 'create' })} />);
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(screen.getByText('public[0]')).toBeInTheDocument();
    expect(container.querySelector('.detail')).toBeNull();
    expect(container.querySelector('.item.hot')).toBeNull();
  });

  it('renders a high-risk replace as "hot" with reasons, attr diffs, and a force badge', () => {
    const { container } = render(<ResourceRow rc={rc({
      address: 'module.data.aws_db_instance.main', module: 'module.data', type: 'aws_db_instance',
      action: 'replace', dangerScore: 100,
      dangerReasons: ['forces replacement: engine_version'],
      attrs: [{ path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: true }],
    })} />);
    expect(container.querySelector('.item.hot')).not.toBeNull();
    expect(screen.getByText('force replace')).toBeInTheDocument();
    expect(screen.getByText(/forces replacement: engine_version/)).toBeInTheDocument();
    // target the attr diff specifically — "14.7" appears only there, not in the reason line
    expect(screen.getByText(/engine_version "14\.7" → "15\.4"/)).toBeInTheDocument();
    expect(container.querySelector('.attr .forces')).not.toBeNull();
  });

  it('renders a destroy with a destroy badge', () => {
    render(<ResourceRow rc={rc({ action: 'delete', dangerScore: 70, dangerReasons: ['resource will be destroyed'] })} />);
    expect(screen.getByText('destroy')).toBeInTheDocument();
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('renders a non-high-risk update as a compact attr summary (not hot)', () => {
    const { container } = render(<ResourceRow rc={rc({
      action: 'update', dangerScore: 5,
      attrs: [{ path: 'tags.Version', before: '1.4.0', after: '1.5.0', sensitive: false, unknown: false, forcesReplacement: false }],
    })} />);
    expect(container.querySelector('.item.hot')).toBeNull();
    expect(container.querySelector('.more')).not.toBeNull();
    expect(screen.getByText(/tags.Version "1.4.0" → "1.5.0"/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/ResourceRow.test.tsx`
Expected: FAIL — cannot resolve `../src/components/ResourceRow`.

- [ ] **Step 3: Write the implementation**

`packages/web/src/components/ResourceRow.tsx`:
```tsx
import type { ResourceChange } from '@burnmap/parser';
import { ACTION_GLYPH, ACTION_KIND } from '../glyphs';
import { formatAttr, isHighRisk, relativeAddress } from '../model-view';

export function anchorId(address: string): string {
  // Preserve underscores (common in resource type names); collapse other
  // non-alphanumerics to '-'. DangerIndex links use this same function, so
  // index anchors always match row ids.
  // Limitation: '.' and '-' both collapse to '-', so two addresses differing
  // only by '.'/'-' would collide. Real Terraform addresses use '.' purely as a
  // structural separator and never contain literal hyphens in type/module
  // segments, so collisions are not expected in practice.
  return `r-${address.replace(/[^a-zA-Z0-9_]+/g, '-')}`;
}

function AddressLabel({ rc }: { rc: ResourceChange }) {
  const rel = relativeAddress(rc);
  const prefix = `${rc.type}.`;
  const rest = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
  return (
    <span className="addr">
      <span className="type">{prefix}</span>
      {rest}
    </span>
  );
}

function Badge({ rc }: { rc: ResourceChange }) {
  if (rc.action === 'delete') return <span className="badge del">destroy</span>;
  if (rc.action === 'replace') {
    const forced = rc.attrs.some((a) => a.forcesReplacement);
    return <span className="badge force">{forced ? 'force replace' : 'replace'}</span>;
  }
  return null;
}

export function ResourceRow({ rc }: { rc: ResourceChange }) {
  const hot = isHighRisk(rc);
  const showCompact = rc.action === 'update' && !hot && rc.attrs.length > 0;

  return (
    <div className={`item${hot ? ' hot' : ''}`} id={anchorId(rc.address)}>
      <div className="row">
        <span className={`glyph g-${ACTION_KIND[rc.action]}`}>{ACTION_GLYPH[rc.action]}</span>
        <AddressLabel rc={rc} />
        <Badge rc={rc} />
      </div>

      {hot && (
        <div className="detail">
          {rc.dangerReasons.map((reason, i) => (
            <p className="reason" key={i}>{reason}</p>
          ))}
          {rc.attrs.map((a) => {
            const text = formatAttr(a);
            return (
              <div className="attr" key={a.path}>
                <span className="k">{text}</span>
                {a.forcesReplacement && <span className="forces"> (forces replacement)</span>}
              </div>
            );
          })}
        </div>
      )}

      {showCompact && (
        <div className="more">{rc.attrs.map((a) => formatAttr(a)).join(' · ')}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/ResourceRow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ResourceRow.tsx packages/web/test/ResourceRow.test.tsx
git commit -m "feat(web): ResourceRow component (normal, hot, compact)"
```

---

## Task 6: `DangerIndex` component

**Files:**
- Create: `packages/web/src/components/DangerIndex.tsx`
- Test: `packages/web/test/DangerIndex.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/test/DangerIndex.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DangerIndex } from '../src/components/DangerIndex';
import { sampleModel } from '../src/sample-data';

describe('DangerIndex', () => {
  it('renders nothing when there are no high-risk changes', () => {
    const { container } = render(<DangerIndex model={{ ...sampleModel, modules: [] }} />);
    expect(container.querySelector('.index')).toBeNull();
  });

  it('lists each high-risk change as a chip linking to its row anchor', () => {
    render(<DangerIndex model={sampleModel} />);
    expect(screen.getByText(/2 high-risk/)).toBeInTheDocument();
    const dbChip = screen.getByText('module.data.aws_db_instance.main').closest('a');
    expect(dbChip).toHaveAttribute('href', '#r-module-data-aws_db_instance-main');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/DangerIndex.test.tsx`
Expected: FAIL — cannot resolve `../src/components/DangerIndex`.

- [ ] **Step 3: Write the implementation**

`packages/web/src/components/DangerIndex.tsx`:
```tsx
import type { ChangeModel } from '@burnmap/parser';
import { highRiskList } from '../model-view';
import { ACTION_GLYPH } from '../glyphs';
import { anchorId } from './ResourceRow';

export function DangerIndex({ model }: { model: ChangeModel }) {
  const items = highRiskList(model);
  if (items.length === 0) return null;
  return (
    <div className="index">
      <span className="lbl">⚠ {items.length} high-risk</span>
      {items.map((rc) => (
        <a className="chip" href={`#${anchorId(rc.address)}`} key={rc.address}>
          {/* only 'replace' and 'delete' reach highRiskList under current scoring;
              'd' = destroy palette, 'r' = replace palette (covers any non-delete). */}
          <span className={`tag ${rc.action === 'delete' ? 'd' : 'r'}`}>{ACTION_GLYPH[rc.action]}</span>
          {rc.address}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/DangerIndex.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/DangerIndex.tsx packages/web/test/DangerIndex.test.tsx
git commit -m "feat(web): DangerIndex jump-list component"
```

---

## Task 7: `ModuleGroupView` and `Outputs` components

**Files:**
- Create: `packages/web/src/components/ModuleGroupView.tsx`
- Create: `packages/web/src/components/Outputs.tsx`
- Test: `packages/web/test/ModuleGroupView.test.tsx`
- Test: `packages/web/test/Outputs.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/web/test/ModuleGroupView.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModuleGroupView } from '../src/components/ModuleGroupView';
import type { ModuleGroup } from '@burnmap/parser';

const group: ModuleGroup = {
  module: 'module.vpc',
  types: [
    { type: 'aws_subnet', resources: [
      { address: 'module.vpc.aws_subnet.a', module: 'module.vpc', type: 'aws_subnet', name: 'a', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
      { address: 'module.vpc.aws_subnet.b', module: 'module.vpc', type: 'aws_subnet', name: 'b', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
    ] },
  ],
};

describe('ModuleGroupView', () => {
  it('shows the module header with a total resource count and renders each resource', () => {
    render(<ModuleGroupView group={group} />);
    expect(screen.getByText('module.vpc')).toBeInTheDocument();
    expect(screen.getByText('· 2')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('labels the root module as "root"', () => {
    render(<ModuleGroupView group={{ ...group, module: '' }} />);
    expect(screen.getByText('root')).toBeInTheDocument();
  });
});
```

`packages/web/test/Outputs.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Outputs } from '../src/components/Outputs';

describe('Outputs', () => {
  it('renders nothing when there are no output changes', () => {
    const { container } = render(<Outputs outputs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists output names with their action and a sensitive marker', () => {
    render(<Outputs outputs={[
      { name: 'db_endpoint', action: 'update', sensitive: false },
      { name: 'db_password', action: 'create', sensitive: true },
    ]} />);
    expect(screen.getByText('db_endpoint')).toBeInTheDocument();
    expect(screen.getByText('db_password')).toBeInTheDocument();
    expect(screen.getByText(/sensitive/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run test/ModuleGroupView.test.tsx test/Outputs.test.tsx`
Expected: FAIL — cannot resolve the component modules.

- [ ] **Step 3: Write the implementations**

`packages/web/src/components/ModuleGroupView.tsx`:
```tsx
import type { ModuleGroup } from '@burnmap/parser';
import { ResourceRow } from './ResourceRow';

export function ModuleGroupView({ group }: { group: ModuleGroup }) {
  const count = group.types.reduce((n, t) => n + t.resources.length, 0);
  return (
    <div className="group">
      <p className="group-h">
        {group.module || 'root'} <span className="cnt">· {count}</span>
      </p>
      {group.types.flatMap((t) => t.resources).map((rc) => (
        <ResourceRow rc={rc} key={rc.address} />
      ))}
    </div>
  );
}
```

`packages/web/src/components/Outputs.tsx`:
```tsx
import type { OutputChange } from '@burnmap/parser';
import { ACTION_LABEL } from '../glyphs';

export function Outputs({ outputs }: { outputs: OutputChange[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="group outputs">
      <p className="group-h">outputs <span className="cnt">· {outputs.length}</span></p>
      {outputs.map((o) => (
        <div className="row" key={o.name}>
          <span className="addr">{o.name}</span>
          <span className="out-action">
            {ACTION_LABEL[o.action]}{o.sensitive ? ' · sensitive' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/ModuleGroupView.test.tsx test/Outputs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ModuleGroupView.tsx packages/web/src/components/Outputs.tsx packages/web/test/ModuleGroupView.test.tsx packages/web/test/Outputs.test.tsx
git commit -m "feat(web): ModuleGroupView and Outputs components"
```

---

## Task 8: `App` composition + DOM snapshot

**Files:**
- Create: `packages/web/src/components/App.tsx`
- Test: `packages/web/test/App.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/test/App.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/components/App';
import { sampleModel } from '../src/sample-data';

describe('App', () => {
  it('renders the brand, context, summary, danger index, and module groups', () => {
    render(<App model={sampleModel} />);
    expect(screen.getByText('burnmap')).toBeInTheDocument();
    expect(screen.getByText(/firebreak-io\/infra · PR #142 · a1b9c2f/)).toBeInTheDocument();
    expect(screen.getByText(/2 high-risk/)).toBeInTheDocument();
    expect(screen.getByText('module.data')).toBeInTheDocument();
    expect(screen.getByText('module.app')).toBeInTheDocument();
  });

  it('matches the rendered DOM snapshot (visual-regression guard)', () => {
    const { container } = render(<App model={sampleModel} />);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/App.test.tsx`
Expected: FAIL — cannot resolve `../src/components/App`.

- [ ] **Step 3: Write the implementation**

`packages/web/src/components/App.tsx`:
```tsx
import type { ChangeModel } from '@burnmap/parser';
import { SummaryPills } from './SummaryPills';
import { DangerIndex } from './DangerIndex';
import { ModuleGroupView } from './ModuleGroupView';
import { Outputs } from './Outputs';

export function App({ model }: { model: ChangeModel }) {
  const { meta } = model;
  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <span className="brand"><span className="spark">▰</span> burnmap</span>
          <span className="ctx">{meta.repo} · PR #{meta.prNumber} · {meta.commitSha}</span>
        </div>
        <div className="body">
          <SummaryPills summary={model.summary} />
          <DangerIndex model={model} />
          {model.modules.map((group) => (
            <ModuleGroupView group={group} key={group.module || 'root'} />
          ))}
          <Outputs outputs={model.outputs} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes (writes the snapshot)**

Run: `cd packages/web && npx vitest run test/App.test.tsx`
Expected: PASS; a snapshot file is created under `test/__snapshots__/App.test.tsx.snap`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/App.tsx packages/web/test/App.test.tsx packages/web/test/__snapshots__/App.test.tsx.snap
git commit -m "feat(web): App composition with DOM snapshot regression guard"
```

---

## Task 9: Entry point, ready signal, build

**Files:**
- Create: `packages/web/src/ready.ts`
- Create: `packages/web/src/main.tsx`
- Test: `packages/web/test/ready.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/test/ready.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { markReady, readModel } from '../src/ready';
import { sampleModel } from '../src/sample-data';

describe('markReady', () => {
  it('sets the screenshot-ready flag on the given window', () => {
    const win: Record<string, unknown> = {};
    markReady(win);
    expect(win.__BURNMAP_READY__).toBe(true);
  });
});

describe('readModel', () => {
  it('returns injected window data when present', () => {
    const injected = { ...sampleModel, meta: { ...sampleModel.meta, prNumber: 999 } };
    const win = { __BURNMAP_DATA__: injected } as Record<string, unknown>;
    expect(readModel(win, sampleModel).meta.prNumber).toBe(999);
  });

  it('falls back to the sample model when no data is injected', () => {
    expect(readModel({}, sampleModel)).toBe(sampleModel);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/ready.test.ts`
Expected: FAIL — cannot resolve `../src/ready`.

- [ ] **Step 3: Write the implementations**

`packages/web/src/ready.ts`:
```ts
import type { ChangeModel } from '@burnmap/parser';

/** Set the flag Playwright polls before screenshotting. */
export function markReady(win: Record<string, unknown>): void {
  win.__BURNMAP_READY__ = true;
}

/** Use injected plan data if present, else the bundled sample (dev convenience). */
export function readModel(win: Record<string, unknown>, fallback: ChangeModel): ChangeModel {
  const injected = win.__BURNMAP_DATA__;
  return (injected as ChangeModel | undefined) ?? fallback;
}
```

`packages/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { sampleModel } from './sample-data';
import { markReady, readModel } from './ready';
import './theme.css';

const win = window as unknown as Record<string, unknown>;
const model = readModel(win, sampleModel);

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <App model={model} />
  </StrictMode>,
);

// Signal readiness once fonts are loaded and two frames have painted, so a
// headless screenshot (Phase 3) captures the fully-settled layout.
const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => markReady(win)));
if (document.fonts?.ready) document.fonts.ready.then(settle);
else settle();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/ready.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite + type-check + production build**

Run: `cd packages/web && npx vitest run && npm run build`
Expected: all tests PASS; `npm run build` runs `tsc --noEmit` clean then `vite build`, producing `dist/index.html` and a hashed JS/CSS bundle under `dist/assets/`.

- [ ] **Step 6: Smoke-check the built bundle reads injected data**

Run: `cd packages/web && node -e "const html=require('fs').readFileSync('dist/index.html','utf8'); if(!/assets\/.*\.js/.test(html)) { console.error('no bundle ref'); process.exit(1); } console.log('OK: bundle referenced');"`
Expected: `OK: bundle referenced`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/ready.ts packages/web/src/main.tsx packages/web/test/ready.test.ts
git commit -m "feat(web): entry point, model injection, and screenshot-ready signal"
```

---

## Self-review notes (author)

- **Spec coverage:** hybrid layout (danger index + in-place detail) — Tasks 5/6/8. Color/glyph/badge system — `theme.css` (Task 1) + `glyphs.ts` (Task 2). Attribute diffs with force/sensitive/unknown — Tasks 2/5. Summary pills — Task 4. Outputs — Task 7. `window.__BURNMAP_DATA__` injection + `window.__BURNMAP_READY__` signal — Task 9. Static React+Vite build — Tasks 1/9. Regression guard — DOM snapshot (Task 8); pixel screenshot deferred to Phase 3 (noted in Scope).
- **Type consistency:** components are typed against the real `@burnmap/parser` exports (`ChangeModel`, `ChangeSummary`, `ModuleGroup`, `OutputChange`, `ResourceChange`, `Action`). `anchorId` is defined once in `ResourceRow` and imported by `DangerIndex` so index links and row ids always match.
- **Out of this phase (by design):** Playwright screenshotting + S3 + the PR comment are Phase 3/4. The text-summary line and `<details>` plaintext fallback in the PR comment belong to the action phase, not the SPA.
- **Note for Phase 3:** drive the *built* SPA, inject `window.__BURNMAP_DATA__` before the bundle loads, and poll `window.__BURNMAP_READY__` before screenshotting. The `drift` field is rendered by reusing `ResourceRow`; if drift display is wanted in the view, add a `<DriftSection>` in a follow-up (the data is already in the model).

---

## Next phase

After this plan is executed and green, **Phase 3 — `@burnmap/shoot`**: a Playwright harness that loads the built SPA from disk with an injected `ChangeModel`, waits for `window.__BURNMAP_READY__`, and screenshots it to a PNG (plus the pixel visual-regression baseline deferred from here).
