# burnmap — Terraform Plan Visualizer (Design)

**Date:** 2026-05-29
**Status:** Approved design — ready for implementation planning
**Author:** Chris Brady (Firebreak)

## Summary

`burnmap` renders an OpenTofu/Terraform **plan diff** as a styled, readable diagram
and posts it into a GitHub PR as a sticky comment with an embedded image. The job
it does: let a reviewer understand what an apply will do — and *not miss the
dangerous changes* — without parsing the raw plan wall-of-text.

The rendering engine is a web dashboard. In CI it is driven headless and
screenshotted; later the same dashboard becomes a hosted interactive view. One
codebase serves both surfaces, so every styling improvement benefits both.

### Scope

- **v1 (this spec):** plan-diff visualization, delivered as a GitHub Action that
  posts a PR comment with an embedded PNG hosted on S3.
- **Future (goal C, out of scope here):** overlay the diff on the existing
  infrastructure dependency graph (graph-as-canvas), and deploy the dashboard as
  a hosted interactive service that serves both the live view and the image.

Designed *toward* the future without building it: the parser already captures
drift data, and the web app is a standalone static SPA that can be deployed as
the hosted service unchanged.

## Architecture

One TypeScript npm-workspaces monorepo, three logical packages + an action wrapper:

```
GitHub Action (Docker action, pinned Playwright/Chromium)
  tofu plan -out=tfplan  →  tofu show -json tfplan  →  plan.json
        │
        ▼
  ① @burnmap/parser   plan.json → ChangeModel (normalized, danger-scored, redacted)
        │
        ▼
  ② @burnmap/web      static React SPA; model injected as window.__BURNMAP_DATA__
        │            renders the grouped, color-coded diff view
        ▼
  ③ @burnmap/shoot    Playwright loads built SPA from disk, waits for
        │            window.__BURNMAP_READY__, screenshots at 2× scale
        ▼
      PNG → S3  s3://{bucket}/burnmap/{repo}/{pr}/{sha}.png  (private)
        │       → short-TTL presigned URL
        ▼
  ④ @burnmap/action   find-or-create sticky PR comment (hidden marker),
                       embed presigned image URL + text summary + <details> fallback
```

### Why this shape

- **Parser / web / shoot split** so the parser and web app are independently
  testable, and the web app deploys later as the hosted service untouched.
- **Static SPA with data injected at build/run time** (Approach 1): CI is
  hermetic — no server, no network during render. The future hosted service swaps
  "data baked in" for "data fetched."
- **Render-complete handshake** (`window.__BURNMAP_READY__`) so Playwright
  screenshots deterministically rather than racing a timer.
- **Docker action** ships Playwright/Chromium pinned — no per-run browser
  download, reproducible.

## Data contract — `ChangeModel`

The parser emits this normalized structure from `tofu show -json`'s
`resource_changes`, `output_changes`, and `resource_drift`. It is the contract
between parser and web app.

```ts
type Action = 'create' | 'update' | 'delete' | 'replace' | 'no-op' | 'read';
// replace = the ["delete","create"] / ["create","delete"] action pairs

type AttrChange = {
  path: string;                 // "instance_type", "tags.Name"
  before: JsonValue | null;
  after:  JsonValue | null;
  sensitive: boolean;           // value redacted to «sensitive»
  unknown: boolean;             // "(known after apply)"
  forcesReplacement: boolean;   // path ∈ change.replace_paths
};

type ResourceChange = {
  address: string;              // "module.vpc.aws_subnet.public[0]"
  module: string;               // "module.vpc" ("" = root)
  type: string;                 // "aws_subnet"
  name: string;                 // "public"
  provider: string;
  action: Action;
  attrs: AttrChange[];          // only changed paths
  dangerScore: number;          // computed in parser
  dangerReasons: string[];      // human-readable, e.g. "forces replacement: engine_version"
};

type ChangeModel = {
  meta: { repo; prNumber; commitSha; terraformVersion; generatedAt };
  summary: { create; update; delete; replace; noop; read };
  modules: ModuleGroup[];       // module → resourceType → ResourceChange[]
  outputs: OutputChange[];
  drift?: ResourceChange[];     // resource_drift, optional (previews goal C)
};
```

### Key decisions

- **Danger scoring lives in the parser, not the view.** Heuristic, tunable, and
  testable in one place. `delete` and `replace` score highest; a `replace` whose
  `forcesReplacement` lands on a stateful type (db, volume, bucket) scores higher
  still; tag/description-only `update`s score near zero. The view consumes the
  score for ordering/emphasis; it computes no policy.
- **Sensitive values are redacted at the parser boundary.** Any attribute flagged
  `sensitive` in the plan JSON never carries its real `before`/`after` into the
  model — it becomes `«sensitive»`. Secrets therefore never reach the HTML, the
  screenshot, or S3.
- **Drift captured but optional.** Free data from the same JSON; previews goal C.
  v1 may hide it behind a toggle or render minimally.

## Visual design

A scannable, color-coded **change manifest** (not a network graph in v1).
Hybrid layout — approved via visual mockup:

- **Summary pills** at top: counts per action (add / change / replace / destroy).
- **Danger index** — a slim banner listing high-risk changes as *jump-list chips*
  (`⚠ 2 high-risk` + clickable chips). It is an index, **not** a duplicate detail
  panel: the reviewer can't miss that risky changes exist and can jump straight to
  them.
- **Grouped manifest** — `module → resource` rows, mirroring code structure.
  Dangerous resources render **loud in place** (colored left spine, badge,
  reason line, attribute diff) — single source of truth, in context.
- **Detail granularity (Q6 = "C"):** attribute-level diffs shown
  (`engine_version "14.7" → "15.4" (forces replacement)`); destroys and
  force-replacements are visually escalated; benign updates show a compact
  one-line summary so they stay quiet.

**Color / glyph system:**

| Action  | Color  | Glyph |
|---------|--------|-------|
| create  | green  | `+`   |
| update  | amber  | `~`   |
| replace | orange | `±`   |
| destroy | red    | `×`   |

Force-replacement and destroy carry uppercase badges. The comment also includes a
text summary line (counts) and a collapsed `<details>` plaintext manifest as an
accessibility + resilience fallback if the image fails to load.

Reference mockups: `.superpowers/brainstorm/*/content/layout.html`, `hybrid.html`.

## CI integration & comment lifecycle

Consumer workflow:

```yaml
- run: tofu plan -out=tfplan
- run: tofu show -json tfplan > plan.json
- uses: firebreak/burnmap@v1
  with:
    plan-json: plan.json
    s3-bucket: ${{ vars.BURNMAP_BUCKET }}
    # AWS creds via OIDC role assumed earlier in the job
```

Action steps: parse → inject + render + screenshot (2× scale) → upload PNG to S3
→ presign (short TTL) → find-or-create sticky comment.

- **Sticky comment** keyed by a hidden marker (`<!-- burnmap:pr-{n} -->`), edited
  in place on each push — no per-commit spam. The per-SHA S3 key preserves
  history even though the comment shows latest.
- **Comment body:** embedded presigned image + text summary line + collapsed
  `<details>` plaintext fallback.

## Security — sensitive data & image hosting

- **Redaction at the parser boundary** (above) means no secret *values* ever
  enter the image or S3.
- **Private bucket + short-TTL presigned URLs.** GitHub serves embedded images
  through its **Camo** proxy, which fetches the origin **server-side once and
  caches the bytes**. So:
  - Presigned URL with a short TTL (1–24h).
  - Camo fetches and caches it at comment-render time; the image keeps displaying
    after the URL expires.
  - After TTL, the origin is locked down again — no public window, URL is
    unguessable *and* self-expiring.
- **No Referer/UA/IP filtering.** Viewers never hit the bucket (only Camo does),
  so viewer-origin filtering is impossible; `aws:UserAgent`/`aws:Referer` matches
  are spoofable and not a real control; Camo egress IPs aren't stable. Presigning
  closes the real hole. CloudFront is optional later, purely for a stable CDN
  domain.
- Treat the image as **infra-shaped metadata** (resource addresses, topology) —
  acceptable given redaction and the private+presigned posture.

## Tech stack

- **TypeScript** throughout; npm workspaces monorepo:
  `@burnmap/parser`, `@burnmap/web`, `@burnmap/shoot`, `@burnmap/action`.
- **Web:** React + Vite (static build). Plain CSS / CSS-modules — bespoke diagram
  layout, full styling control, no component library. No graph-layout engine in
  v1 (CSS flex/grid); `elk`/`dagre` enters only with goal C dependency edges.
- **Screenshot:** Playwright (Chromium), pinned in the action's Docker image.
- **AWS:** `@aws-sdk/client-s3` for upload + presign. Bucket provisioned via
  OpenTofu.
- **GitHub:** `@actions/core` + `@actions/github` (Octokit).

## Testing

- **Parser (bulk of logic → bulk of tests):** golden-file tests against real
  `tofu show -json` fixtures — create-only, replace, destroy, sensitive values,
  deep modules, empty no-op. Assert `ChangeModel`, especially danger scoring and
  redaction. Vitest.
- **Web:** component tests rendering each action/state; a Playwright
  visual-regression snapshot vs. baseline to catch styling regressions.
- **Shoot/action:** integration test running parser→render→screenshot on a
  fixture, asserting a PNG is produced; S3 + GitHub calls mocked.

## Build order (phased)

1. **`@burnmap/parser`** — JSON → `ChangeModel`, danger scoring, redaction +
   golden-file tests. (Highest value, fully testable in isolation.)
2. **`@burnmap/web`** — static SPA rendering the hybrid view from an injected
   model; visual-regression baseline.
3. **`@burnmap/shoot`** — Playwright render-and-screenshot of the built SPA.
4. **`@burnmap/action`** — sticky-comment poster + S3 upload/presign; wire the
   pipeline end to end.
5. **S3 + IAM via OpenTofu** — bucket (private), OIDC role, lifecycle/expiry.

## Out of scope (v1)

- Dependency-graph / blast-radius edges (goal C).
- Hosted interactive service & "view full diagram" link-out (later phase).
- GitLab/Bitbucket, non-AWS image hosting.
- Cost overlay, multi-environment comparison, policy enforcement.
```
