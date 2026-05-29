# burnmap Parser (`@burnmap/parser`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@burnmap/parser` — a TypeScript library that turns `tofu show -json` plan output into the normalized, danger-scored, secret-redacted `ChangeModel` consumed by the rest of burnmap.

**Architecture:** Pure functions composed into one `parsePlan(plan, meta) → ChangeModel` entrypoint, plus a thin CLI that reads a plan JSON file and prints the model. No I/O in the core; everything is unit-testable. This is Phase 1 of the burnmap monorepo; later phases (`web`, `shoot`, `action`, Tofu infra) get their own plans.

**Tech Stack:** TypeScript (ESM, NodeNext), npm workspaces, Vitest, tsx. Node 22.

**Spec:** `docs/superpowers/specs/2026-05-29-burnmap-plan-visualizer-design.md` (see "Data contract — `ChangeModel`").

---

## File structure (this phase)

```
package.json                      # root — npm workspaces
tsconfig.base.json                # shared TS config
packages/parser/
  package.json                    # @burnmap/parser
  tsconfig.json
  vitest.config.ts
  src/
    plan-json.ts                  # raw tofu JSON input types
    types.ts                      # ChangeModel + friends (output types)
    actions.ts                    # mapAction()
    paths.ts                      # flattenLeaves, flattenTruePaths, pathToString, isCoveredBy
    attributes.ts                 # diffAttributes()
    danger.ts                     # scoreDanger()
    grouping.ts                   # groupByModule(), parseOutputs()
    parse.ts                      # parsePlan() orchestrator + toResourceChange()
    cli.ts                        # read plan.json file → print ChangeModel JSON
    index.ts                      # public exports
  test/
    actions.test.ts
    paths.test.ts
    attributes.test.ts
    danger.test.ts
    grouping.test.ts
    parse.test.ts
    cli.test.ts
    fixtures/
      simple-create.json
      replace-db.json
      sensitive.json
      empty.json
```

**Responsibilities:** each `src/*.ts` is one pure concern. `parse.ts` is the only file that knows how the pieces compose. `cli.ts` is the only file that touches the filesystem/process.

---

## Task 1: Monorepo + parser package scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/parser/package.json`
- Create: `packages/parser/tsconfig.json`
- Create: `packages/parser/vitest.config.ts`

- [ ] **Step 1: Create the root workspace `package.json`**

`package.json`:
```json
{
  "name": "burnmap",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create the shared `tsconfig.base.json`**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Create the parser package manifest**

`packages/parser/package.json`:
```json
{
  "name": "@burnmap/parser",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "burnmap-parse": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 4: Create the parser `tsconfig.json`**

`packages/parser/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create the Vitest config**

`packages/parser/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: creates `package-lock.json` and `node_modules/`, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json packages/parser/package.json packages/parser/tsconfig.json packages/parser/vitest.config.ts package-lock.json
git commit -m "chore: scaffold burnmap monorepo and @burnmap/parser package"
```

---

## Task 2: Type definitions (raw input + output model)

These are type-only modules — no runtime test. They are validated by every later task compiling against them.

**Files:**
- Create: `packages/parser/src/plan-json.ts`
- Create: `packages/parser/src/types.ts`

- [ ] **Step 1: Create the raw tofu JSON input types**

`packages/parser/src/plan-json.ts`:
```ts
// Minimal shape of `tofu show -json <planfile>` output that the parser reads.
// Only fields burnmap consumes are typed; everything else is ignored.

export interface RawChange {
  /** e.g. ["create"], ["update"], ["delete"], ["no-op"], ["read"],
   *  ["create","delete"] or ["delete","create"] for a replace. */
  actions: string[];
  before: unknown;
  after: unknown;
  /** Mirrors `after` structure with `true` at attributes "known after apply". */
  after_unknown?: unknown;
  /** Mirrors structure with `true` at sensitive attributes (or `false`). */
  before_sensitive?: unknown;
  after_sensitive?: unknown;
  /** Attribute paths (arrays of string/number segments) that force replacement. */
  replace_paths?: Array<Array<string | number>>;
}

export interface RawResourceChange {
  address: string;
  module_address?: string;
  mode: string;
  type: string;
  name: string;
  index?: string | number;
  provider_name: string;
  change: RawChange;
}

export interface RawPlan {
  format_version?: string;
  terraform_version?: string;
  resource_changes?: RawResourceChange[];
  output_changes?: Record<string, RawChange>;
  resource_drift?: RawResourceChange[];
}
```

- [ ] **Step 2: Create the output model types**

`packages/parser/src/types.ts`:
```ts
export type Action = 'create' | 'update' | 'delete' | 'replace' | 'no-op' | 'read';

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AttrChange {
  path: string;                 // "instance_type", "tags.Name", "ingress[0].cidr"
  before: JsonValue | null;
  after: JsonValue | null;
  sensitive: boolean;           // value redacted to «sensitive»
  unknown: boolean;             // "(known after apply)"
  forcesReplacement: boolean;
}

export interface ResourceChange {
  address: string;              // "module.vpc.aws_subnet.public[0]"
  module: string;               // "module.vpc" ("" = root)
  type: string;                 // "aws_subnet"
  name: string;                 // "public"
  provider: string;
  action: Action;
  attrs: AttrChange[];          // only changed paths; empty for create/delete
  dangerScore: number;
  dangerReasons: string[];
}

export interface OutputChange {
  name: string;
  action: Action;
  sensitive: boolean;
}

export interface ResourceTypeGroup {
  type: string;
  resources: ResourceChange[];
}

export interface ModuleGroup {
  module: string;
  types: ResourceTypeGroup[];
}

export interface ChangeSummary {
  create: number;
  update: number;
  delete: number;
  replace: number;
  noop: number;
  read: number;
}

export interface ChangeMeta {
  repo: string;
  prNumber: number;
  commitSha: string;
  terraformVersion: string;
  generatedAt: string;          // ISO 8601
}

export interface ChangeModel {
  meta: ChangeMeta;
  summary: ChangeSummary;
  modules: ModuleGroup[];
  outputs: OutputChange[];
  drift?: ResourceChange[];
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/parser && npx tsc -p tsconfig.json --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/parser/src/plan-json.ts packages/parser/src/types.ts
git commit -m "feat(parser): add raw input and ChangeModel output types"
```

---

## Task 3: `mapAction` — action-array → `Action`

**Files:**
- Create: `packages/parser/src/actions.ts`
- Test: `packages/parser/test/actions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/parser/test/actions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapAction } from '../src/actions.js';

describe('mapAction', () => {
  it('maps single-action arrays', () => {
    expect(mapAction(['no-op'])).toBe('no-op');
    expect(mapAction(['create'])).toBe('create');
    expect(mapAction(['read'])).toBe('read');
    expect(mapAction(['update'])).toBe('update');
    expect(mapAction(['delete'])).toBe('delete');
  });

  it('maps both replace orderings to "replace"', () => {
    expect(mapAction(['create', 'delete'])).toBe('replace');
    expect(mapAction(['delete', 'create'])).toBe('replace');
  });

  it('falls back to "update" for unrecognized combinations', () => {
    expect(mapAction(['something-weird'])).toBe('update');
    expect(mapAction([])).toBe('update');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/actions.test.ts`
Expected: FAIL — cannot resolve `../src/actions.js`.

- [ ] **Step 3: Write the implementation**

`packages/parser/src/actions.ts`:
```ts
import type { Action } from './types.js';

/** Normalize a tofu plan `change.actions` array into a single Action. */
export function mapAction(actions: string[]): Action {
  switch (actions.join(',')) {
    case 'no-op': return 'no-op';
    case 'create': return 'create';
    case 'read': return 'read';
    case 'update': return 'update';
    case 'delete': return 'delete';
    case 'create,delete':
    case 'delete,create':
      return 'replace';
    default:
      return 'update'; // defensive: unknown combos render as a plain change
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/actions.ts packages/parser/test/actions.test.ts
git commit -m "feat(parser): map tofu action arrays to Action"
```

---

## Task 4: Path helpers — flatten, mark, cover

These four helpers do all the structural walking the attribute diff needs.

**Files:**
- Create: `packages/parser/src/paths.ts`
- Test: `packages/parser/test/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/parser/test/paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  pathToString,
  flattenLeaves,
  flattenTruePaths,
  isCoveredBy,
} from '../src/paths.js';

describe('pathToString', () => {
  it('joins object keys with dots and indices with brackets', () => {
    expect(pathToString(['tags', 'Name'])).toBe('tags.Name');
    expect(pathToString(['ingress', 0, 'cidr'])).toBe('ingress[0].cidr');
    expect(pathToString(['engine_version'])).toBe('engine_version');
  });
});

describe('flattenLeaves', () => {
  it('flattens nested objects and arrays to leaf paths', () => {
    const m = flattenLeaves({
      instance_type: 't3.micro',
      tags: { Name: 'web', Env: 'prod' },
      ports: [80, 443],
    });
    expect(m.get('instance_type')).toBe('t3.micro');
    expect(m.get('tags.Name')).toBe('web');
    expect(m.get('tags.Env')).toBe('prod');
    expect(m.get('ports[0]')).toBe(80);
    expect(m.get('ports[1]')).toBe(443);
  });

  it('treats null as a leaf', () => {
    const m = flattenLeaves({ a: null });
    expect(m.has('a')).toBe(true);
    expect(m.get('a')).toBeNull();
  });
});

describe('flattenTruePaths', () => {
  it('collects only the paths whose value is exactly true', () => {
    const s = flattenTruePaths({ password: true, name: false, nested: { token: true } });
    expect([...s].sort()).toEqual(['nested.token', 'password']);
  });

  it('returns empty set for false / undefined', () => {
    expect(flattenTruePaths(false).size).toBe(0);
    expect(flattenTruePaths(undefined).size).toBe(0);
  });
});

describe('isCoveredBy', () => {
  it('matches exact paths', () => {
    expect(isCoveredBy('tags.Name', new Set(['tags.Name']))).toBe(true);
  });

  it('matches when an ancestor is marked', () => {
    expect(isCoveredBy('config.password', new Set(['config']))).toBe(true);
    expect(isCoveredBy('ingress[0].cidr', new Set(['ingress']))).toBe(true);
  });

  it('does not match unrelated or sibling-prefix paths', () => {
    expect(isCoveredBy('tags.Name', new Set(['tag']))).toBe(false);
    expect(isCoveredBy('name', new Set(['names']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/paths.test.ts`
Expected: FAIL — cannot resolve `../src/paths.js`.

- [ ] **Step 3: Write the implementation**

`packages/parser/src/paths.ts`:
```ts
import type { JsonValue } from './types.js';

/** Convert a segment array (["tags","Name"] or ["ports",0]) to "tags.Name" / "ports[0]". */
export function pathToString(segments: Array<string | number>): string {
  let s = '';
  for (const seg of segments) {
    if (typeof seg === 'number') s += `[${seg}]`;
    else s += s ? `.${seg}` : seg;
  }
  return s;
}

/** Flatten an object/array to a Map of leaf-path → primitive value. null is a leaf. */
export function flattenLeaves(
  value: unknown,
  prefix = '',
  out: Map<string, JsonValue> = new Map(),
): Map<string, JsonValue> {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, value as JsonValue);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenLeaves(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flattenLeaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Collect every path whose value is exactly `true` (tofu's unknown/sensitive masks). */
export function flattenTruePaths(
  value: unknown,
  prefix = '',
  out: Set<string> = new Set(),
): Set<string> {
  if (value === true) {
    out.add(prefix);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenTruePaths(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flattenTruePaths(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** True if `path` equals a marker or descends from one (ancestor coverage). */
export function isCoveredBy(path: string, markers: Set<string>): boolean {
  if (markers.has(path)) return true;
  for (const m of markers) {
    if (path.startsWith(`${m}.`) || path.startsWith(`${m}[`)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/paths.test.ts`
Expected: PASS (all path-helper tests).

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/paths.ts packages/parser/test/paths.test.ts
git commit -m "feat(parser): add path flatten/mark/cover helpers"
```

---

## Task 5: `diffAttributes` — changed attributes with redaction

Computes attribute-level diffs for `update`/`replace` only (create/delete carry no attr detail per the spec's visual design). Redacts sensitive values, flags unknowns and forced replacements.

**Files:**
- Create: `packages/parser/src/attributes.ts`
- Test: `packages/parser/test/attributes.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/parser/test/attributes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { diffAttributes } from '../src/attributes.js';
import type { RawChange } from '../src/plan-json.js';

describe('diffAttributes', () => {
  it('returns [] for create and delete actions', () => {
    const change: RawChange = { actions: ['create'], before: null, after: { a: 1 } };
    expect(diffAttributes(change, 'create')).toEqual([]);
    expect(diffAttributes({ ...change, actions: ['delete'] }, 'delete')).toEqual([]);
  });

  it('reports only changed leaf paths for an update', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { instance_type: 't3.micro', ami: 'ami-1', tags: { Name: 'web' } },
      after: { instance_type: 't3.small', ami: 'ami-1', tags: { Name: 'web' } },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs).toHaveLength(1);
    expect(attrs[0]).toMatchObject({
      path: 'instance_type',
      before: 't3.micro',
      after: 't3.small',
      sensitive: false,
      unknown: false,
      forcesReplacement: false,
    });
  });

  it('flags forced replacement from replace_paths (including descendants)', () => {
    const change: RawChange = {
      actions: ['delete', 'create'],
      before: { engine_version: '14.7' },
      after: { engine_version: '15.4' },
      replace_paths: [['engine_version']],
    };
    const attrs = diffAttributes(change, 'replace');
    expect(attrs[0]).toMatchObject({ path: 'engine_version', forcesReplacement: true });
  });

  it('marks unknown ("known after apply") values', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { arn: 'arn:old' },
      after: { arn: null },
      after_unknown: { arn: true },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs[0]).toMatchObject({ path: 'arn', unknown: true, after: '(known after apply)' });
  });

  it('redacts sensitive values and never leaks them', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { password: 'hunter2' },
      after: { password: 'correct-horse' },
      before_sensitive: { password: true },
      after_sensitive: { password: true },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs[0]).toMatchObject({
      path: 'password',
      sensitive: true,
      before: '«sensitive»',
      after: '«sensitive»',
    });
    expect(JSON.stringify(attrs)).not.toContain('hunter2');
    expect(JSON.stringify(attrs)).not.toContain('correct-horse');
  });

  it('sorts attributes by path', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { zeta: 1, alpha: 1 },
      after: { zeta: 2, alpha: 2 },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs.map((a) => a.path)).toEqual(['alpha', 'zeta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/attributes.test.ts`
Expected: FAIL — cannot resolve `../src/attributes.js`.

- [ ] **Step 3: Write the implementation**

`packages/parser/src/attributes.ts`:
```ts
import type { Action, AttrChange, JsonValue } from './types.js';
import type { RawChange } from './plan-json.js';
import { flattenLeaves, flattenTruePaths, isCoveredBy, pathToString } from './paths.js';

const REDACTED = '«sensitive»';
const UNKNOWN_AFTER = '(known after apply)';

/**
 * Compute changed attributes for an update/replace change.
 * Returns [] for create/delete — the action itself is the information there.
 */
export function diffAttributes(change: RawChange, action: Action): AttrChange[] {
  if (action !== 'update' && action !== 'replace') return [];

  const beforeLeaves = flattenLeaves(change.before ?? {});
  const afterLeaves = flattenLeaves(change.after ?? {});
  const unknown = flattenTruePaths(change.after_unknown ?? false);
  const sensitive = new Set<string>([
    ...flattenTruePaths(change.before_sensitive ?? false),
    ...flattenTruePaths(change.after_sensitive ?? false),
  ]);
  const force = new Set<string>(
    (change.replace_paths ?? []).map((segments) => pathToString(segments)),
  );

  const paths = new Set<string>([
    ...beforeLeaves.keys(),
    ...afterLeaves.keys(),
    ...unknown,
  ]);

  const out: AttrChange[] = [];
  for (const path of paths) {
    const isUnknown = isCoveredBy(path, unknown) || unknown.has(path);
    const before: JsonValue | null = beforeLeaves.has(path) ? beforeLeaves.get(path)! : null;
    const after: JsonValue | null = afterLeaves.has(path) ? afterLeaves.get(path)! : null;

    const changed = isUnknown || !valuesEqual(before, after);
    if (!changed) continue;

    const isSensitive = isCoveredBy(path, sensitive) || sensitive.has(path);
    out.push({
      path,
      before: isSensitive ? REDACTED : before,
      after: isSensitive ? REDACTED : isUnknown ? UNKNOWN_AFTER : after,
      sensitive: isSensitive,
      unknown: isUnknown,
      forcesReplacement: isCoveredBy(path, force) || force.has(path),
    });
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Leaf values are primitives; strict equality is sufficient. */
function valuesEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  return a === b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/attributes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/attributes.ts packages/parser/test/attributes.test.ts
git commit -m "feat(parser): diff attributes with redaction, unknown and force-replace flags"
```

---

## Task 6: `scoreDanger` — heuristic risk scoring

**Files:**
- Create: `packages/parser/src/danger.ts`
- Test: `packages/parser/test/danger.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/parser/test/danger.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scoreDanger } from '../src/danger.js';
import type { AttrChange } from '../src/types.js';

const noAttrs: AttrChange[] = [];

describe('scoreDanger', () => {
  it('scores a create low with no reasons', () => {
    const r = scoreDanger('aws_subnet', 'create', noAttrs);
    expect(r.score).toBe(10);
    expect(r.reasons).toEqual([]);
  });

  it('scores a destroy of a stateful resource highest', () => {
    const r = scoreDanger('aws_db_instance', 'delete', noAttrs);
    expect(r.score).toBe(100); // 70 base + 30 stateful
    expect(r.reasons[0]).toMatch(/not recoverable/);
  });

  it('scores a plain (non-stateful) destroy with a generic reason', () => {
    const r = scoreDanger('aws_security_group_rule', 'delete', noAttrs);
    expect(r.score).toBe(70);
    expect(r.reasons[0]).toMatch(/will be destroyed/);
  });

  it('adds a force-replacement reason listing the paths', () => {
    const attrs: AttrChange[] = [
      { path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: true },
    ];
    const r = scoreDanger('aws_db_instance', 'replace', attrs);
    expect(r.score).toBe(100); // 60 base + 30 stateful + 10 forced
    expect(r.reasons.some((x) => x.includes('forces replacement: engine_version'))).toBe(true);
  });

  it('de-escalates cosmetic tag-only updates', () => {
    const attrs: AttrChange[] = [
      { path: 'tags.Version', before: '1.4.0', after: '1.5.0', sensitive: false, unknown: false, forcesReplacement: false },
    ];
    const r = scoreDanger('aws_ecs_service', 'update', attrs);
    expect(r.score).toBe(5);
    expect(r.reasons).toEqual([]);
  });

  it('keeps a normal update at base score', () => {
    const attrs: AttrChange[] = [
      { path: 'instance_type', before: 't3.micro', after: 't3.small', sensitive: false, unknown: false, forcesReplacement: false },
    ];
    const r = scoreDanger('aws_instance', 'update', attrs);
    expect(r.score).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/danger.test.ts`
Expected: FAIL — cannot resolve `../src/danger.js`.

- [ ] **Step 3: Write the implementation**

`packages/parser/src/danger.ts`:
```ts
import type { Action, AttrChange } from './types.js';

/** Resource-type patterns whose destroy/replace risks data loss or downtime. */
const STATEFUL = [
  /_db_instance/, /_rds_/, /rds_cluster/, /dynamodb_table/, /s3_bucket/,
  /_ebs_volume/, /_efs_/, /elasticache/, /redshift/, /docdb/, /_volume$/, /database/,
];

const BASE: Record<Action, number> = {
  delete: 70, replace: 60, update: 20, create: 10, read: 0, 'no-op': 0,
};

/** Compute a tunable danger score + human reasons for a resource change. */
export function scoreDanger(
  type: string,
  action: Action,
  attrs: AttrChange[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = BASE[action];
  const stateful = STATEFUL.some((re) => re.test(type));

  if ((action === 'delete' || action === 'replace') && stateful) {
    score += 30;
    reasons.push(
      action === 'delete'
        ? 'destroys a stateful resource — data not recoverable after apply'
        : 'replacement recreates a stateful resource — possible data loss/downtime',
    );
  } else if (action === 'delete') {
    reasons.push('resource will be destroyed');
  } else if (action === 'replace') {
    reasons.push('resource will be replaced (destroy + create)');
  }

  const forced = attrs.filter((a) => a.forcesReplacement).map((a) => a.path);
  if (forced.length > 0) {
    score += 10;
    reasons.push(`forces replacement: ${forced.join(', ')}`);
  }

  // De-escalate purely cosmetic updates (tags / description / comment only).
  if (
    action === 'update' &&
    attrs.length > 0 &&
    attrs.every((a) => /^tags(\.|\[|$)/.test(a.path) || /^(description|comment)$/.test(a.path))
  ) {
    score = 5;
  }

  return { score, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/danger.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/danger.ts packages/parser/test/danger.test.ts
git commit -m "feat(parser): heuristic danger scoring with reasons"
```

---

## Task 7: Grouping — `groupByModule` and `parseOutputs`

**Files:**
- Create: `packages/parser/src/grouping.ts`
- Test: `packages/parser/test/grouping.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/parser/test/grouping.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { groupByModule, parseOutputs } from '../src/grouping.js';
import type { ResourceChange } from '../src/types.js';
import type { RawChange } from '../src/plan-json.js';

function rc(partial: Partial<ResourceChange>): ResourceChange {
  return {
    address: 'x', module: '', type: 't', name: 'n', provider: 'p',
    action: 'create', attrs: [], dangerScore: 0, dangerReasons: [],
    ...partial,
  };
}

describe('groupByModule', () => {
  it('groups by module then type', () => {
    const groups = groupByModule([
      rc({ module: 'module.vpc', type: 'aws_subnet', address: 'a' }),
      rc({ module: 'module.vpc', type: 'aws_subnet', address: 'b' }),
      rc({ module: 'module.vpc', type: 'aws_route_table', address: 'c' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.module).toBe('module.vpc');
    const types = groups[0]!.types.map((t) => t.type).sort();
    expect(types).toEqual(['aws_route_table', 'aws_subnet']);
  });

  it('orders modules by highest danger score first', () => {
    const groups = groupByModule([
      rc({ module: 'module.vpc', type: 'aws_subnet', dangerScore: 10 }),
      rc({ module: 'module.data', type: 'aws_db_instance', dangerScore: 100 }),
    ]);
    expect(groups.map((g) => g.module)).toEqual(['module.data', 'module.vpc']);
  });

  it('orders resources within a type by danger desc then address', () => {
    const groups = groupByModule([
      rc({ module: 'm', type: 't', address: 'low', dangerScore: 10 }),
      rc({ module: 'm', type: 't', address: 'high', dangerScore: 90 }),
    ]);
    expect(groups[0]!.types[0]!.resources.map((r) => r.address)).toEqual(['high', 'low']);
  });
});

describe('parseOutputs', () => {
  it('skips no-op outputs and flags sensitive ones', () => {
    const outputs: Record<string, RawChange> = {
      vpc_id: { actions: ['create'], before: null, after: 'vpc-1' },
      unchanged: { actions: ['no-op'], before: 'x', after: 'x' },
      db_password: { actions: ['update'], before: null, after: null, after_sensitive: true },
    };
    const result = parseOutputs(outputs);
    expect(result.map((o) => o.name)).toEqual(['db_password', 'vpc_id']);
    expect(result.find((o) => o.name === 'db_password')!.sensitive).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/grouping.test.ts`
Expected: FAIL — cannot resolve `../src/grouping.js`.

- [ ] **Step 3: Write the implementation**

`packages/parser/src/grouping.ts`:
```ts
import type {
  ModuleGroup, OutputChange, ResourceChange, ResourceTypeGroup,
} from './types.js';
import type { RawChange } from './plan-json.js';
import { mapAction } from './actions.js';

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function maxScore(resources: ResourceChange[]): number {
  return resources.reduce((m, r) => Math.max(m, r.dangerScore), 0);
}

/** Group changes into module → type, ordered most-dangerous-first at every level. */
export function groupByModule(changes: ResourceChange[]): ModuleGroup[] {
  const byModule = new Map<string, ResourceChange[]>();
  for (const c of changes) pushTo(byModule, c.module, c);

  const groups: ModuleGroup[] = [];
  for (const [module, list] of byModule) {
    const byType = new Map<string, ResourceChange[]>();
    for (const c of list) pushTo(byType, c.type, c);

    const types: ResourceTypeGroup[] = [];
    for (const [type, resources] of byType) {
      resources.sort(
        (a, b) => b.dangerScore - a.dangerScore || a.address.localeCompare(b.address),
      );
      types.push({ type, resources });
    }
    types.sort(
      (a, b) => maxScore(b.resources) - maxScore(a.resources) || a.type.localeCompare(b.type),
    );
    groups.push({ module, types });
  }

  groups.sort((a, b) => {
    const sa = Math.max(0, ...a.types.map((t) => maxScore(t.resources)));
    const sb = Math.max(0, ...b.types.map((t) => maxScore(t.resources)));
    return sb - sa || a.module.localeCompare(b.module);
  });
  return groups;
}

/** Normalize root output_changes, dropping no-ops. */
export function parseOutputs(outputs: Record<string, RawChange>): OutputChange[] {
  const result: OutputChange[] = [];
  for (const [name, change] of Object.entries(outputs)) {
    const action = mapAction(change.actions);
    if (action === 'no-op') continue;
    const sensitive = change.before_sensitive === true || change.after_sensitive === true;
    result.push({ name, action, sensitive });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/grouping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/grouping.ts packages/parser/test/grouping.test.ts
git commit -m "feat(parser): group changes by module/type and parse outputs"
```

---

## Task 8: `parsePlan` orchestrator + golden fixtures

Ties everything together and is verified against realistic plan fixtures.

**Files:**
- Create: `packages/parser/src/parse.ts`
- Create: `packages/parser/src/index.ts`
- Create: `packages/parser/test/fixtures/simple-create.json`
- Create: `packages/parser/test/fixtures/replace-db.json`
- Create: `packages/parser/test/fixtures/sensitive.json`
- Create: `packages/parser/test/fixtures/empty.json`
- Test: `packages/parser/test/parse.test.ts`

- [ ] **Step 1: Create the fixtures**

`packages/parser/test/fixtures/simple-create.json`:
```json
{
  "format_version": "1.2",
  "terraform_version": "1.12.1",
  "resource_changes": [
    {
      "address": "module.vpc.aws_subnet.public[0]",
      "module_address": "module.vpc",
      "mode": "managed",
      "type": "aws_subnet",
      "name": "public",
      "index": 0,
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": { "actions": ["create"], "before": null, "after": { "cidr_block": "10.0.1.0/24" } }
    },
    {
      "address": "aws_s3_bucket.unchanged",
      "mode": "managed",
      "type": "aws_s3_bucket",
      "name": "unchanged",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": { "actions": ["no-op"], "before": { "bucket": "x" }, "after": { "bucket": "x" } }
    }
  ],
  "output_changes": {
    "subnet_id": { "actions": ["create"], "before": null, "after": null, "after_unknown": true }
  }
}
```

`packages/parser/test/fixtures/replace-db.json`:
```json
{
  "format_version": "1.2",
  "terraform_version": "1.12.1",
  "resource_changes": [
    {
      "address": "module.data.aws_db_instance.main",
      "module_address": "module.data",
      "mode": "managed",
      "type": "aws_db_instance",
      "name": "main",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {
        "actions": ["delete", "create"],
        "before": { "engine_version": "14.7", "allocated_storage": 100 },
        "after": { "engine_version": "15.4", "allocated_storage": 200 },
        "replace_paths": [["engine_version"]]
      }
    },
    {
      "address": "aws_s3_bucket.legacy_logs",
      "mode": "managed",
      "type": "aws_s3_bucket",
      "name": "legacy_logs",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": { "actions": ["delete"], "before": { "bucket": "legacy" }, "after": null }
    }
  ],
  "output_changes": {}
}
```

`packages/parser/test/fixtures/sensitive.json`:
```json
{
  "format_version": "1.2",
  "terraform_version": "1.12.1",
  "resource_changes": [
    {
      "address": "aws_db_instance.main",
      "mode": "managed",
      "type": "aws_db_instance",
      "name": "main",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {
        "actions": ["update"],
        "before": { "password": "OLD_SECRET_VALUE", "name": "db" },
        "after": { "password": "NEW_SECRET_VALUE", "name": "db" },
        "before_sensitive": { "password": true },
        "after_sensitive": { "password": true }
      }
    }
  ],
  "output_changes": {}
}
```

`packages/parser/test/fixtures/empty.json`:
```json
{
  "format_version": "1.2",
  "terraform_version": "1.12.1",
  "resource_changes": [],
  "output_changes": {}
}
```

- [ ] **Step 2: Write the failing test**

`packages/parser/test/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../src/parse.js';
import type { ChangeMeta } from '../src/types.js';
import type { RawPlan } from '../src/plan-json.js';

function fixture(name: string): RawPlan {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as RawPlan;
}

const meta: ChangeMeta = {
  repo: 'firebreak/infra', prNumber: 142, commitSha: 'a1b9c2f',
  terraformVersion: '1.12.1', generatedAt: '2026-05-29T00:00:00Z',
};

describe('parsePlan', () => {
  it('summarizes and excludes no-op resources from the manifest', () => {
    const model = parsePlan(fixture('simple-create.json'), meta);
    expect(model.summary).toEqual({ create: 1, update: 0, delete: 0, replace: 0, noop: 1, read: 0 });
    const addrs = model.modules.flatMap((m) => m.types.flatMap((t) => t.resources.map((r) => r.address)));
    expect(addrs).toEqual(['module.vpc.aws_subnet.public[0]']);
    expect(model.outputs.map((o) => o.name)).toEqual(['subnet_id']);
  });

  it('models a stateful replace + destroy with danger ordering', () => {
    const model = parsePlan(fixture('replace-db.json'), meta);
    expect(model.summary.replace).toBe(1);
    expect(model.summary.delete).toBe(1);
    // module.data (replace, stateful, forced) outranks the root destroy module
    expect(model.modules[0]!.module).toBe('module.data');
    const db = model.modules[0]!.types[0]!.resources[0]!;
    expect(db.action).toBe('replace');
    expect(db.dangerReasons.some((r) => r.includes('forces replacement: engine_version'))).toBe(true);
    expect(db.attrs.find((a) => a.path === 'engine_version')!.forcesReplacement).toBe(true);
  });

  it('never leaks sensitive values anywhere in the model', () => {
    const model = parsePlan(fixture('sensitive.json'), meta);
    const json = JSON.stringify(model);
    expect(json).not.toContain('OLD_SECRET_VALUE');
    expect(json).not.toContain('NEW_SECRET_VALUE');
    expect(json).toContain('«sensitive»');
  });

  it('handles an empty plan', () => {
    const model = parsePlan(fixture('empty.json'), meta);
    expect(model.modules).toEqual([]);
    expect(model.outputs).toEqual([]);
    expect(model.summary).toEqual({ create: 0, update: 0, delete: 0, replace: 0, noop: 0, read: 0 });
  });

  it('carries meta through unchanged', () => {
    const model = parsePlan(fixture('empty.json'), meta);
    expect(model.meta).toEqual(meta);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/parse.test.ts`
Expected: FAIL — cannot resolve `../src/parse.js`.

- [ ] **Step 4: Write the implementation**

`packages/parser/src/parse.ts`:
```ts
import type {
  ChangeMeta, ChangeModel, ChangeSummary, ResourceChange,
} from './types.js';
import type { RawPlan, RawResourceChange } from './plan-json.js';
import { mapAction } from './actions.js';
import { diffAttributes } from './attributes.js';
import { scoreDanger } from './danger.js';
import { groupByModule, parseOutputs } from './grouping.js';

function emptySummary(): ChangeSummary {
  return { create: 0, update: 0, delete: 0, replace: 0, noop: 0, read: 0 };
}

function bump(summary: ChangeSummary, action: ResourceChange['action']): void {
  if (action === 'no-op') summary.noop += 1;
  else summary[action] += 1;
}

/** Build a ResourceChange from a raw tofu resource change. */
function toResourceChange(rc: RawResourceChange): ResourceChange {
  const action = mapAction(rc.change.actions);
  const attrs = diffAttributes(rc.change, action);
  const { score, reasons } = scoreDanger(rc.type, action, attrs);
  return {
    address: rc.address,
    module: rc.module_address ?? '',
    type: rc.type,
    name: rc.name,
    provider: rc.provider_name,
    action,
    attrs,
    dangerScore: score,
    dangerReasons: reasons,
  };
}

/** Parse a `tofu show -json` plan into the normalized ChangeModel. */
export function parsePlan(plan: RawPlan, meta: ChangeMeta): ChangeModel {
  const summary = emptySummary();
  const displayed: ResourceChange[] = [];

  for (const rc of plan.resource_changes ?? []) {
    const model = toResourceChange(rc);
    bump(summary, model.action);
    // no-op and read changes are counted but not shown in the manifest.
    if (model.action === 'no-op' || model.action === 'read') continue;
    displayed.push(model);
  }

  const drift = (plan.resource_drift ?? []).map(toResourceChange);

  return {
    meta: { ...meta, terraformVersion: plan.terraform_version ?? meta.terraformVersion },
    summary,
    modules: groupByModule(displayed),
    outputs: parseOutputs(plan.output_changes ?? {}),
    ...(drift.length > 0 ? { drift } : {}),
  };
}
```

`packages/parser/src/index.ts`:
```ts
export { parsePlan } from './parse.js';
export { mapAction } from './actions.js';
export { diffAttributes } from './attributes.js';
export { scoreDanger } from './danger.js';
export { groupByModule, parseOutputs } from './grouping.js';
export * from './types.js';
export type { RawPlan, RawResourceChange, RawChange } from './plan-json.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite + type-check**

Run: `cd packages/parser && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/parser/src/parse.ts packages/parser/src/index.ts packages/parser/test/parse.test.ts packages/parser/test/fixtures/
git commit -m "feat(parser): parsePlan orchestrator with golden fixtures"
```

---

## Task 9: CLI — `burnmap-parse`

A thin wrapper so the parser is usable standalone and by the future shoot/action phases.

**Files:**
- Create: `packages/parser/src/cli.ts`
- Test: `packages/parser/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/parser/test/cli.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/replace-db.json', import.meta.url));

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync('npx', ['tsx', cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('cli', () => {
  it('prints a ChangeModel JSON for a plan file with meta from flags', () => {
    const out = run([fixture, '--repo', 'firebreak/infra', '--pr', '142', '--sha', 'abc123']);
    const model = JSON.parse(out);
    expect(model.meta.repo).toBe('firebreak/infra');
    expect(model.meta.prNumber).toBe(142);
    expect(model.meta.commitSha).toBe('abc123');
    expect(model.summary.replace).toBe(1);
    // engine_version's diff appears in the model; assert the attribute is present.
    const json = JSON.stringify(model);
    expect(json).toContain('engine_version');
    expect(json).toContain('15.4');
  });

  it('exits non-zero with a message when the plan file is missing', () => {
    expect(() => run(['/nonexistent/plan.json'])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/parser && npx vitest run test/cli.test.ts`
Expected: FAIL — cannot find `../src/cli.ts`.

- [ ] **Step 3: Write the implementation**

`packages/parser/src/cli.ts`:
```ts
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlan } from './parse.js';
import type { ChangeMeta } from './types.js';
import type { RawPlan } from './plan-json.js';

interface Flags {
  planPath?: string;
  repo: string;
  pr: number;
  sha: string;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { repo: '', pr: 0, sha: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--repo': flags.repo = argv[++i] ?? ''; break;
      case '--pr': flags.pr = Number(argv[++i] ?? '0'); break;
      case '--sha': flags.sha = argv[++i] ?? ''; break;
      default:
        if (!arg.startsWith('--')) flags.planPath = arg;
    }
  }
  return flags;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.planPath) {
    process.stderr.write('usage: burnmap-parse <plan.json> [--repo R] [--pr N] [--sha S]\n');
    process.exit(2);
  }

  let plan: RawPlan;
  try {
    plan = JSON.parse(readFileSync(flags.planPath, 'utf8')) as RawPlan;
  } catch (err) {
    process.stderr.write(`error: cannot read plan file ${flags.planPath}: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const meta: ChangeMeta = {
    repo: flags.repo,
    prNumber: flags.pr,
    commitSha: flags.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  process.stdout.write(`${JSON.stringify(parsePlan(plan, meta), null, 2)}\n`);
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/parser && npx vitest run test/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite, build, and a real end-to-end smoke**

Run: `cd packages/parser && npx vitest run && npm run build`
Expected: all tests PASS; `dist/` produced with `cli.js`, `index.js`, `.d.ts` files.

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/cli.ts packages/parser/test/cli.test.ts
git commit -m "feat(parser): add burnmap-parse CLI"
```

---

## Self-review notes (author)

- **Spec coverage:** `ChangeModel` fields (meta, summary, modules, outputs, drift) — Tasks 2/7/8. Danger scoring in parser — Task 6. Redaction at parser boundary — Tasks 5/8 (`sensitive.json` asserts no leak). Action mapping incl. replace pairs — Task 3. Attribute diffs with unknown/force-replace — Task 5. CLI for downstream phases — Task 9.
- **Out of this phase (by design):** web rendering, Playwright screenshot, S3 upload, GitHub comment, Tofu infra — all later plans. Parser intentionally does no I/O except the CLI.
- **Type consistency:** `toResourceChange`/`parsePlan`/`scoreDanger(type, action, attrs)` signatures match across Tasks 6/8; `AttrChange`/`ResourceChange` shapes match Task 2 throughout.
- **Drift:** captured in `parsePlan` (Task 8) using the same `toResourceChange`; only attached when non-empty, matching the optional `drift?` field.

---

## Next phase

After this plan is executed and green, the next plan is **Phase 2 — `@burnmap/web`**: the static React SPA that renders this `ChangeModel` as the approved hybrid view (danger index + in-place detail), driven by an injected `window.__BURNMAP_DATA__`, with a visual-regression baseline.
