# "No Changes" empty state — design

**Date:** 2026-06-01
**Task:** FBK / Burnmap — *Add 'No Changes' text to graphic when there are no changes* (Todoist `6gmg9vxrhCFcGGHc`, P1)

## Problem

When a tofu plan has no resource changes, the burnmap graphic renders an empty
card body: `SummaryPills` filters out all zero counts, `DangerIndex` returns
`null`, and `model.modules.map(...)` produces nothing. A reviewer can't tell
whether the plan genuinely has no changes or whether something failed upstream.

## Goal

Render an explicit "No Changes" message in the graphic whenever the plan has no
resource actions to take, so an empty plan is unambiguous.

## Trigger (mirror tofu's logic)

Show the message when there are **no resource actions** — i.e. no
create/update/replace/delete. tofu treats drift and output changes separately,
and so do we.

`model.modules` is built in `parsePlan` from exactly the *displayed* actions
(create/update/replace/delete); `no-op` and `read` are counted in `summary` but
excluded from `modules`. Therefore the trigger is simply:

```ts
model.modules.length === 0
```

Expressed as a named, testable predicate in `model-view.ts`:

```ts
export const hasResourceChanges = (m: ChangeModel) => m.modules.length > 0;
```

## Components

### New: `packages/web/src/components/NoChanges.tsx`

A presentational component (no props), following the one-purpose-per-file
convention used by the other components.

- Check glyph (`✓`) styled with `var(--create)`.
- Headline: **No infrastructure changes**
- Subtext: *This plan won't create, update, or destroy any resources.*

### Changed: `packages/web/src/components/App.tsx`

When `!hasResourceChanges(model)`, render `<NoChanges />` in place of the
(empty) `model.modules.map(...)`. Everything else is unchanged:

- `SummaryPills` — renders nothing (all counts 0).
- `DangerIndex` — returns `null`.
- `Outputs` — still renders **below** the banner when there are output changes.

Rendering `Outputs` alongside the banner is what makes the behavior "mirror
tofu": an output-only plan shows *No infrastructure changes* **and** the Outputs
section, exactly as tofu prints `No changes.` followed by `Changes to Outputs:`.

### Changed: `packages/web/src/theme.css`

Add an `.empty` block — centered layout, muted subtext, check in
`var(--create)` — following the existing CSS-variable convention.

## Data flow

No parser changes. `summary` already carries every action count, and `modules`
already excludes `no-op`/`read`. The empty state is purely a presentation
concern derived from the existing `ChangeModel`.

## Testing

vitest + `@testing-library/react`, matching the existing test files.

- **New `test/NoChanges.test.tsx`** — renders headline and subtext.
- **New cases in `test/App.test.tsx`:**
  - Zero-change model → banner shown, no module groups.
  - Output-only model → banner **and** `Outputs` section both shown.
- **New `test/model-view.test.ts` case** — `hasResourceChanges` returns
  `false` for an empty-module model, `true` for `sampleModel`.
- The existing `sampleModel` DOM snapshot in `App.test.tsx` is untouched
  (`sampleModel` still has changes).
- A small zero-change fixture for the tests, exported from `sample-data.ts` so
  `dev`/`shoot` can preview the empty state.

## Out of scope

- **Parser changes** — `summary` already has the counts.
- **`shoot` changes** — it screenshots whatever the web view renders.
- **Drift** — `App.tsx` does not render `model.drift` today; unchanged here.

## Rejected alternatives

- **Inline the JSX in `App.tsx`** — muddies `App` and isn't independently
  testable.
- **Compute a `hasChanges` flag in the parser** — this is a presentation
  concern, not a parsing one; keeping it in `model-view` respects that boundary.
