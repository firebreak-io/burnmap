# burnmap standalone CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `@burnmap/cli` package exposing one `burnmap` binary with `parse` / `arch` / `plan` / `render` subcommands that wrap the existing GitHub-free libraries, plus the packaging hygiene to run it via `npx github:firebreak-io/burnmap`.

**Architecture:** A thin dispatcher (`index.ts`) parses argv and routes to one of four command modules. Each command module is a pure function that takes a parsed-args object plus an injected `deps` bundle (fs + the relevant library render function + a stdout writer + a clock), so it is unit-testable without touching disk, Chromium, or the real clock. Commands throw a typed `CliError` carrying an exit code; the dispatcher's single top-level catch maps that to `process.exit`.

**Tech Stack:** TypeScript (strict, NodeNext ESM — relative imports end in `.js`), Node ≥22, vitest. No new third-party runtime deps — arg parsing is hand-rolled to match the existing `parser`/`shoot`/`graph` CLIs. Chromium comes transitively via `@burnmap/shoot` → `playwright`.

## Global Constraints

- Node `>=22`; package is `"type": "module"`, NodeNext ESM — **all relative imports end in `.js`**.
- TypeScript strict + `noUncheckedIndexedAccess` (inherited from `tsconfig.base.json`).
- Tests live in `packages/cli/test/*.test.ts` and import implementation from `../src/<file>.js`. Fixtures go in `packages/cli/test/fixtures/`. (Matches every other package — tests are OUTSIDE `src`, which is the only thing `tsc` compiles.)
- No new runtime dependencies beyond the three `@burnmap/*` workspace packages (`"*"`). `playwright` may be imported (already in the tree via `@burnmap/shoot`) — add it as an explicit dependency so the import is honest.
- The CLI package MUST NOT import `@burnmap/action` (no GitHub / S3 / AWS coupling).
- Versions stay `0.0.0`; no `npm publish` in this work.
- Diagnostics → **stderr**; artifact bytes / JSON → **stdout**.
- Exit codes: `0` success; `2` usage / read / JSON errors; `3` missing Chromium.

## Library interfaces this CLI wraps (verbatim, already exported)

```ts
// @burnmap/parser
parsePlan(plan: RawPlan, meta: ChangeMeta): ChangeModel
interface ChangeMeta { repo: string; prNumber: number; commitSha: string; terraformVersion: string; generatedAt: string; }
type RawPlan = { terraform_version?: string; ... }   // re-exported from @burnmap/parser

// @burnmap/graph  (ArchMeta is structurally identical to ChangeMeta)
archToSvg(plan: RawPlan, meta: ArchMeta, opts?: { changes?: ChangeModel }): Promise<string>
archToPng(plan: RawPlan, meta: ArchMeta, outPath: string, opts?: { changes?: ChangeModel }): Promise<string>

// @burnmap/shoot  (plan-diff pipeline)
resolveWebDist(): string
writeShotHtml(webDist: string, model: ChangeModel): string   // returns shotHtmlPath
capture(opts: { shotHtmlPath: string; outPath: string }): Promise<string>
cleanupShotHtml(webDist: string): void

// playwright
chromium.executablePath(): string   // path to the browser binary; file may not exist if not installed
```

## File Structure

```
packages/cli/
  package.json            name @burnmap/cli, bin { burnmap: dist/index.js }, deps + scripts
  tsconfig.json           extends ../../tsconfig.base.json, rootDir src, include ["src"]
  src/
    errors.ts             CliError(message, code)
    args.ts               parseArgs(argv) → ParsedArgs ; outKind(path) → 'svg'|'png'|'json'
    meta.ts               buildMeta(plan, now) → ChangeMeta with CLI defaults
    chromium.ts           ensureChromium(deps) — throws CliError(3) if browser missing
    commands/
      parse.ts            runParse(args, deps)
      arch.ts             runArch(args, deps)
      plan.ts             runPlan(args, deps)
      render.ts           runRender(args, deps)
    index.ts              dispatch + --help/--version + top-level catch → process.exit
  test/
    args.test.ts
    chromium.test.ts
    parse.test.ts
    arch.test.ts
    plan.test.ts
    render.test.ts
    fixtures/simple.json  minimal valid plan JSON
```

---

### Task 1: Scaffold the `@burnmap/cli` package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/errors.ts`
- Create: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CliError` (class, `code: number`); a buildable package whose `burnmap` bin runs `--help` / `--version` and exits `0`.

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@burnmap/cli",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "burnmap": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@burnmap/parser": "*",
    "@burnmap/graph": "*",
    "@burnmap/shoot": "*",
    "playwright": "^1.60.0"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "typescript": "^5.6.0",
    "vitest": "^4.1.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

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

- [ ] **Step 3: Create `packages/cli/src/errors.ts`**

```ts
/** An error carrying the process exit code the CLI should terminate with. */
export class CliError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'CliError';
  }
}
```

- [ ] **Step 4: Create a minimal `packages/cli/src/index.ts` (help/version only for now)**

```ts
#!/usr/bin/env node
import { createRequire } from 'node:module';
import { CliError } from './errors.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const USAGE = `burnmap <command> <plan.json> [options]

Commands:
  parse   <plan.json> [--out model.json]     ChangeModel JSON (stdout if no --out)
  arch    <plan.json> --out <file.svg|.png>  architecture diagram
  plan    <plan.json> --out <file.png>       plan-diff diagram (needs Chromium)
  render  <plan.json> --out-dir <dir>        model.json + arch.svg + diff.png

Options:
  -h, --help       show this help
  -v, --version    print version
`;

async function main(argv: string[]): Promise<void> {
  // Dispatch is added in later tasks. For now only global flags are handled.
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  throw new CliError(`unknown command: ${argv[0]}\n\n${USAGE}`, 2);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CliError) {
    process.stderr.write(`burnmap: ${err.message}\n`);
    process.exit(err.code);
  }
  process.stderr.write(`burnmap: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

Note: `require('../package.json')` resolves from `dist/index.js` to `packages/cli/package.json` at runtime — correct, because `dist/` sits one level below the package root.

- [ ] **Step 5: Install workspaces and build**

Run: `npm install && npm run build -w @burnmap/cli`
Expected: install succeeds (new workspace linked), `tsc` emits `packages/cli/dist/index.js` with no errors.

- [ ] **Step 6: Smoke-test the bin**

Run: `node packages/cli/dist/index.js --version`
Expected: prints `0.0.0`.

Run: `node packages/cli/dist/index.js --help`
Expected: prints the usage block, exits `0`.

Run: `node packages/cli/dist/index.js bogus`
Expected: stderr `burnmap: unknown command: bogus` + usage, exit code `2`.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/src/errors.ts packages/cli/src/index.ts package-lock.json
git commit -m "feat(cli): scaffold @burnmap/cli package with help/version"
```

---

### Task 2: Argument parser (`args.ts`)

**Files:**
- Create: `packages/cli/src/args.ts`
- Test: `packages/cli/test/args.test.ts`

**Interfaces:**
- Consumes: `CliError` from `./errors.js`.
- Produces:
  - `interface ParsedArgs { command?: string; planPath?: string; out?: string; outDir?: string; help: boolean; version: boolean; }`
  - `parseArgs(argv: string[]): ParsedArgs`
  - `outKind(outPath: string): 'svg' | 'png' | 'json'` — throws `CliError(…, 2)` on an unsupported extension.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs, outKind } from '../src/args.js';
import { CliError } from '../src/errors.js';

describe('parseArgs', () => {
  it('reads command, positional plan path, and --out', () => {
    const a = parseArgs(['arch', 'plan.json', '--out', 'out.svg']);
    expect(a.command).toBe('arch');
    expect(a.planPath).toBe('plan.json');
    expect(a.out).toBe('out.svg');
  });

  it('reads --out-dir and short/long help & version flags', () => {
    expect(parseArgs(['render', 'p.json', '--out-dir', './x']).outDir).toBe('./x');
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('treats the first non-flag as command and the second as plan path', () => {
    const a = parseArgs(['parse', 'a/b/plan.json']);
    expect(a.command).toBe('parse');
    expect(a.planPath).toBe('a/b/plan.json');
    expect(a.out).toBeUndefined();
  });
});

describe('outKind', () => {
  it('maps known extensions', () => {
    expect(outKind('x.svg')).toBe('svg');
    expect(outKind('x.PNG')).toBe('png');
    expect(outKind('dir/model.json')).toBe('json');
  });

  it('throws CliError(2) on an unsupported extension', () => {
    expect(() => outKind('x.gif')).toThrowError(CliError);
    try { outKind('x.gif'); } catch (e) { expect((e as CliError).code).toBe(2); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @burnmap/cli -- args`
Expected: FAIL — `args.js` / `parseArgs` not found.

- [ ] **Step 3: Implement `packages/cli/src/args.ts`**

```ts
import { CliError } from './errors.js';

export interface ParsedArgs {
  command?: string;
  planPath?: string;
  out?: string;
  outDir?: string;
  help: boolean;
  version: boolean;
}

/**
 * Hand-rolled parse (same style as the per-package CLIs): the first non-flag
 * token is the command, the second is the plan path. Flags take the next token
 * as their value.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, version: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--out': out.out = argv[++i]; break;
      case '--out-dir': out.outDir = argv[++i]; break;
      case '-h': case '--help': out.help = true; break;
      case '-v': case '--version': out.version = true; break;
      default:
        if (!arg.startsWith('--')) positionals.push(arg);
    }
  }
  out.command = positionals[0];
  out.planPath = positionals[1];
  return out;
}

/** Infer the output format from a file extension. */
export function outKind(outPath: string): 'svg' | 'png' | 'json' {
  const lower = outPath.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.json')) return 'json';
  throw new CliError(`unsupported --out extension: ${outPath} (use .svg, .png, or .json)`, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @burnmap/cli -- args`
Expected: PASS (all `parseArgs` + `outKind` cases).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/args.ts packages/cli/test/args.test.ts
git commit -m "feat(cli): add hand-rolled arg parser and outKind"
```

---

### Task 3: Meta builder + Chromium guard

**Files:**
- Create: `packages/cli/src/meta.ts`
- Create: `packages/cli/src/chromium.ts`
- Test: `packages/cli/test/chromium.test.ts`

**Interfaces:**
- Consumes: `CliError` from `./errors.js`; `RawPlan`, `ChangeMeta` types from `@burnmap/parser`.
- Produces:
  - `buildMeta(plan: RawPlan, now: string): ChangeMeta` — CLI defaults (empty repo/sha, PR 0), `terraformVersion` from the plan, `generatedAt = now`. The returned `ChangeMeta` is structurally usable wherever `ArchMeta` is expected.
  - `interface ChromiumDeps { executablePath: () => string; exists: (p: string) => boolean; }`
  - `ensureChromium(deps: ChromiumDeps): void` — throws `CliError(…, 3)` with the install hint if the browser binary is absent.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/chromium.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ensureChromium } from '../src/chromium.js';
import { CliError } from '../src/errors.js';

describe('ensureChromium', () => {
  it('passes when the browser binary exists', () => {
    expect(() => ensureChromium({
      executablePath: () => '/browsers/chromium/chrome',
      exists: () => true,
    })).not.toThrow();
  });

  it('throws CliError(3) with the install hint when the binary is missing', () => {
    try {
      ensureChromium({ executablePath: () => '/browsers/chromium/chrome', exists: () => false });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe(3);
      expect((e as CliError).message).toContain('npx playwright install chromium');
    }
  });

  it('throws CliError(3) when executablePath itself throws (no browsers registered)', () => {
    try {
      ensureChromium({
        executablePath: () => { throw new Error('Executable doesn\'t exist'); },
        exists: () => true,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe(3);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @burnmap/cli -- chromium`
Expected: FAIL — `chromium.js` / `ensureChromium` not found.

- [ ] **Step 3: Implement `packages/cli/src/meta.ts`**

```ts
import type { RawPlan, ChangeMeta } from '@burnmap/parser';

/**
 * CLI default metadata. There is no PR / repo / commit in a standalone run, so
 * those are blank; the plan file is authoritative for the Terraform version.
 * Structurally identical to graph's ArchMeta, so it serves both renderers.
 */
export function buildMeta(plan: RawPlan, now: string): ChangeMeta {
  return {
    repo: '',
    prNumber: 0,
    commitSha: '',
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: now,
  };
}
```

- [ ] **Step 4: Implement `packages/cli/src/chromium.ts`**

```ts
import { CliError } from './errors.js';

export interface ChromiumDeps {
  /** Path Playwright would launch (playwright's chromium.executablePath). */
  executablePath: () => string;
  /** Filesystem existence check (node:fs existsSync). */
  exists: (p: string) => boolean;
}

const HINT = 'Chromium is not installed. Run: npx playwright install chromium';

/** Throw CliError(3) with a friendly hint unless a usable Chromium is present. */
export function ensureChromium(deps: ChromiumDeps): void {
  let path: string;
  try {
    path = deps.executablePath();
  } catch {
    // Playwright throws if no browser is registered at all.
    throw new CliError(HINT, 3);
  }
  if (!path || !deps.exists(path)) {
    throw new CliError(HINT, 3);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @burnmap/cli -- chromium`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/meta.ts packages/cli/src/chromium.ts packages/cli/test/chromium.test.ts
git commit -m "feat(cli): add buildMeta defaults and lazy Chromium guard"
```

---

### Task 4: `parse` command

**Files:**
- Create: `packages/cli/src/commands/parse.ts`
- Create: `packages/cli/test/fixtures/simple.json`
- Test: `packages/cli/test/parse.test.ts`
- Modify: `packages/cli/src/index.ts` (wire dispatch)

**Interfaces:**
- Consumes: `parseArgs`/`ParsedArgs` (`../args.js`), `buildMeta` (`../meta.js`), `CliError` (`../errors.js`), `parsePlan` + `RawPlan` (`@burnmap/parser`).
- Produces:
  - `interface ParseDeps { readFile: (p: string) => string; writeFile: (p: string, data: string) => void; stdout: (s: string) => void; now: () => string; }`
  - `runParse(args: ParsedArgs, deps: ParseDeps): void`

- [ ] **Step 1: Create the fixture `packages/cli/test/fixtures/simple.json`**

```json
{
  "format_version": "1.2",
  "terraform_version": "1.12.1",
  "resource_changes": [
    {
      "address": "aws_s3_bucket.logs",
      "module_address": "",
      "type": "aws_s3_bucket",
      "name": "logs",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": { "actions": ["create"], "before": null, "after": { "bucket": "logs" } }
    }
  ],
  "output_changes": {},
  "configuration": { "root_module": {} }
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/cli/test/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runParse } from '../src/commands/parse.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));
const NOW = '2026-06-23T00:00:00Z';

function deps(overrides = {}) {
  const written: Record<string, string> = {};
  const printed: string[] = [];
  return {
    written, printed,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    writeFile: (p: string, d: string) => { written[p] = d; },
    stdout: (s: string) => { printed.push(s); },
    now: () => NOW,
    ...overrides,
  };
}

describe('runParse', () => {
  it('prints ChangeModel JSON to stdout when no --out', () => {
    const d = deps();
    runParse(parseArgs(['parse', fixture]), d);
    const printed = d.printed.join('');
    const model = JSON.parse(printed);
    expect(model.summary.create).toBe(1);
    expect(model.meta.terraformVersion).toBe('1.12.1');
    expect(Object.keys(d.written)).toHaveLength(0);
  });

  it('writes JSON to --out and prints nothing to stdout', () => {
    const d = deps();
    runParse(parseArgs(['parse', fixture, '--out', 'model.json']), d);
    expect(d.printed.join('')).toBe('');
    expect(JSON.parse(d.written['model.json']!).summary.create).toBe(1);
  });

  it('throws CliError(2) when plan path is missing', () => {
    try { runParse(parseArgs(['parse']), deps()); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('throws CliError(2) on unreadable plan', () => {
    const d = deps({ readFile: () => { throw new Error('ENOENT'); } });
    try { runParse(parseArgs(['parse', 'nope.json']), d); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('throws CliError(2) on invalid JSON', () => {
    const d = deps({ readFile: () => '{ not json' });
    try { runParse(parseArgs(['parse', 'bad.json']), d); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('rejects a non-.json --out', () => {
    try { runParse(parseArgs(['parse', fixture, '--out', 'x.png']), deps()); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @burnmap/cli -- parse`
Expected: FAIL — `commands/parse.js` / `runParse` not found.

- [ ] **Step 4: Implement `packages/cli/src/commands/parse.ts`**

```ts
import { parsePlan, type RawPlan } from '@burnmap/parser';
import type { ParsedArgs } from '../args.js';
import { outKind } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface ParseDeps {
  readFile: (p: string) => string;
  writeFile: (p: string, data: string) => void;
  stdout: (s: string) => void;
  now: () => string;
}

export function runParse(args: ParsedArgs, deps: ParseDeps): void {
  if (!args.planPath) throw new CliError('parse requires a <plan.json> path', 2);
  if (args.out && outKind(args.out) !== 'json') {
    throw new CliError(`parse --out must end in .json (got ${args.out})`, 2);
  }

  let raw: string;
  try {
    raw = deps.readFile(args.planPath);
  } catch (err) {
    throw new CliError(`cannot read ${args.planPath}: ${(err as Error).message}`, 2);
  }

  let plan: RawPlan;
  try {
    plan = JSON.parse(raw) as RawPlan;
  } catch (err) {
    throw new CliError(`invalid JSON in ${args.planPath}: ${(err as Error).message}`, 2);
  }

  const model = parsePlan(plan, buildMeta(plan, deps.now()));
  const json = `${JSON.stringify(model, null, 2)}\n`;
  if (args.out) deps.writeFile(args.out, json);
  else deps.stdout(json);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @burnmap/cli -- parse`
Expected: PASS (all six cases).

- [ ] **Step 6: Wire dispatch into `packages/cli/src/index.ts`**

Add the imports near the top (after the `CliError` import):

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from './args.js';
import { runParse } from './commands/parse.js';
```

Replace the body of `main` (keep the version/help handling) so it parses args and dispatches:

```ts
async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.version) { process.stdout.write(`${pkg.version}\n`); return; }
  if (args.help || !args.command) { process.stdout.write(USAGE); return; }

  switch (args.command) {
    case 'parse':
      runParse(args, {
        readFile: (p) => readFileSync(p, 'utf8'),
        writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
        stdout: (s) => process.stdout.write(s),
        now: () => new Date().toISOString(),
      });
      return;
    default:
      throw new CliError(`unknown command: ${args.command}\n\n${USAGE}`, 2);
  }
}
```

- [ ] **Step 7: Build and smoke-test end to end**

Run: `npm run build -w @burnmap/cli && node packages/cli/dist/index.js parse packages/cli/test/fixtures/simple.json`
Expected: prints ChangeModel JSON with `"create": 1`, exit `0`.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/parse.ts packages/cli/src/index.ts packages/cli/test/parse.test.ts packages/cli/test/fixtures/simple.json
git commit -m "feat(cli): add parse subcommand"
```

---

### Task 5: `arch` command

**Files:**
- Create: `packages/cli/src/commands/arch.ts`
- Test: `packages/cli/test/arch.test.ts`
- Modify: `packages/cli/src/index.ts` (add `arch` case)

**Interfaces:**
- Consumes: `ParsedArgs` + `outKind` (`../args.js`), `buildMeta` (`../meta.js`), `ensureChromium` (`../chromium.js`), `CliError` (`../errors.js`), `RawPlan` + `ChangeMeta` (`@burnmap/parser`).
- Produces:
  - `interface ArchDeps { readFile: (p: string) => string; renderSvg: (plan: RawPlan, meta: ChangeMeta) => Promise<string>; renderPng: (plan: RawPlan, meta: ChangeMeta, out: string) => Promise<string>; writeFile: (p: string, data: string) => void; stdout: (s: string) => void; ensureChromium: () => void; now: () => string; }`
  - `runArch(args: ParsedArgs, deps: ArchDeps): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/arch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runArch } from '../src/commands/arch.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));

function deps(overrides = {}) {
  const written: Record<string, string> = {};
  const calls: string[] = [];
  return {
    written, calls,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    renderSvg: async () => { calls.push('svg'); return '<svg/>'; },
    renderPng: async (_p: unknown, _m: unknown, out: string) => { calls.push('png'); written[out] = 'PNG'; return out; },
    writeFile: (p: string, d: string) => { written[p] = d; },
    stdout: () => {},
    ensureChromium: () => { calls.push('ensure'); },
    now: () => '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

describe('runArch', () => {
  it('writes SVG without touching Chromium', async () => {
    const d = deps();
    await runArch(parseArgs(['arch', fixture, '--out', 'arch.svg']), d);
    expect(d.written['arch.svg']).toBe('<svg/>');
    expect(d.calls).toContain('svg');
    expect(d.calls).not.toContain('ensure');
  });

  it('calls ensureChromium then renderPng for a .png target', async () => {
    const d = deps();
    await runArch(parseArgs(['arch', fixture, '--out', 'arch.png']), d);
    expect(d.calls).toEqual(['ensure', 'png']);
    expect(d.written['arch.png']).toBe('PNG');
  });

  it('does NOT render when Chromium guard throws', async () => {
    const d = deps({ ensureChromium: () => { throw new CliError('no chromium', 3); } });
    await expect(runArch(parseArgs(['arch', fixture, '--out', 'arch.png']), d)).rejects.toMatchObject({ code: 3 });
    expect(d.calls).not.toContain('png');
  });

  it('requires --out (CliError 2)', async () => {
    await expect(runArch(parseArgs(['arch', fixture]), deps())).rejects.toMatchObject({ code: 2 });
  });

  it('rejects a .json --out (CliError 2)', async () => {
    await expect(runArch(parseArgs(['arch', fixture, '--out', 'x.json']), deps())).rejects.toMatchObject({ code: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @burnmap/cli -- arch`
Expected: FAIL — `commands/arch.js` / `runArch` not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/arch.ts`**

```ts
import type { RawPlan, ChangeMeta } from '@burnmap/parser';
import type { ParsedArgs } from '../args.js';
import { outKind } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface ArchDeps {
  readFile: (p: string) => string;
  renderSvg: (plan: RawPlan, meta: ChangeMeta) => Promise<string>;
  renderPng: (plan: RawPlan, meta: ChangeMeta, out: string) => Promise<string>;
  writeFile: (p: string, data: string) => void;
  stdout: (s: string) => void;
  ensureChromium: () => void;
  now: () => string;
}

export async function runArch(args: ParsedArgs, deps: ArchDeps): Promise<void> {
  if (!args.planPath) throw new CliError('arch requires a <plan.json> path', 2);
  if (!args.out) throw new CliError('arch requires --out <file.svg|file.png>', 2);
  const kind = outKind(args.out); // throws CliError(2) on a bad extension
  if (kind === 'json') throw new CliError('arch --out must be .svg or .png', 2);

  let plan: RawPlan;
  try {
    plan = JSON.parse(deps.readFile(args.planPath)) as RawPlan;
  } catch (err) {
    throw new CliError(`cannot read or parse ${args.planPath}: ${(err as Error).message}`, 2);
  }

  const meta = buildMeta(plan, deps.now());
  if (kind === 'svg') {
    deps.writeFile(args.out, await deps.renderSvg(plan, meta));
  } else {
    deps.ensureChromium();
    await deps.renderPng(plan, meta, args.out);
  }
  deps.stdout(`${args.out}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @burnmap/cli -- arch`
Expected: PASS (all five cases).

- [ ] **Step 5: Wire the `arch` case into `index.ts`**

Add imports:

```ts
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { archToSvg, archToPng } from '@burnmap/graph';
import { runArch } from './commands/arch.js';
import { ensureChromium } from './chromium.js';
```

Add a `case 'arch':` before `default:` in the `switch`:

```ts
    case 'arch':
      await runArch(args, {
        readFile: (p) => readFileSync(p, 'utf8'),
        renderSvg: (plan, meta) => archToSvg(plan, meta),
        renderPng: (plan, meta, out) => archToPng(plan, meta, out),
        writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
        stdout: (s) => process.stdout.write(s),
        ensureChromium: () => ensureChromium({
          executablePath: () => chromium.executablePath(),
          exists: existsSync,
        }),
        now: () => new Date().toISOString(),
      });
      return;
```

- [ ] **Step 6: Build and smoke-test the SVG path (no Chromium needed)**

Run: `npm run build -w @burnmap/cli && node packages/cli/dist/index.js arch packages/cli/test/fixtures/simple.json --out /tmp/arch.svg && head -c 60 /tmp/arch.svg`
Expected: prints `/tmp/arch.svg` to stdout; file begins with `<svg` (or an `<?xml`/`<svg` wrapper).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/arch.ts packages/cli/src/index.ts packages/cli/test/arch.test.ts
git commit -m "feat(cli): add arch subcommand (svg free, png lazy-Chromium)"
```

---

### Task 6: `plan` command (plan-diff PNG)

**Files:**
- Create: `packages/cli/src/commands/plan.ts`
- Test: `packages/cli/test/plan.test.ts`
- Modify: `packages/cli/src/index.ts` (add `plan` case)

**Interfaces:**
- Consumes: `ParsedArgs` + `outKind` (`../args.js`), `buildMeta` (`../meta.js`), `CliError` (`../errors.js`), `parsePlan` + `RawPlan` + `ChangeModel` (`@burnmap/parser`).
- Produces:
  - `interface PlanDeps { readFile: (p: string) => string; renderDiffPng: (model: ChangeModel, out: string) => Promise<void>; stdout: (s: string) => void; ensureChromium: () => void; now: () => string; }`
  - `runPlan(args: ParsedArgs, deps: PlanDeps): Promise<void>`

The diff PNG pipeline (`resolveWebDist` → `writeShotHtml` → `capture` → `cleanupShotHtml`) is assembled in `index.ts` and injected as a single `renderDiffPng` so the command stays browser-free in tests.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../src/commands/plan.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));

function deps(overrides = {}) {
  const calls: string[] = [];
  const written: string[] = [];
  return {
    calls, written,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    renderDiffPng: async (_model: unknown, out: string) => { calls.push('render'); written.push(out); },
    stdout: () => {},
    ensureChromium: () => { calls.push('ensure'); },
    now: () => '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

describe('runPlan', () => {
  it('guards Chromium before rendering the diff PNG', async () => {
    const d = deps();
    await runPlan(parseArgs(['plan', fixture, '--out', 'diff.png']), d);
    expect(d.calls).toEqual(['ensure', 'render']);
    expect(d.written).toEqual(['diff.png']);
  });

  it('does NOT render when the Chromium guard throws', async () => {
    const d = deps({ ensureChromium: () => { throw new CliError('no chromium', 3); } });
    await expect(runPlan(parseArgs(['plan', fixture, '--out', 'diff.png']), d)).rejects.toMatchObject({ code: 3 });
    expect(d.calls).not.toContain('render');
  });

  it('requires --out (CliError 2)', async () => {
    await expect(runPlan(parseArgs(['plan', fixture]), deps())).rejects.toMatchObject({ code: 2 });
  });

  it('rejects a non-.png --out (CliError 2)', async () => {
    await expect(runPlan(parseArgs(['plan', fixture, '--out', 'x.svg']), deps())).rejects.toMatchObject({ code: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @burnmap/cli -- plan`
Expected: FAIL — `commands/plan.js` / `runPlan` not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/plan.ts`**

```ts
import { parsePlan, type RawPlan, type ChangeModel } from '@burnmap/parser';
import type { ParsedArgs } from '../args.js';
import { outKind } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface PlanDeps {
  readFile: (p: string) => string;
  renderDiffPng: (model: ChangeModel, out: string) => Promise<void>;
  stdout: (s: string) => void;
  ensureChromium: () => void;
  now: () => string;
}

export async function runPlan(args: ParsedArgs, deps: PlanDeps): Promise<void> {
  if (!args.planPath) throw new CliError('plan requires a <plan.json> path', 2);
  if (!args.out) throw new CliError('plan requires --out <file.png>', 2);
  if (outKind(args.out) !== 'png') throw new CliError('plan --out must be .png', 2);

  let plan: RawPlan;
  try {
    plan = JSON.parse(deps.readFile(args.planPath)) as RawPlan;
  } catch (err) {
    throw new CliError(`cannot read or parse ${args.planPath}: ${(err as Error).message}`, 2);
  }

  const model = parsePlan(plan, buildMeta(plan, deps.now()));
  deps.ensureChromium();
  await deps.renderDiffPng(model, args.out);
  deps.stdout(`${args.out}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @burnmap/cli -- plan`
Expected: PASS (all four cases).

- [ ] **Step 5: Wire the `plan` case into `index.ts`**

Add imports:

```ts
import { resolveWebDist, writeShotHtml, capture, cleanupShotHtml } from '@burnmap/shoot';
import { runPlan } from './commands/plan.js';
import type { ChangeModel } from '@burnmap/parser';
```

Add a `case 'plan':` before `default:`:

```ts
    case 'plan':
      await runPlan(args, {
        readFile: (p) => readFileSync(p, 'utf8'),
        renderDiffPng: async (model: ChangeModel, out: string) => {
          const webDist = resolveWebDist();
          const shotHtml = writeShotHtml(webDist, model);
          try {
            await capture({ shotHtmlPath: shotHtml, outPath: out });
          } finally {
            cleanupShotHtml(webDist);
          }
        },
        stdout: (s) => process.stdout.write(s),
        ensureChromium: () => ensureChromium({
          executablePath: () => chromium.executablePath(),
          exists: existsSync,
        }),
        now: () => new Date().toISOString(),
      });
      return;
```

- [ ] **Step 6: Build and verify the usage guard**

Run: `npm run build -w @burnmap/cli && node packages/cli/dist/index.js plan packages/cli/test/fixtures/simple.json --out x.svg; echo "exit=$?"`
Expected: stderr `burnmap: plan --out must be .png`, `exit=2` (no Chromium needed to prove the guard order).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/plan.ts packages/cli/src/index.ts packages/cli/test/plan.test.ts
git commit -m "feat(cli): add plan-diff subcommand"
```

---

### Task 7: `render` all-in-one command

**Files:**
- Create: `packages/cli/src/commands/render.ts`
- Test: `packages/cli/test/render.test.ts`
- Modify: `packages/cli/src/index.ts` (add `render` case)

**Interfaces:**
- Consumes: `ParsedArgs` (`../args.js`), `buildMeta` (`../meta.js`), `CliError` (`../errors.js`), `parsePlan` + `RawPlan` + `ChangeMeta` + `ChangeModel` (`@burnmap/parser`).
- Produces:
  - `interface RenderDeps { readFile: (p: string) => string; writeFile: (p: string, data: string) => void; renderArchSvg: (plan: RawPlan, meta: ChangeMeta) => Promise<string>; renderDiffPng: (model: ChangeModel, out: string) => Promise<void>; join: (a: string, b: string) => string; stdout: (s: string) => void; ensureChromium: () => void; now: () => string; }`
  - `runRender(args: ParsedArgs, deps: RenderDeps): Promise<void>`

Emits three files into `--out-dir`: `model.json`, `arch.svg`, `diff.png`. The diff PNG needs Chromium, so `ensureChromium` is called once up front (fail fast before writing partial output). `join` is injected (`node:path` `join`) so tests control path composition.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runRender } from '../src/commands/render.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));

function deps(overrides = {}) {
  const written: Record<string, string> = {};
  const calls: string[] = [];
  return {
    written, calls,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    writeFile: (p: string, d: string) => { written[p] = d; },
    renderArchSvg: async () => { calls.push('arch'); return '<svg/>'; },
    renderDiffPng: async (_m: unknown, out: string) => { calls.push('diff'); written[out] = 'PNG'; },
    join: (a: string, b: string) => `${a}/${b}`,
    stdout: () => {},
    ensureChromium: () => { calls.push('ensure'); },
    now: () => '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

describe('runRender', () => {
  it('emits model.json + arch.svg + diff.png into --out-dir', async () => {
    const d = deps();
    await runRender(parseArgs(['render', fixture, '--out-dir', 'out']), d);
    expect(JSON.parse(d.written['out/model.json']!).summary.create).toBe(1);
    expect(d.written['out/arch.svg']).toBe('<svg/>');
    expect(d.written['out/diff.png']).toBe('PNG');
    // Chromium guard runs before any PNG work.
    expect(d.calls.indexOf('ensure')).toBeLessThan(d.calls.indexOf('diff'));
  });

  it('fails fast (CliError 3) without writing anything when Chromium is missing', async () => {
    const d = deps({ ensureChromium: () => { throw new CliError('no chromium', 3); } });
    await expect(runRender(parseArgs(['render', fixture, '--out-dir', 'out']), d)).rejects.toMatchObject({ code: 3 });
    expect(Object.keys(d.written)).toHaveLength(0);
  });

  it('requires --out-dir (CliError 2)', async () => {
    await expect(runRender(parseArgs(['render', fixture]), deps())).rejects.toMatchObject({ code: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @burnmap/cli -- render`
Expected: FAIL — `commands/render.js` / `runRender` not found.

- [ ] **Step 3: Implement `packages/cli/src/commands/render.ts`**

```ts
import { parsePlan, type RawPlan, type ChangeMeta, type ChangeModel } from '@burnmap/parser';
import type { ParsedArgs } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface RenderDeps {
  readFile: (p: string) => string;
  writeFile: (p: string, data: string) => void;
  renderArchSvg: (plan: RawPlan, meta: ChangeMeta) => Promise<string>;
  renderDiffPng: (model: ChangeModel, out: string) => Promise<void>;
  join: (a: string, b: string) => string;
  stdout: (s: string) => void;
  ensureChromium: () => void;
  now: () => string;
}

export async function runRender(args: ParsedArgs, deps: RenderDeps): Promise<void> {
  if (!args.planPath) throw new CliError('render requires a <plan.json> path', 2);
  if (!args.outDir) throw new CliError('render requires --out-dir <dir>', 2);

  let plan: RawPlan;
  try {
    plan = JSON.parse(deps.readFile(args.planPath)) as RawPlan;
  } catch (err) {
    throw new CliError(`cannot read or parse ${args.planPath}: ${(err as Error).message}`, 2);
  }

  // Fail fast before writing partial output: the diff PNG needs Chromium.
  deps.ensureChromium();

  const meta = buildMeta(plan, deps.now());
  const model = parsePlan(plan, meta);

  const modelPath = deps.join(args.outDir, 'model.json');
  const archPath = deps.join(args.outDir, 'arch.svg');
  const diffPath = deps.join(args.outDir, 'diff.png');

  deps.writeFile(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  deps.writeFile(archPath, await deps.renderArchSvg(plan, meta));
  await deps.renderDiffPng(model, diffPath);

  deps.stdout(`${modelPath}\n${archPath}\n${diffPath}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @burnmap/cli -- render`
Expected: PASS (all three cases).

- [ ] **Step 5: Wire the `render` case into `index.ts`**

Add imports:

```ts
import { join } from 'node:path';
import { runRender } from './commands/render.js';
```

Add a `case 'render':` before `default:`. It reuses the same diff-PNG closure as the `plan` case:

```ts
    case 'render':
      await runRender(args, {
        readFile: (p) => readFileSync(p, 'utf8'),
        writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
        renderArchSvg: (plan, meta) => archToSvg(plan, meta),
        renderDiffPng: async (model: ChangeModel, out: string) => {
          const webDist = resolveWebDist();
          const shotHtml = writeShotHtml(webDist, model);
          try {
            await capture({ shotHtmlPath: shotHtml, outPath: out });
          } finally {
            cleanupShotHtml(webDist);
          }
        },
        join: (a, b) => join(a, b),
        stdout: (s) => process.stdout.write(s),
        ensureChromium: () => ensureChromium({
          executablePath: () => chromium.executablePath(),
          exists: existsSync,
        }),
        now: () => new Date().toISOString(),
      });
      return;
```

Note: the diff-PNG closure now appears in both the `plan` and `render` cases. If a reviewer prefers, extract it to a local `const renderDiffPng = (model, out) => {…}` above the `switch` and reference it in both — functionally identical; do whichever keeps `index.ts` clearest.

- [ ] **Step 6: Build and run the full unit suite**

Run: `npm run build -w @burnmap/cli && npm test -w @burnmap/cli`
Expected: build clean; all test files (`args`, `chromium`, `parse`, `arch`, `plan`, `render`) PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/render.ts packages/cli/src/index.ts packages/cli/test/render.test.ts
git commit -m "feat(cli): add render all-in-one subcommand"
```

---

### Task 8: Publish hygiene + docs (Tier 2, no actual publish)

**Files:**
- Modify: `packages/cli/package.json` (add `files`, `repository`, `engines`, `publishConfig`)
- Modify: `packages/parser/package.json`, `packages/shoot/package.json`, `packages/graph/package.json`, `packages/web/package.json` (add `files` allowlist + `repository`)
- Modify: `README.md` (new "Standalone CLI" section)

**Interfaces:**
- Consumes: the finished CLI from Tasks 1–7.
- Produces: packages that build cleanly from a fresh clone and are publish-ready; user-facing docs for the standalone CLI.

- [ ] **Step 1: Add publish metadata to `packages/cli/package.json`**

Add these fields (alongside the existing ones from Task 1):

```json
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "repository": { "type": "git", "url": "https://github.com/firebreak-io/burnmap.git", "directory": "packages/cli" },
  "publishConfig": { "access": "public" }
```

- [ ] **Step 2: Add a `files` allowlist + `repository` to each core package**

For `packages/parser/package.json`, `packages/shoot/package.json`, `packages/graph/package.json`, add (if missing):

```json
  "files": ["dist"],
  "repository": { "type": "git", "url": "https://github.com/firebreak-io/burnmap.git", "directory": "packages/<name>" }
```

(Use the matching `<name>`: `parser` / `shoot` / `graph`.) For `packages/web/package.json` set `"files": ["dist"]`. **Verify** `@burnmap/shoot`'s `resolveWebDist()` resolves to a path under a published `dist` (read `packages/shoot/src/web-dist.ts`): whatever directory it reads at runtime MUST be inside some package's `files` allowlist, or `npx`-from-git installs would render blank. If it points at `@burnmap/web`'s `dist`, the `web` `files: ["dist"]` above covers it; if elsewhere, widen that package's allowlist accordingly.

- [ ] **Step 3: Verify a clean build from scratch**

Run: `rm -rf packages/*/dist node_modules && npm install && npm run build`
Expected: every workspace builds; `packages/cli/dist/index.js` exists.

- [ ] **Step 4: Verify the bin resolves through npm**

Run: `npm exec -w @burnmap/cli burnmap -- --version`
Expected: prints `0.0.0`.

- [ ] **Step 5: Add the "Standalone CLI" section to `README.md`**

Insert after the "Architecture diagrams" section:

```markdown
## Standalone CLI

burnmap's core is GitHub-free and runs locally via a single `burnmap` binary —
no S3, no PR, no AWS. Run it without cloning:

    npx github:firebreak-io/burnmap parse  plan.json
    npx github:firebreak-io/burnmap arch   plan.json --out arch.svg
    npx github:firebreak-io/burnmap plan   plan.json --out diff.png
    npx github:firebreak-io/burnmap render plan.json --out-dir ./out

Commands:

| Command | Output | Needs Chromium |
|---|---|---|
| `parse <plan.json> [--out model.json]` | ChangeModel JSON (stdout if no `--out`) | no |
| `arch <plan.json> --out <file.svg\|.png>` | architecture diagram | only for `.png` |
| `plan <plan.json> --out <file.png>` | plan-diff diagram | yes |
| `render <plan.json> --out-dir <dir>` | `model.json` + `arch.svg` + `diff.png` | yes |

Generate `plan.json` with `tofu show -json tfplan > plan.json`. PNG output
needs a one-time Chromium install; the CLI prints the exact command
(`npx playwright install chromium`) if it's missing. Exit codes: `0` success,
`2` usage / read / parse error, `3` Chromium not installed.
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json packages/parser/package.json packages/shoot/package.json packages/graph/package.json packages/web/package.json README.md
git commit -m "chore(cli): publish hygiene + standalone CLI docs"
```

---

## Self-Review

**Spec coverage:**
- Unified `@burnmap/cli` + one `burnmap` bin → Task 1. ✓
- `parse` / `arch` / `plan` / `render` subcommands → Tasks 4 / 5 / 6 / 7. ✓
- Output format inferred from `--out` extension → `outKind` (Task 2), used in 4/5/6. ✓
- Lazy Chromium (free for parse + arch-svg; guarded for PNG paths) → Task 3 `ensureChromium`, wired in 5/6/7. ✓
- Error handling + exit codes (2 usage/read/json, 3 chromium, 0 ok; stderr vs stdout) → `CliError` (Task 1), per-command tests (4–7), dispatcher catch (Task 1/4). ✓
- Testing via DI, browser-free, fixtures in `test/fixtures/` → every command task. ✓
- Tier-2 publish hygiene + README → Task 8. ✓
- No `@burnmap/action` import, no new third-party runtime deps, versions stay `0.0.0` → Global Constraints + package.json (Task 1/8). ✓
- Deferred items (scope ownership, CI publish, semver) → intentionally absent. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command/type referenced (`CliError`, `ParsedArgs`, `parseArgs`, `outKind`, `buildMeta`, `ensureChromium`, `runParse/runArch/runPlan/runRender`) is defined in an earlier task.

**Type consistency:** `ParsedArgs` shape identical across tasks. `buildMeta(plan, now)` returns `ChangeMeta`, accepted by `archToSvg`/`archToPng` (`ArchMeta` is structurally identical — verified against `packages/graph/src/types.ts`). Command `deps` interfaces each declare exactly the functions their `index.ts` wiring supplies. `CliError.code` used consistently (2/3).

**Open verification item (Task 8 Step 2):** the published `files` allowlist must include whatever `resolveWebDist()` reads at runtime; flagged inline for the implementer to confirm before relying on `npx`-from-git.
