# "No Changes" Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an explicit "No infrastructure changes" message in the burnmap graphic when a plan has no resource actions, instead of a blank card body.

**Architecture:** Add a named predicate `hasResourceChanges` to `model-view.ts` (true when `model.modules` is non-empty — `modules` already excludes `no-op`/`read`). Add a presentational `NoChanges` component. `App` renders `NoChanges` in place of the empty module list when there are no resource changes, while still rendering `Outputs` below it so an output-only plan mirrors tofu's behavior. Add an `.empty` CSS block.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, @testing-library/react. Tests run with `npm test -w @burnmap/web` from the repo root, or `npx vitest run <file>` from `packages/web`.

---

### Task 1: `hasResourceChanges` predicate

**Files:**
- Modify: `packages/web/src/model-view.ts`
- Test: `packages/web/test/model-view.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `packages/web/test/model-view.test.ts`. It uses the existing `rc()` helper already defined at the top of that file. Also add `hasResourceChanges` to the import from `../src/model-view` on line 2-4.

```ts
describe('hasResourceChanges', () => {
  it('is false when there are no module groups', () => {
    expect(hasResourceChanges({ modules: [] } as unknown as ChangeModel)).toBe(false);
  });
  it('is true when at least one module group is present', () => {
    const model = {
      modules: [{ module: '', types: [{ type: 'aws_x', resources: [rc({})] }] }],
    } as unknown as ChangeModel;
    expect(hasResourceChanges(model)).toBe(true);
  });
});
```

The import line becomes:

```ts
import {
  HIGH_RISK_THRESHOLD, isHighRisk, highRiskList, formatValue, formatAttr, relativeAddress, MAX_VALUE_LEN, hasResourceChanges,
} from '../src/model-view';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/model-view.test.ts`
Expected: FAIL — `hasResourceChanges is not a function` (or a TS/import error).

- [ ] **Step 3: Write minimal implementation**

Append to `packages/web/src/model-view.ts` (after `relativeAddress`). Add `ChangeModel` to the existing type import on line 1 if not already present (it is: line 1 imports `ChangeModel`).

```ts
/**
 * True when the plan has resource actions to take (create/update/replace/delete).
 * `model.modules` is built by the parser from exactly those displayed actions
 * — `no-op`/`read` are excluded — so an empty `modules` means "no changes",
 * mirroring tofu's own "No changes" determination. Output changes and drift are
 * handled separately (as tofu does) and do not affect this predicate.
 */
export function hasResourceChanges(model: ChangeModel): boolean {
  return model.modules.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/model-view.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/model-view.ts packages/web/test/model-view.test.ts
git commit -m "feat(web): add hasResourceChanges predicate"
```

---

### Task 2: `NoChanges` component

**Files:**
- Create: `packages/web/src/components/NoChanges.tsx`
- Create: `packages/web/test/NoChanges.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/NoChanges.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoChanges } from '../src/components/NoChanges';

describe('NoChanges', () => {
  it('shows the headline and explanatory subtext', () => {
    render(<NoChanges />);
    expect(screen.getByText('No infrastructure changes')).toBeInTheDocument();
    expect(
      screen.getByText("This plan won't create, update, or destroy any resources."),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/NoChanges.test.tsx`
Expected: FAIL — cannot find module `../src/components/NoChanges`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/components/NoChanges.tsx`:

```tsx
/** Shown in place of the module list when a plan has no resource changes. */
export function NoChanges() {
  return (
    <div className="empty">
      <span className="empty-mark">✓</span>
      <p className="empty-h">No infrastructure changes</p>
      <p className="empty-sub">This plan won't create, update, or destroy any resources.</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/NoChanges.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add styling**

Append this block to `packages/web/src/theme.css` (after the `.outputs` rule near the end). Uses existing CSS variables `--create` and `--muted`.

```css
.empty { text-align: center; padding: 28px 16px 24px; }
.empty-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--create-bg); color: var(--create);
  font-size: 18px; font-weight: 700; margin-bottom: 10px;
}
.empty-h { margin: 0 0 4px; font-weight: 700; font-size: 14px; }
.empty-sub { margin: 0; color: var(--muted); font-size: 12.5px; }
```

Note: `--create-bg`, `--create`, and `--muted` are already defined in `theme.css` (used by `.pill.create` and `.ctx`).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/NoChanges.tsx packages/web/test/NoChanges.test.tsx packages/web/src/theme.css
git commit -m "feat(web): add NoChanges empty-state component"
```

---

### Task 3: Empty-plan fixture in sample-data

**Files:**
- Modify: `packages/web/src/sample-data.ts`
- Test: `packages/web/test/sample-data.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `packages/web/test/sample-data.test.ts`, and add `emptyModel` to the import from `../src/sample-data`.

```ts
describe('emptyModel', () => {
  it('has no module groups (a no-changes plan)', () => {
    expect(emptyModel.modules).toEqual([]);
  });
  it('still carries meta so the card header renders', () => {
    expect(emptyModel.meta.repo).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/sample-data.test.ts`
Expected: FAIL — `emptyModel` is undefined / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/web/src/sample-data.ts` (after the `sampleModel` export):

```ts
/** A no-changes plan: no resource actions, no outputs. Used to preview/test the empty state. */
export const emptyModel: ChangeModel = {
  meta: {
    repo: 'firebreak-io/infra',
    prNumber: 142,
    commitSha: 'a1b9c2f',
    terraformVersion: '1.12.1',
    generatedAt: '2026-05-29T00:00:00Z',
  },
  summary: { create: 0, update: 0, delete: 0, replace: 0, noop: 3, read: 1 },
  modules: [],
  outputs: [],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/sample-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/sample-data.ts packages/web/test/sample-data.test.ts
git commit -m "test(web): add emptyModel no-changes fixture"
```

---

### Task 4: Wire `NoChanges` into `App`

**Files:**
- Modify: `packages/web/src/components/App.tsx`
- Test: `packages/web/test/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these two `it` blocks inside the existing `describe('App', ...)` in `packages/web/test/App.test.tsx`. Update the imports at the top to add `emptyModel` and `queryByText`/`screen` usage.

Add to imports:

```ts
import { emptyModel } from '../src/sample-data';
import type { ChangeModel } from '@burnmap/parser';
```

Add these tests:

```ts
it('shows the no-changes banner and no module groups for an empty plan', () => {
  render(<App model={emptyModel} />);
  expect(screen.getByText('No infrastructure changes')).toBeInTheDocument();
  expect(screen.queryByText(/high-risk/)).not.toBeInTheDocument();
});

it('shows the banner AND the outputs section for an output-only plan', () => {
  const outputOnly: ChangeModel = {
    ...emptyModel,
    outputs: [{ name: 'db_endpoint', action: 'update', sensitive: false }],
  };
  render(<App model={outputOnly} />);
  expect(screen.getByText('No infrastructure changes')).toBeInTheDocument();
  expect(screen.getByText('db_endpoint')).toBeInTheDocument();
});

it('does not show the no-changes banner when there are resource changes', () => {
  render(<App model={sampleModel} />);
  expect(screen.queryByText('No infrastructure changes')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run test/App.test.tsx`
Expected: FAIL — "No infrastructure changes" not found (App doesn't render it yet).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `packages/web/src/components/App.tsx` with:

```tsx
import type { ChangeModel } from '@burnmap/parser';
import { SummaryPills } from './SummaryPills';
import { DangerIndex } from './DangerIndex';
import { ModuleGroupView } from './ModuleGroupView';
import { Outputs } from './Outputs';
import { NoChanges } from './NoChanges';
import { hasResourceChanges } from '../model-view';

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
          {hasResourceChanges(model)
            ? model.modules.map((group) => (
                <ModuleGroupView group={group} key={group.module || 'root'} />
              ))
            : <NoChanges />}
          <Outputs outputs={model.outputs} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/App.test.tsx`
Expected: PASS. The existing snapshot test still passes — `sampleModel` is unchanged, so its DOM is identical.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/App.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): render NoChanges banner for no-change plans"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `cd packages/web && npx vitest run`
Expected: PASS — all test files green, including the unchanged `App` snapshot.

- [ ] **Step 2: Type-check and build the web package**

Run: `cd packages/web && npm run build`
Expected: `tsc --noEmit` clean, vite build succeeds with no errors.

- [ ] **Step 3: Run the whole workspace test suite**

Run (from repo root): `npm test`
Expected: every workspace's tests pass (parser, web, shoot, action).

- [ ] **Step 4: Visual sanity check (optional but recommended)**

Temporarily point the dev entry at `emptyModel` (or set `window.__burnmap_model__` per `ready.ts`) and run `npm run dev -w @burnmap/web` to confirm the banner renders centered with the check mark. Revert any temporary change before finishing.

---

## Notes for the implementer

- Run `/simplify` on the diff before opening the PR (user instruction for this task).
- Out of scope: parser changes, `shoot` changes, drift rendering.
- The `key` and structure of the existing `sampleModel` snapshot must not change; if the snapshot test fails, investigate rather than blindly updating it.
