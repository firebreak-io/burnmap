# burnmap CLI — standalone tool design

**Date:** 2026-06-23
**Status:** approved (design); pending implementation plan
**Scope:** Tier 1 (unified `burnmap` CLI) + Tier 2 (publish hygiene, npx-from-git distribution)

## Goal

Make burnmap usable as a standalone command-line tool, not only as a GitHub
Action. A single `burnmap` binary exposes the GitHub-free core (parse, arch,
plan-diff) so anyone can render a Terraform/OpenTofu plan locally without S3,
octokit, or a PR.

The core packages (`@burnmap/parser`, `@burnmap/shoot`, `@burnmap/graph`) are
already GitHub-free and each ship their own bin (`burnmap-parse`,
`burnmap-shoot`, `burnmap-graph`). This work adds an umbrella CLI over them and
the hygiene needed to install it standalone.

## Distribution decision

- **Initial:** `npx github:firebreak-io/burnmap` (no registry publish). The clone
  builds the workspace tree; `*` interdeps resolve under npm workspaces.
- **Later (out of scope, noted only):** publish `@burnmap/*` to public npm.
  Remaining step would be version bump + `npm publish --access public` per
  package, plus a CI publish workflow and an owned `@burnmap` npm scope.

## Architecture

New package `packages/cli`, published name `@burnmap/cli`. One bin: `burnmap`.
A thin dispatcher routes to subcommand modules; each subcommand wraps
already-exported library functions — no business logic is duplicated in the CLI.

```
packages/cli/
  package.json        bin { burnmap: ./dist/index.js }; deps: @burnmap/parser,
                      @burnmap/shoot, @burnmap/graph (workspace "*")
  src/
    index.ts          arg dispatch; --help / --version; top-level catch → exit code
    args.ts           tiny hand-rolled arg parser (flags, --out, positionals)
    commands/
      parse.ts        parsePlan → ChangeModel JSON → --out file or stdout
      arch.ts         parseArch → layoutArch → renderSvg (.svg)
                      | archToPng (.png, lazy Chromium)
      plan.ts         plan-diff PNG via @burnmap/shoot capture pipeline (Chromium)
      render.ts       all-in-one → --out-dir: model.json + arch.svg + diff.png
    chromium.ts       ensureChromium(): detect installed browser; on miss, exit
                      with `npx playwright install chromium` hint
```

No new third-party dependencies. Arg parsing is hand-rolled to match the
existing `parser/cli.ts` and `shoot/cli.ts` style and keep `@burnmap/cli`
dependency-light.

## Subcommands

| Command | Output | Chromium |
|---|---|---|
| `burnmap parse <plan.json> [--out model.json]` | ChangeModel JSON (stdout if no `--out`) | no |
| `burnmap arch <plan.json> --out arch.svg` | arch diagram SVG | no |
| `burnmap arch <plan.json> --out arch.png` | arch diagram PNG | yes (lazy) |
| `burnmap plan <plan.json> --out diff.png` | plan-diff diagram PNG | yes (lazy) |
| `burnmap render <plan.json> --out-dir ./` | model.json + arch.svg + diff.png | yes (lazy, for the PNGs) |

Output format is inferred from the `--out` extension (`.json` / `.svg` /
`.png`). An unsupported extension is an error.

## Data flow

`burnmap <cmd> <plan.json>` → read file → `JSON.parse` → call library function →
write artifact to `--out` / `--out-dir`, or stream JSON to stdout. No network,
no GitHub, no S3, no AWS SDK. The CLI package never imports `@burnmap/action`.

## Chromium handling (lazy / on-demand)

- `parse` and `arch --out *.svg` never touch Chromium.
- PNG paths (`arch --out *.png`, `plan`, `render`) call `ensureChromium()` before
  rendering. On a missing browser it exits non-zero with a friendly hint
  (`run: npx playwright install chromium`) rather than surfacing a raw Playwright
  stack trace.

## Error handling

- Missing / unreadable plan path → exit 2, `burnmap: cannot read <path>`.
- Malformed JSON → exit 2, parse error including the path.
- Unknown subcommand, or missing required `--out` / `--out-dir` → exit 2 + usage line.
- Missing Chromium on a PNG path → exit 3 + install hint.
- Success → exit 0.
- Diagnostics go to **stderr**; artifact bytes / JSON go to **stdout**, so
  `burnmap parse x.json > model.json` pipes cleanly.
- Subcommands throw typed errors; `index.ts` has the single top-level catch that
  maps error kind → exit code.

## Testing

- vitest, following the existing dependency-injection pattern. fs and Chromium
  are injected so unit tests stay browser-free.
- `args.ts` — unit tests for flag / positional / extension parsing and error cases.
- Each command — inject fake `readFile` / `writeFile` and a fake render fn;
  assert the correct library function is called and output is routed correctly
  (stdout vs file). `ensureChromium` injected as a stub.
- One lightweight integration test: `parse` and `arch --out *.svg` against a
  fixture plan using the real libraries (both browser-free). PNG paths are
  covered by unit tests with a stubbed capture step — **no Chromium in CI**.

## Tier-2 publish hygiene (this work; no actual publish)

Goal: `npx github:firebreak-io/burnmap` works end-to-end, and packages are
publish-ready for a later registry push.

- Each `@burnmap/*` package: add a `files` allowlist, confirm `bin`, and ensure
  `prepare` / `build` scripts so an install-from-git builds the tree.
- Root: documented `npx` entry resolving to `@burnmap/cli`.
- Add `repository`, `engines`, and `publishConfig` fields. Keep versions at
  `0.0.0` until a publish decision is made.
- README: a new "CLI / standalone" section — install via npx, the subcommands,
  and the Chromium note.

### Deferred (explicitly out of scope)

- Owning the `@burnmap` npm scope.
- A CI publish workflow.
- semver / changesets / version bumping.
- Actually running `npm publish`.

## Backward compatibility

- No change to `@burnmap/action` behavior.
- Existing per-package bins (`burnmap-parse`, `burnmap-shoot`, `burnmap-graph`)
  stay as-is; `burnmap` is additive.
