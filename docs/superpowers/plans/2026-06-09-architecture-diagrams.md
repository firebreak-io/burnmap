# OpenTofu Architecture Diagrams (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-stack, resource-level architecture diagram engine to burnmap that turns the `configuration` section of `tofu show -json <plan>` into a clustered node graph, exposed as a CLI (SVG/PNG) and a new action `mode`.

**Architecture:** One new workspace package `@burnmap/graph` owns parsing (`configuration` → `ArchModel`), a filter transform, a ChangeModel join, ELK layout, and SVG rendering. PNG is a Chromium screenshot of the SVG, reusing `@burnmap/shoot`. `@burnmap/action` gains a `mode` input (`plan` | `arch` | `both`) that posts the diagram as a second sticky comment with its own marker. The plan-diff path is untouched and remains the default.

**Tech Stack:** TypeScript (NodeNext, ES2022, strict), Node 22, vitest, elkjs (layout), Playwright via `@burnmap/shoot` (rasterize). Matches existing package conventions (`packages/parser` is the template).

**Known Phase 1 limitations (consistent with the spec's "misses edges routed through locals/vars"):**
- Edges are resolved **within a module scope** only. Cross-module edges (resolved through module-call inputs and child outputs) are out of scope for Phase 1.
- Nodes are **managed resources only**; data sources (`mode: "data"`) are excluded.

These are intentional and documented in the CLI `--help` and the action README note (Task 14).

---

## File Structure

New package `packages/graph/`:

- `package.json` — `@burnmap/graph`, `bin: burnmap-graph`, deps `@burnmap/parser`, `@burnmap/shoot`, `elkjs`.
- `tsconfig.json` — extends `../../tsconfig.base.json` (same as parser).
- `src/arch-json.ts` — minimal raw types for the plan `configuration` section.
- `src/references.ts` — `collectReferences(value)`: gather every `references[]` string in an expression tree.
- `src/types.ts` — `ArchMeta`, `ArchNode`, `ArchEdge`, `ArchCluster`, `ArchModel`.
- `src/parse-config.ts` — `parseArch(plan, meta) → ArchModel`.
- `src/filter.ts` — `filterArch(model, keep, opts)`: node-subset + induced/reconnected edges.
- `src/join.ts` — `tintWithChanges(model, changeModel)`: set `node.action` by address.
- `src/layout.ts` — `layoutArch(model) → PositionedArch` (async, ELK).
- `src/svg.ts` — `renderSvg(positioned) → string`.
- `src/render.ts` — `archToSvg(plan, meta)`, `archToPng(plan, meta, outPath)`.
- `src/cli.ts` — `burnmap-graph` bin.
- `src/index.ts` — public exports.
- `test/fixtures/*.json`, `test/*.test.ts`.

Modified:

- `packages/shoot/src/svg-shot.ts` (new) + `src/index.ts` — `rasterizeSvg(svg, outPath)`.
- `packages/action/src/s3.ts` — optional `kind` on `s3Key`.
- `packages/action/src/arch-comment.ts` (new) — arch marker + body.
- `packages/action/src/arch-run.ts` (new) — `runArch(deps, inputs)`.
- `packages/action/src/main.ts` — read `mode`, route.
- `packages/action/src/index.ts` — export new symbols.
- `action.yml` — add `mode` input.

---

## Task 1: Scaffold `@burnmap/graph`

**Files:**
- Create: `packages/graph/package.json`
- Create: `packages/graph/tsconfig.json`
- Create: `packages/graph/src/index.ts`
- Test: `packages/graph/test/smoke.test.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@burnmap/graph",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "burnmap-graph": "dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@burnmap/parser": "*",
    "@burnmap/shoot": "*",
    "elkjs": "^0.9.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

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

- [ ] **Step 3: Write a placeholder `src/index.ts`**

```ts
export const PACKAGE = '@burnmap/graph';
```

- [ ] **Step 4: Write the smoke test**

```ts
// packages/graph/test/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { PACKAGE } from '../src/index.js';

describe('@burnmap/graph', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@burnmap/graph');
  });
});
```

- [ ] **Step 5: Install deps and run the smoke test**

Run: `npm install && npm test -w @burnmap/graph`
Expected: elkjs is added to the lockfile; the smoke test PASSES.

- [ ] **Step 6: Commit**

```bash
git add packages/graph package.json package-lock.json
git commit -m "feat(graph): scaffold @burnmap/graph package"
```

---

## Task 2: `collectReferences` and raw config types

**Files:**
- Create: `packages/graph/src/arch-json.ts`
- Create: `packages/graph/src/references.ts`
- Test: `packages/graph/test/references.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/graph/test/references.test.ts
import { describe, it, expect } from 'vitest';
import { collectReferences } from '../src/references.js';

describe('collectReferences', () => {
  it('collects top-level references', () => {
    expect(collectReferences({ vpc_id: { references: ['aws_vpc.main.id', 'aws_vpc.main'] } }))
      .toEqual(['aws_vpc.main.id', 'aws_vpc.main']);
  });

  it('collects references nested in blocks and arrays', () => {
    const expr = {
      ingress: [
        { from_port: { constant_value: 0 }, security_groups: { references: ['aws_security_group.lb.id'] } },
      ],
      vpc_id: { references: ['aws_vpc.main.id'] },
    };
    expect(collectReferences(expr).sort())
      .toEqual(['aws_security_group.lb.id', 'aws_vpc.main.id']);
  });

  it('returns empty for constant-only expressions', () => {
    expect(collectReferences({ cidr_block: { constant_value: '10.0.0.0/16' } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- references`
Expected: FAIL — cannot find module `../src/references.js`.

- [ ] **Step 3: Write `arch-json.ts`**

```ts
// packages/graph/src/arch-json.ts
// Minimal shape of the `configuration` section of `tofu show -json <plan>`.
// Only fields the diagram consumes are typed; everything else is ignored.

export interface RawConfigResource {
  address: string;       // module-relative, no index, e.g. "aws_subnet.app"
  mode: string;          // "managed" | "data"
  type: string;
  name: string;
  expressions?: Record<string, unknown>;
}

export interface RawModuleCall {
  source?: string;
  expressions?: Record<string, unknown>;
  module?: RawConfigModule;
}

export interface RawConfigModule {
  resources?: RawConfigResource[];
  module_calls?: Record<string, RawModuleCall>;
}

export interface RawConfiguration {
  root_module?: RawConfigModule;
}
```

- [ ] **Step 4: Write `references.ts`**

```ts
// packages/graph/src/references.ts

/** Walk an expression tree and collect every string in any `references` array. */
export function collectReferences(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (key === 'references' && Array.isArray(val)) {
          for (const r of val) if (typeof r === 'string') out.push(r);
        } else {
          visit(val);
        }
      }
    }
  };
  visit(value);
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- references`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/graph/src/arch-json.ts packages/graph/src/references.ts packages/graph/test/references.test.ts
git commit -m "feat(graph): collectReferences + raw configuration types"
```

---

## Task 3: ArchModel types + `parseArch` (nodes & clusters)

**Files:**
- Create: `packages/graph/src/types.ts`
- Create: `packages/graph/src/parse-config.ts`
- Create: `packages/graph/test/fixtures/flat-stack.json`
- Create: `packages/graph/test/fixtures/nested-modules.json`
- Test: `packages/graph/test/parse-config.test.ts`

- [ ] **Step 1: Write the fixtures**

```json
// packages/graph/test/fixtures/flat-stack.json
{
  "format_version": "1.2",
  "terraform_version": "1.8.0",
  "configuration": {
    "root_module": {
      "resources": [
        { "address": "aws_vpc.main", "mode": "managed", "type": "aws_vpc", "name": "main",
          "expressions": { "cidr_block": { "constant_value": "10.0.0.0/16" } } },
        { "address": "aws_subnet.app", "mode": "managed", "type": "aws_subnet", "name": "app",
          "expressions": { "vpc_id": { "references": ["aws_vpc.main.id", "aws_vpc.main"] } } },
        { "address": "aws_security_group.web", "mode": "managed", "type": "aws_security_group", "name": "web",
          "expressions": { "vpc_id": { "references": ["aws_vpc.main.id", "aws_vpc.main"] } } },
        { "address": "aws_instance.web", "mode": "managed", "type": "aws_instance", "name": "web",
          "expressions": {
            "subnet_id": { "references": ["aws_subnet.app.id", "aws_subnet.app"] },
            "vpc_security_group_ids": { "references": ["aws_security_group.web.id", "aws_security_group.web"] }
          } },
        { "address": "data.aws_ami.ubuntu", "mode": "data", "type": "aws_ami", "name": "ubuntu",
          "expressions": { "most_recent": { "constant_value": true } } }
      ]
    }
  }
}
```

```json
// packages/graph/test/fixtures/nested-modules.json
{
  "format_version": "1.2",
  "terraform_version": "1.8.0",
  "configuration": {
    "root_module": {
      "resources": [
        { "address": "aws_eip.nat", "mode": "managed", "type": "aws_eip", "name": "nat", "expressions": {} }
      ],
      "module_calls": {
        "network": {
          "source": "./modules/network",
          "module": {
            "resources": [
              { "address": "aws_vpc.this", "mode": "managed", "type": "aws_vpc", "name": "this", "expressions": {} },
              { "address": "aws_subnet.this", "mode": "managed", "type": "aws_subnet", "name": "this",
                "expressions": { "vpc_id": { "references": ["aws_vpc.this.id", "aws_vpc.this"] } } }
            ]
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test (nodes & clusters)**

```ts
// packages/graph/test/parse-config.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArch } from '../src/parse-config.js';
import type { ArchMeta } from '../src/types.js';

const META: ArchMeta = {
  repo: 'o/r', prNumber: 1, commitSha: 'abc', terraformVersion: '1.8.0', generatedAt: 'now',
};
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

describe('parseArch — nodes & clusters', () => {
  it('emits one node per managed resource and excludes data sources', () => {
    const m = parseArch(load('flat-stack.json'), META);
    const ids = m.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([
      'aws_instance.web', 'aws_security_group.web', 'aws_subnet.app', 'aws_vpc.main',
    ]);
    expect(m.nodes.every((n) => n.cluster === '')).toBe(true);
    expect(m.clusters).toEqual([]);
  });

  it('prefixes nested-module nodes and emits a cluster', () => {
    const m = parseArch(load('nested-modules.json'), META);
    expect(m.nodes.map((n) => n.id).sort()).toEqual([
      'aws_eip.nat', 'module.network.aws_subnet.this', 'module.network.aws_vpc.this',
    ]);
    expect(m.clusters).toEqual([{ id: 'module.network', label: 'module.network', parent: '' }]);
    const sub = m.nodes.find((n) => n.id === 'module.network.aws_subnet.this');
    expect(sub?.cluster).toBe('module.network');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- parse-config`
Expected: FAIL — cannot find module `../src/parse-config.js`.

- [ ] **Step 4: Write `types.ts`**

```ts
// packages/graph/src/types.ts
import type { Action } from '@burnmap/parser';

export interface ArchMeta {
  repo: string;
  prNumber: number;
  commitSha: string;
  terraformVersion: string;
  generatedAt: string;
}

export interface ArchNode {
  id: string;        // config address, e.g. "module.network.aws_subnet.this"
  type: string;
  name: string;
  cluster: string;   // enclosing module path, "" = root
  action?: Action;   // set by tintWithChanges in PR "both" mode
}

export interface ArchEdge {
  from: string;      // referencing node id
  to: string;        // referenced node id
}

export interface ArchCluster {
  id: string;        // "module.network"
  label: string;
  parent: string;    // enclosing cluster id, "" = root
}

export interface ArchModel {
  meta: ArchMeta;
  nodes: ArchNode[];
  edges: ArchEdge[];
  clusters: ArchCluster[];
}
```

- [ ] **Step 5: Write `parse-config.ts` (nodes & clusters; edges added in Task 4)**

```ts
// packages/graph/src/parse-config.ts
import type { RawPlan } from '@burnmap/parser';
import type { RawConfigModule, RawConfiguration } from './arch-json.js';
import { collectReferences } from './references.js';
import type { ArchCluster, ArchEdge, ArchMeta, ArchModel, ArchNode } from './types.js';

interface RawPlanConfig extends RawPlan {
  configuration?: RawConfiguration;
}

/** Build the ArchModel from a plan's `configuration` section. */
export function parseArch(plan: RawPlanConfig, meta: ArchMeta): ArchModel {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const clusters: ArchCluster[] = [];

  const walk = (mod: RawConfigModule, prefix: string, cluster: string): void => {
    const managed = (mod.resources ?? []).filter((r) => r.mode === 'managed');
    const localAddrs = new Set(managed.map((r) => r.address));

    for (const r of managed) {
      nodes.push({ id: prefix + r.address, type: r.type, name: r.name, cluster });
    }

    for (const r of managed) {
      const seen = new Set<string>();
      for (const ref of collectReferences(r.expressions ?? {})) {
        const segs = ref.split('.');
        if (segs.length < 2) continue;
        const cand = `${segs[0]}.${segs[1]}`;
        if (cand === r.address || !localAddrs.has(cand)) continue;
        const edge = { from: prefix + r.address, to: prefix + cand };
        const key = `${edge.from}->${edge.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(edge);
      }
    }

    for (const [name, call] of Object.entries(mod.module_calls ?? {})) {
      const childCluster = `${prefix}module.${name}`;
      clusters.push({ id: childCluster, label: `module.${name}`, parent: cluster });
      if (call.module) walk(call.module, `${childCluster}.`, childCluster);
    }
  };

  walk(plan.configuration?.root_module ?? {}, '', '');
  return { meta, nodes, edges, clusters };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- parse-config`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/graph/src/types.ts packages/graph/src/parse-config.ts packages/graph/test/fixtures packages/graph/test/parse-config.test.ts
git commit -m "feat(graph): ArchModel types + parseArch nodes/clusters"
```

---

## Task 4: `parseArch` edges (reference resolution)

**Files:**
- Modify: `packages/graph/test/parse-config.test.ts` (add edge cases)

The implementation already emits edges (Task 3, Step 5). This task locks edge behavior with tests and confirms the within-scope resolution rules.

- [ ] **Step 1: Add failing edge tests**

```ts
// append inside packages/graph/test/parse-config.test.ts
describe('parseArch — edges', () => {
  it('emits referencer→referenced edges, deduped, within root scope', () => {
    const m = parseArch(load('flat-stack.json'), META);
    const edges = m.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edges).toEqual([
      'aws_instance.web->aws_security_group.web',
      'aws_instance.web->aws_subnet.app',
      'aws_security_group.web->aws_vpc.main',
      'aws_subnet.app->aws_vpc.main',
    ]);
  });

  it('does not emit edges to data sources, vars, or across modules', () => {
    const m = parseArch(load('nested-modules.json'), META);
    // aws_subnet.this → aws_vpc.this resolves *inside* module.network only
    expect(m.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'module.network.aws_subnet.this->module.network.aws_vpc.this',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify the edge tests pass**

Run: `npm test -w @burnmap/graph -- parse-config`
Expected: PASS (4 tests total). If the edge tests fail, fix `parse-config.ts` edge logic until they pass.

- [ ] **Step 3: Commit**

```bash
git add packages/graph/test/parse-config.test.ts
git commit -m "test(graph): lock parseArch edge resolution rules"
```

---

## Task 5: `filterArch` transform

**Files:**
- Create: `packages/graph/src/filter.ts`
- Test: `packages/graph/test/filter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/graph/test/filter.test.ts
import { describe, it, expect } from 'vitest';
import { filterArch } from '../src/filter.js';
import type { ArchModel } from '../src/types.js';

const MODEL: ArchModel = {
  meta: { repo: 'o/r', prNumber: 1, commitSha: 'x', terraformVersion: '1', generatedAt: 'now' },
  nodes: [
    { id: 'aws_vpc.main', type: 'aws_vpc', name: 'main', cluster: '' },
    { id: 'aws_subnet.app', type: 'aws_subnet', name: 'app', cluster: '' },
    { id: 'aws_instance.web', type: 'aws_instance', name: 'web', cluster: '' },
  ],
  edges: [
    { from: 'aws_subnet.app', to: 'aws_vpc.main' },
    { from: 'aws_instance.web', to: 'aws_subnet.app' },
  ],
  clusters: [],
};

const isNetwork = (n: { type: string }) => n.type === 'aws_vpc' || n.type === 'aws_subnet';

describe('filterArch', () => {
  it('keeps matching nodes and induced edges', () => {
    const m = filterArch(MODEL, isNetwork);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['aws_subnet.app', 'aws_vpc.main']);
    expect(m.edges).toEqual([{ from: 'aws_subnet.app', to: 'aws_vpc.main' }]);
  });

  it('reconnects edges across dropped nodes when reconnect=true', () => {
    // keep vpc + instance, drop subnet; instance→subnet→vpc collapses to instance→vpc
    const keep = (n: { type: string }) => n.type === 'aws_vpc' || n.type === 'aws_instance';
    const m = filterArch(MODEL, keep, { reconnect: true });
    expect(m.edges).toEqual([{ from: 'aws_instance.web', to: 'aws_vpc.main' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- filter`
Expected: FAIL — cannot find module `../src/filter.js`.

- [ ] **Step 3: Write `filter.ts`**

```ts
// packages/graph/src/filter.ts
import type { ArchCluster, ArchEdge, ArchModel, ArchNode } from './types.js';

export interface FilterOptions {
  /** Reconnect kept nodes whose only path runs through dropped nodes. */
  reconnect?: boolean;
}

/** Keep nodes matching `keep`; recompute edges and prune now-empty clusters. */
export function filterArch(
  model: ArchModel,
  keep: (node: ArchNode) => boolean,
  opts: FilterOptions = {},
): ArchModel {
  const nodes = model.nodes.filter(keep);
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = opts.reconnect
    ? reconnect(model.edges, keptIds)
    : model.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));
  return { meta: model.meta, nodes, edges, clusters: pruneClusters(model, keptIds) };
}

/** For each kept source, walk the directed graph; the first kept node on each
 *  path (through dropped nodes) becomes a reconnected edge target. */
function reconnect(allEdges: ArchEdge[], kept: Set<string>): ArchEdge[] {
  const adj = new Map<string, string[]>();
  for (const e of allEdges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);

  const result = new Set<string>();
  for (const start of kept) {
    const seen = new Set<string>();
    const stack = [...(adj.get(start) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (kept.has(cur)) result.add(`${start}->${cur}`);
      else for (const next of adj.get(cur) ?? []) stack.push(next);
    }
  }
  return [...result].map((k) => {
    const [from, to] = k.split('->');
    return { from: from!, to: to! };
  });
}

/** Keep clusters that still contain a kept node, plus their ancestors. */
function pruneClusters(model: ArchModel, keptIds: Set<string>): ArchCluster[] {
  const live = new Set<string>();
  for (const n of model.nodes) if (keptIds.has(n.id) && n.cluster) live.add(n.cluster);
  const byId = new Map(model.clusters.map((c) => [c.id, c]));
  for (const id of [...live]) {
    let cur = byId.get(id);
    while (cur && cur.parent) { live.add(cur.parent); cur = byId.get(cur.parent); }
  }
  return model.clusters.filter((c) => live.has(c.id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- filter`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/filter.ts packages/graph/test/filter.test.ts
git commit -m "feat(graph): filterArch transform with edge reconnection"
```

---

## Task 6: `tintWithChanges` (ChangeModel join)

**Files:**
- Create: `packages/graph/src/join.ts`
- Test: `packages/graph/test/join.test.ts`

The ChangeModel uses expanded addresses (e.g. `aws_subnet.app[0]`, `module.network.aws_vpc.this`). ArchModel nodes use config addresses (no index). Join by stripping `[index]` from each ChangeModel address and matching the node id; if any instance changes, the node takes that action (replace/delete/create/update precedence).

- [ ] **Step 1: Write the failing test**

```ts
// packages/graph/test/join.test.ts
import { describe, it, expect } from 'vitest';
import { tintWithChanges } from '../src/join.js';
import type { ArchModel } from '../src/types.js';
import type { ChangeModel } from '@burnmap/parser';

const model: ArchModel = {
  meta: { repo: 'o/r', prNumber: 1, commitSha: 'x', terraformVersion: '1', generatedAt: 'now' },
  nodes: [
    { id: 'aws_vpc.main', type: 'aws_vpc', name: 'main', cluster: '' },
    { id: 'aws_subnet.app', type: 'aws_subnet', name: 'app', cluster: '' },
  ],
  edges: [],
  clusters: [],
};

const change = {
  meta: model.meta,
  summary: { create: 0, update: 0, delete: 0, replace: 0, noop: 0, read: 0 },
  modules: [
    { module: '', types: [
      { type: 'aws_subnet', resources: [
        { address: 'aws_subnet.app[0]', module: '', type: 'aws_subnet', name: 'app',
          provider: 'aws', action: 'create', attrs: [], dangerScore: 0, dangerReasons: [] },
      ] },
    ] },
  ],
  outputs: [],
} as unknown as ChangeModel;

describe('tintWithChanges', () => {
  it('sets action on nodes whose instances changed', () => {
    const out = tintWithChanges(model, change);
    expect(out.nodes.find((n) => n.id === 'aws_subnet.app')?.action).toBe('create');
    expect(out.nodes.find((n) => n.id === 'aws_vpc.main')?.action).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- join`
Expected: FAIL — cannot find module `../src/join.js`.

- [ ] **Step 3: Write `join.ts`**

```ts
// packages/graph/src/join.ts
import type { Action, ChangeModel } from '@burnmap/parser';
import type { ArchModel } from './types.js';

// Higher value wins when several instances of one config node have different actions.
const RANK: Record<Action, number> = {
  delete: 5, replace: 4, create: 3, update: 2, read: 1, 'no-op': 0,
};

/** Strip a trailing `[index]` / `["key"]` from a resource address. */
function configAddress(address: string): string {
  return address.replace(/\[[^\]]*\]$/, '');
}

/** Set `node.action` from the ChangeModel, joining by config address. */
export function tintWithChanges(model: ArchModel, changes: ChangeModel): ArchModel {
  const byNode = new Map<string, Action>();
  for (const mod of changes.modules) {
    for (const group of mod.types) {
      for (const rc of group.resources) {
        const id = configAddress(rc.address);
        const prev = byNode.get(id);
        if (prev === undefined || RANK[rc.action] > RANK[prev]) byNode.set(id, rc.action);
      }
    }
  }
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      const action = byNode.get(n.id);
      return action ? { ...n, action } : n;
    }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- join`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/join.ts packages/graph/test/join.test.ts
git commit -m "feat(graph): tintWithChanges joins ArchModel to ChangeModel"
```

---

## Task 7: ELK layout

**Files:**
- Create: `packages/graph/src/layout.ts`
- Test: `packages/graph/test/layout.test.ts`

`layoutArch` converts the ArchModel into an ELK graph (nested cluster children), runs ELK, and flattens ELK's parent-relative coordinates into absolute positions.

- [ ] **Step 1: Write the failing test**

```ts
// packages/graph/test/layout.test.ts
import { describe, it, expect } from 'vitest';
import { layoutArch } from '../src/layout.js';
import type { ArchModel } from '../src/types.js';

const model: ArchModel = {
  meta: { repo: 'o/r', prNumber: 1, commitSha: 'x', terraformVersion: '1', generatedAt: 'now' },
  nodes: [
    { id: 'aws_eip.nat', type: 'aws_eip', name: 'nat', cluster: '' },
    { id: 'module.network.aws_vpc.this', type: 'aws_vpc', name: 'this', cluster: 'module.network' },
    { id: 'module.network.aws_subnet.this', type: 'aws_subnet', name: 'this', cluster: 'module.network' },
  ],
  edges: [{ from: 'module.network.aws_subnet.this', to: 'module.network.aws_vpc.this' }],
  clusters: [{ id: 'module.network', label: 'module.network', parent: '' }],
};

describe('layoutArch', () => {
  it('returns absolute positions for every node and cluster', async () => {
    const out = await layoutArch(model);
    expect(out.nodes).toHaveLength(3);
    expect(out.clusters).toHaveLength(1);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.w).toBeGreaterThan(0);
      expect(n.h).toBeGreaterThan(0);
    }
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    // the subnet node sits inside the module.network cluster box
    const cluster = out.clusters[0]!;
    const subnet = out.nodes.find((n) => n.id === 'module.network.aws_subnet.this')!;
    expect(subnet.x).toBeGreaterThanOrEqual(cluster.x);
    expect(subnet.y).toBeGreaterThanOrEqual(cluster.y);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- layout`
Expected: FAIL — cannot find module `../src/layout.js`.

- [ ] **Step 3: Write `layout.ts`**

```ts
// packages/graph/src/layout.ts
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ArchModel, ArchNode } from './types.js';

export interface PositionedNode extends ArchNode { x: number; y: number; w: number; h: number; }
export interface PositionedCluster { id: string; label: string; x: number; y: number; w: number; h: number; }
export interface PositionedEdge { from: string; to: string; points: Array<{ x: number; y: number }>; }
export interface PositionedArch {
  meta: ArchModel['meta'];
  nodes: PositionedNode[];
  clusters: PositionedCluster[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

const NODE_W = 168;
const NODE_H = 40;

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
  x?: number; y?: number;
}

/** Build the nested ELK graph: clusters become container nodes holding children. */
function toElkGraph(model: ArchModel): ElkNode {
  const containers = new Map<string, ElkNode>();
  for (const c of model.clusters) {
    containers.set(c.id, { id: c.id, children: [], layoutOptions: { 'elk.padding': '[top=28,left=16,bottom=16,right=16]' } });
  }
  const childrenOf = (cluster: string): ElkNode[] => {
    if (cluster === '') return root.children!;
    return containers.get(cluster)!.children!;
  };
  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      'elk.spacing.nodeNode': '28',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    },
    children: [],
  };
  // nest clusters under their parents (parents declared before children in our parse order)
  for (const c of model.clusters) childrenOf(c.parent).push(containers.get(c.id)!);
  for (const n of model.nodes) childrenOf(n.cluster).push({ id: n.id, width: NODE_W, height: NODE_H });

  return {
    ...root,
    // edges live at root; ELK routes them across containers
    ...({ edges: model.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })) } as object),
  };
}

/** Run ELK and flatten parent-relative coords into absolute coords. */
export async function layoutArch(model: ArchModel): Promise<PositionedArch> {
  const elk = new ELK();
  const graph = toElkGraph(model);
  const laid = (await elk.layout(graph as never)) as ElkNode & {
    width?: number; height?: number;
    edges?: Array<{ sources: string[]; targets: string[]; sections?: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }> }>;
  };

  const nodes: PositionedNode[] = [];
  const clusters: PositionedCluster[] = [];
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const clusterById = new Map(model.clusters.map((c) => [c.id, c]));

  const visit = (n: ElkNode, ox: number, oy: number): void => {
    const ax = ox + (n.x ?? 0);
    const ay = oy + (n.y ?? 0);
    if (n.children && n.children.length) {
      const c = clusterById.get(n.id);
      if (c) clusters.push({ id: c.id, label: c.label, x: ax, y: ay, w: n.width ?? 0, h: n.height ?? 0 });
      for (const child of n.children) visit(child, ax, ay);
    } else {
      const src = nodeById.get(n.id);
      if (src) nodes.push({ ...src, x: ax, y: ay, w: n.width ?? NODE_W, h: n.height ?? NODE_H });
    }
  };
  for (const child of laid.children ?? []) visit(child, 0, 0);

  const edges: PositionedEdge[] = (laid.edges ?? []).map((e) => {
    const s = e.sections?.[0];
    const points = s
      ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
      : [];
    return { from: e.sources[0]!, to: e.targets[0]!, points };
  });

  return {
    meta: model.meta,
    nodes, clusters, edges,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- layout`
Expected: PASS (1 test). If ELK option keys are rejected, consult `node_modules/elkjs/README.md` for current option names and adjust the `layoutOptions` values; the test asserts only finite positions, so spacing tweaks are safe.

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/layout.ts packages/graph/test/layout.test.ts
git commit -m "feat(graph): ELK layout to absolute positions"
```

---

## Task 8: SVG render

**Files:**
- Create: `packages/graph/src/svg.ts`
- Test: `packages/graph/test/svg.test.ts`

Renders a `PositionedArch` to a themed SVG string. Tests assert structure (counts, labels, action classes), not coordinates.

- [ ] **Step 1: Write the failing test**

```ts
// packages/graph/test/svg.test.ts
import { describe, it, expect } from 'vitest';
import { renderSvg } from '../src/svg.js';
import type { PositionedArch } from '../src/layout.js';

const positioned: PositionedArch = {
  meta: { repo: 'o/r', prNumber: 1, commitSha: 'x', terraformVersion: '1', generatedAt: 'now' },
  nodes: [
    { id: 'aws_vpc.main', type: 'aws_vpc', name: 'main', cluster: '', x: 10, y: 10, w: 160, h: 40, action: 'create' },
    { id: 'module.network.aws_subnet.this', type: 'aws_subnet', name: 'this', cluster: 'module.network', x: 20, y: 80, w: 160, h: 40 },
  ],
  clusters: [{ id: 'module.network', label: 'module.network', x: 5, y: 70, w: 200, h: 90 }],
  edges: [{ from: 'module.network.aws_subnet.this', to: 'aws_vpc.main', points: [{ x: 30, y: 80 }, { x: 30, y: 50 }] }],
  width: 220, height: 180,
};

describe('renderSvg', () => {
  it('renders one rect per node, one per cluster, and one path per edge', () => {
    const svg = renderSvg(positioned);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="220"');
    expect((svg.match(/class="node/g) ?? []).length).toBe(2);
    expect((svg.match(/class="cluster"/g) ?? []).length).toBe(1);
    expect((svg.match(/class="edge"/g) ?? []).length).toBe(1);
    expect(svg).toContain('aws_vpc');
    expect(svg).toContain('module.network');
    // changed node carries its action class for tinting
    expect(svg).toContain('class="node create"');
  });

  it('escapes XML special characters in labels', () => {
    const svg = renderSvg({
      ...positioned,
      nodes: [{ id: 'x', type: 'aws_s3_bucket', name: 'a&b<c', cluster: '', x: 0, y: 0, w: 160, h: 40 }],
      clusters: [], edges: [],
    });
    expect(svg).toContain('a&amp;b&lt;c');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- svg`
Expected: FAIL — cannot find module `../src/svg.js`.

- [ ] **Step 3: Write `svg.ts`**

```ts
// packages/graph/src/svg.ts
import type { PositionedArch, PositionedEdge } from './layout.js';

const PAD = 16;

// burnmap dark/fire theme: neutral box, accent stroke per resource family is
// out of scope for Phase 1; action tints are applied via CSS classes.
const STYLE = `
  .bg { fill: #1a1614; }
  .cluster { fill: #211b18; stroke: #6a5b53; stroke-width: 1; }
  .cluster-label { fill: #b8a99e; font: 12px ui-sans-serif, system-ui; }
  .node { fill: #2b2320; stroke: #888; stroke-width: 1.5; }
  .node.create { stroke: #7fb069; }
  .node.update { stroke: #d9c36b; }
  .node.replace { stroke: #e8a33d; }
  .node.delete { stroke: #e8743b; }
  .node-type { fill: #e8a07b; font: 12px ui-sans-serif, system-ui; }
  .node-name { fill: #cbb; font: 11px ui-sans-serif, system-ui; }
  .edge { stroke: #888; fill: none; stroke-width: 1.25; }
`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function edgePath(e: PositionedEdge): string {
  if (e.points.length === 0) return '';
  const [first, ...rest] = e.points;
  const d = `M${first!.x} ${first!.y}` + rest.map((p) => ` L${p.x} ${p.y}`).join('');
  return `<path class="edge" d="${d}" marker-end="url(#arrow)"/>`;
}

/** Render a positioned diagram to a standalone SVG string. */
export function renderSvg(arch: PositionedArch): string {
  const w = arch.width + PAD * 2;
  const h = arch.height + PAD * 2;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  parts.push(`<style>${STYLE}</style>`);
  parts.push('<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#888"/></marker></defs>');
  parts.push(`<rect class="bg" x="0" y="0" width="${w}" height="${h}"/>`);
  parts.push(`<g transform="translate(${PAD} ${PAD})">`);

  for (const c of arch.clusters) {
    parts.push(`<rect class="cluster" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="6"/>`);
    parts.push(`<text class="cluster-label" x="${c.x + 10}" y="${c.y + 18}">${esc(c.label)}</text>`);
  }
  for (const e of arch.edges) parts.push(edgePath(e));
  for (const n of arch.nodes) {
    const cls = n.action ? `node ${n.action}` : 'node';
    const cx = n.x + n.w / 2;
    parts.push(`<rect class="${cls}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4"/>`);
    parts.push(`<text class="node-type" x="${cx}" y="${n.y + 17}" text-anchor="middle">${esc(n.type)}</text>`);
    parts.push(`<text class="node-name" x="${cx}" y="${n.y + 31}" text-anchor="middle">${esc(n.name)}</text>`);
  }

  parts.push('</g></svg>');
  return parts.join('');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- svg`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/svg.ts packages/graph/test/svg.test.ts
git commit -m "feat(graph): SVG renderer for positioned diagrams"
```

---

## Task 9: `rasterizeSvg` in `@burnmap/shoot`

**Files:**
- Create: `packages/shoot/src/svg-shot.ts`
- Modify: `packages/shoot/src/index.ts`
- Test: `packages/shoot/test/svg-shot.test.ts`

Reuses the existing `capture()` (Chromium screenshot waiting for `__BURNMAP_READY__`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shoot/test/svg-shot.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rasterizeSvg } from '../src/svg-shot.js';

const out = path.join(tmpdir(), `burnmap-svg-test-${process.pid}.png`);
afterAll(() => rmSync(out, { force: true }));

describe('rasterizeSvg', () => {
  it('produces a non-empty PNG from an SVG string', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">'
      + '<rect class="arch-root" x="0" y="0" width="80" height="40" fill="#1a1614"/></svg>';
    await rasterizeSvg(svg, out);
    const bytes = readFileSync(out);
    expect(bytes.length).toBeGreaterThan(0);
    // PNG magic number
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
  }, 30000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/shoot -- svg-shot`
Expected: FAIL — cannot find module `../src/svg-shot.js`.

- [ ] **Step 3: Write `svg-shot.ts`**

```ts
// packages/shoot/src/svg-shot.ts
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture } from './capture.js';

/** Wrap an SVG in a minimal HTML page that signals readiness, then screenshot it. */
export async function rasterizeSvg(svg: string, outPath: string): Promise<string> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}</style></head>
<body><div class="arch-shot" style="display:inline-block">${svg}</div>
<script>window.__BURNMAP_READY__ = true;</script></body></html>`;

  const htmlPath = path.join(tmpdir(), `burnmap-arch-${process.pid}-${outPath.length}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  try {
    await capture({ shotHtmlPath: htmlPath, outPath, selector: '.arch-shot' });
    return outPath;
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
```

- [ ] **Step 4: Export it from `index.ts`**

Modify `packages/shoot/src/index.ts` — add this line after the existing exports:

```ts
export { rasterizeSvg } from './svg-shot.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @burnmap/shoot -- svg-shot`
Expected: PASS (1 test). Requires Playwright's Chromium; if unavailable run `npx playwright install chromium` first.

- [ ] **Step 6: Commit**

```bash
git add packages/shoot/src/svg-shot.ts packages/shoot/src/index.ts packages/shoot/test/svg-shot.test.ts
git commit -m "feat(shoot): rasterizeSvg screenshots an SVG string to PNG"
```

---

## Task 10: `render.ts` orchestration

**Files:**
- Create: `packages/graph/src/render.ts`
- Modify: `packages/graph/src/index.ts`
- Test: `packages/graph/test/render.test.ts`

- [ ] **Step 1: Write the failing test (SVG path only — no browser)**

```ts
// packages/graph/test/render.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { archToSvg } from '../src/render.js';
import type { ArchMeta } from '../src/types.js';

const META: ArchMeta = {
  repo: 'o/r', prNumber: 1, commitSha: 'x', terraformVersion: '1.8.0', generatedAt: 'now',
};
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

describe('archToSvg', () => {
  it('parses, lays out, and renders an SVG for a fixture plan', async () => {
    const svg = await archToSvg(load('flat-stack.json'), META);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/class="node/g) ?? []).length).toBe(4);
    expect(svg).toContain('aws_instance');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- render`
Expected: FAIL — cannot find module `../src/render.js`.

- [ ] **Step 3: Write `render.ts`**

```ts
// packages/graph/src/render.ts
import type { RawPlan, ChangeModel } from '@burnmap/parser';
import { rasterizeSvg } from '@burnmap/shoot';
import { parseArch } from './parse-config.js';
import { tintWithChanges } from './join.js';
import { layoutArch } from './layout.js';
import { renderSvg } from './svg.js';
import type { ArchMeta } from './types.js';

export interface RenderOptions {
  /** When provided, changed resources are tinted on the diagram. */
  changes?: ChangeModel;
}

/** Plan JSON → laid-out SVG string. */
export async function archToSvg(
  plan: RawPlan,
  meta: ArchMeta,
  opts: RenderOptions = {},
): Promise<string> {
  let model = parseArch(plan, meta);
  if (opts.changes) model = tintWithChanges(model, opts.changes);
  const positioned = await layoutArch(model);
  return renderSvg(positioned);
}

/** Plan JSON → PNG file (screenshot of the SVG). Returns the output path. */
export async function archToPng(
  plan: RawPlan,
  meta: ArchMeta,
  outPath: string,
  opts: RenderOptions = {},
): Promise<string> {
  const svg = await archToSvg(plan, meta, opts);
  return rasterizeSvg(svg, outPath);
}
```

- [ ] **Step 4: Replace `index.ts` with the real public surface**

```ts
// packages/graph/src/index.ts
export { parseArch } from './parse-config.js';
export { filterArch, type FilterOptions } from './filter.js';
export { tintWithChanges } from './join.js';
export { layoutArch } from './layout.js';
export { renderSvg } from './svg.js';
export { archToSvg, archToPng, type RenderOptions } from './render.js';
export * from './types.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- render`
Expected: PASS (1 test).

Note: the Task 1 smoke test imported `PACKAGE`, which no longer exists. Delete `packages/graph/test/smoke.test.ts` in this step.

- [ ] **Step 6: Run the whole graph suite and build**

Run: `npm test -w @burnmap/graph && npm run build -w @burnmap/graph`
Expected: all tests PASS; `tsc` compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git rm packages/graph/test/smoke.test.ts
git add packages/graph/src/render.ts packages/graph/src/index.ts
git commit -m "feat(graph): archToSvg/archToPng orchestration + public exports"
```

---

## Task 11: `burnmap-graph` CLI

**Files:**
- Create: `packages/graph/src/cli.ts`
- Test: `packages/graph/test/cli.test.ts`

Mirrors the `@burnmap/parser` and `@burnmap/shoot` CLIs. `.svg` out writes the SVG directly; `.png` out screenshots it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/graph/test/cli.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = path.join(__dirname, 'fixtures', 'flat-stack.json');
const cli = path.join(__dirname, '..', 'src', 'cli.ts');
const outSvg = path.join(tmpdir(), `burnmap-cli-${process.pid}.svg`);
afterAll(() => rmSync(outSvg, { force: true }));

const run = (args: string[]) =>
  execFileSync('npx', ['tsx', cli, ...args], { encoding: 'utf8' });

describe('burnmap-graph CLI', () => {
  it('writes an SVG file for --out *.svg', () => {
    run([fixture, '--out', outSvg, '--repo', 'o/r', '--sha', 'abc']);
    const svg = readFileSync(outSvg, 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('aws_vpc');
  });

  it('exits 2 with usage when no plan path is given', () => {
    expect(() => run(['--out', outSvg])).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/graph -- cli`
Expected: FAIL — cannot find `src/cli.ts`.

- [ ] **Step 3: Write `cli.ts`**

```ts
// packages/graph/src/cli.ts
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import type { RawPlan } from '@burnmap/parser';
import { archToSvg, archToPng } from './render.js';
import type { ArchMeta } from './types.js';

interface Flags { planPath?: string; out?: string; repo: string; pr: number; sha: string; }

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
    process.stderr.write('usage: burnmap-graph <plan.json> --out <file.svg|file.png> [--repo R] [--pr N] [--sha S]\n');
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

  const meta: ArchMeta = {
    repo: flags.repo,
    prNumber: flags.pr,
    commitSha: flags.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  if (flags.out.endsWith('.png')) {
    await archToPng(plan, meta, flags.out);
  } else {
    writeFileSync(flags.out, await archToSvg(plan, meta), 'utf8');
  }
  process.stdout.write(`${flags.out}\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/graph -- cli`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/graph/src/cli.ts packages/graph/test/cli.test.ts
git commit -m "feat(graph): burnmap-graph CLI (SVG default, PNG via shoot)"
```

---

## Task 12: Action `mode` — arch comment + S3 key

**Files:**
- Modify: `packages/action/src/s3.ts`
- Create: `packages/action/src/arch-comment.ts`
- Test: `packages/action/test/arch-comment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/action/test/arch-comment.test.ts
import { describe, it, expect } from 'vitest';
import { archCommentMarker, buildArchCommentBody } from '../src/arch-comment.js';
import { s3Key } from '../src/s3.js';

describe('arch comment', () => {
  it('uses a marker distinct from the plan comment', () => {
    expect(archCommentMarker(7)).toBe('<!-- burnmap:arch:pr-7 -->');
  });

  it('embeds the image and starts with the marker', () => {
    const body = buildArchCommentBody(
      { repo: 'o/r', prNumber: 7, commitSha: 'deadbeef', terraformVersion: '1.8.0', generatedAt: 'now' },
      'https://signed.example/arch.png',
    );
    expect(body.startsWith('<!-- burnmap:arch:pr-7 -->')).toBe(true);
    expect(body).toContain('![burnmap architecture](https://signed.example/arch.png)');
    expect(body).toContain('o/r');
  });

  it('s3Key separates arch from plan objects', () => {
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc', kind: 'arch' }))
      .toBe('burnmap/o/r/7/abc-arch.png');
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc' }))
      .toBe('burnmap/o/r/7/abc.png');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- arch-comment`
Expected: FAIL — cannot find module `../src/arch-comment.js`.

- [ ] **Step 3: Extend `s3Key` in `s3.ts`**

Replace the `S3KeyParts` interface and `s3Key` function with:

```ts
export interface S3KeyParts {
  repo: string;      // "owner/repo"
  prNumber: number;
  sha: string;
  kind?: 'plan' | 'arch';
}

/** Stable, per-commit object key: burnmap/<owner>/<repo>/<pr>/<sha>[-arch].png */
export function s3Key({ repo, prNumber, sha, kind = 'plan' }: S3KeyParts): string {
  const suffix = kind === 'arch' ? '-arch' : '';
  return `burnmap/${repo}/${prNumber}/${sha}${suffix}.png`;
}
```

- [ ] **Step 4: Write `arch-comment.ts`**

```ts
// packages/action/src/arch-comment.ts
import type { ArchMeta } from '@burnmap/graph';

/** Hidden marker identifying burnmap's architecture sticky comment. */
export function archCommentMarker(prNumber: number): string {
  return `<!-- burnmap:arch:pr-${prNumber} -->`;
}

/** Build the architecture sticky-comment markdown body. */
export function buildArchCommentBody(meta: ArchMeta, imageUrl: string): string {
  return [
    archCommentMarker(meta.prNumber),
    `### 🗺 burnmap — architecture for \`${meta.repo}\` @ \`${meta.commitSha}\``,
    '',
    `![burnmap architecture](${imageUrl})`,
  ].join('\n');
}
```

- [ ] **Step 5: Add `@burnmap/graph` as an action dependency**

Edit `packages/action/package.json` — add to `dependencies`:

```json
    "@burnmap/graph": "*",
```

Run: `npm install`
Expected: workspace symlink created; lockfile updated.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- arch-comment`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/action/src/s3.ts packages/action/src/arch-comment.ts packages/action/test/arch-comment.test.ts packages/action/package.json package-lock.json
git commit -m "feat(action): arch comment marker/body + arch S3 key variant"
```

---

## Task 13: Action `runArch` + mode routing

**Files:**
- Create: `packages/action/src/arch-run.ts`
- Modify: `packages/action/src/main.ts`
- Modify: `packages/action/src/index.ts`
- Modify: `action.yml`
- Test: `packages/action/test/arch-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/action/test/arch-run.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runArch, type ArchRunDeps } from '../src/arch-run.js';

const plan = { terraform_version: '1.8.0', configuration: { root_module: { resources: [
  { address: 'aws_vpc.main', mode: 'managed', type: 'aws_vpc', name: 'main', expressions: {} },
] } } };

describe('runArch', () => {
  it('renders, uploads under the arch key, and upserts the arch comment', async () => {
    const deps: ArchRunDeps = {
      readPlanJson: vi.fn(() => plan),
      archToPng: vi.fn(async (_p, _m, out) => out),
      readPng: vi.fn(() => Buffer.from('PNG')),
      uploadAndPresign: vi.fn(async () => 'https://signed/arch.png'),
      upsertStickyComment: vi.fn(async () => ({ action: 'created' as const, id: 99 })),
    };
    const result = await runArch(deps, {
      planJsonPath: 'plan.json', bucket: 'b', ttlSeconds: 60,
      repo: 'o/r', owner: 'o', repoName: 'r', prNumber: 7, sha: 'abc',
      outPng: '/tmp/x-arch.png',
    });
    expect(result.imageUrl).toBe('https://signed/arch.png');
    expect(result.commentId).toBe(99);
    const upload = (deps.uploadAndPresign as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(upload.key).toBe('burnmap/o/r/7/abc-arch.png');
    const comment = (deps.upsertStickyComment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(comment.marker).toBe('<!-- burnmap:arch:pr-7 -->');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @burnmap/action -- arch-run`
Expected: FAIL — cannot find module `../src/arch-run.js`.

- [ ] **Step 3: Write `arch-run.ts`**

```ts
// packages/action/src/arch-run.ts
import type { RawPlan } from '@burnmap/parser';
import type { ArchMeta } from '@burnmap/graph';
import { s3Key } from './s3.js';
import { archCommentMarker, buildArchCommentBody } from './arch-comment.js';

export interface ArchRunDeps {
  readPlanJson: (path: string) => RawPlan;
  archToPng: (plan: RawPlan, meta: ArchMeta, outPath: string) => Promise<string>;
  readPng: (path: string) => Buffer;
  uploadAndPresign: (opts: {
    bucket: string; key: string; body: Buffer; ttlSeconds: number;
  }) => Promise<string>;
  upsertStickyComment: (opts: {
    owner: string; repo: string; prNumber: number; marker: string; body: string;
  }) => Promise<{ action: 'created' | 'updated'; id: number }>;
}

export interface ArchRunInputs {
  planJsonPath: string;
  bucket: string;
  ttlSeconds: number;
  repo: string;
  owner: string;
  repoName: string;
  prNumber: number;
  sha: string;
  outPng: string;
}

export interface ArchRunResult {
  imageUrl: string;
  commentAction: 'created' | 'updated';
  commentId: number;
}

/** parse config → render arch PNG → upload+presign → upsert the arch sticky comment. */
export async function runArch(deps: ArchRunDeps, inputs: ArchRunInputs): Promise<ArchRunResult> {
  const plan = deps.readPlanJson(inputs.planJsonPath);
  const meta: ArchMeta = {
    repo: inputs.repo,
    prNumber: inputs.prNumber,
    commitSha: inputs.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  await deps.archToPng(plan, meta, inputs.outPng);

  const key = s3Key({ repo: inputs.repo, prNumber: inputs.prNumber, sha: inputs.sha, kind: 'arch' });
  const imageUrl = await deps.uploadAndPresign({
    bucket: inputs.bucket, key, body: deps.readPng(inputs.outPng), ttlSeconds: inputs.ttlSeconds,
  });

  const body = buildArchCommentBody(meta, imageUrl);
  const { action, id } = await deps.upsertStickyComment({
    owner: inputs.owner, repo: inputs.repoName, prNumber: inputs.prNumber,
    marker: archCommentMarker(inputs.prNumber), body,
  });

  return { imageUrl, commentAction: action, commentId: id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @burnmap/action -- arch-run`
Expected: PASS (1 test).

- [ ] **Step 5: Export from `index.ts`**

Add to `packages/action/src/index.ts`:

```ts
export { archCommentMarker, buildArchCommentBody } from './arch-comment.js';
export { runArch, type ArchRunDeps, type ArchRunInputs, type ArchRunResult } from './arch-run.js';
```

- [ ] **Step 6: Wire `mode` into `main.ts`**

In `packages/action/src/main.ts`, add the graph import near the other `@burnmap/*` imports:

```ts
import { archToPng } from '@burnmap/graph';
import { runArch } from './arch-run.js';
```

Read the mode after the existing `web-dist` input read:

```ts
  const mode = (core.getInput('mode') || 'plan').toLowerCase();
  if (!['plan', 'arch', 'both'].includes(mode)) {
    core.setFailed(`mode must be one of plan | arch | both (got "${mode}")`);
    return;
  }
```

Replace the single `outPng` declaration and the `try { ... } finally { rmSync(outPng) }` block with a version that runs the selected mode(s). The plan PNG path is unchanged; the arch path is added:

```ts
  const outPng = path.join(tmpdir(), `burnmap-${sha}.png`);
  const outArchPng = path.join(tmpdir(), `burnmap-${sha}-arch.png`);
  try {
    if (mode === 'plan' || mode === 'both') {
      const result = await run(
        {
          readPlanJson: (p) => JSON.parse(readFileSync(p, 'utf8')) as RawPlan,
          writeShotHtml,
          cleanupShotHtml,
          capture: (o) => capture(o),
          readPng: (p) => readFileSync(p),
          uploadAndPresign: (o) => uploadAndPresign({ client: s3, presignClient: presignS3, ...o }),
          upsertStickyComment: (o) => upsertStickyComment({ octokit, ...o }),
        },
        {
          planJsonPath, webDist, bucket, ttlSeconds,
          repo: `${owner}/${repo}`, owner, repoName: repo,
          prNumber, sha, outPng,
        },
      );
      core.setSecret(result.imageUrl);
      core.setOutput('image-url', result.imageUrl);
      core.info(`burnmap ${result.commentAction} plan comment ${result.commentId}`);
    }

    if (mode === 'arch' || mode === 'both') {
      const archResult = await runArch(
        {
          readPlanJson: (p) => JSON.parse(readFileSync(p, 'utf8')) as RawPlan,
          archToPng: (plan, meta, out) => archToPng(plan, meta, out),
          readPng: (p) => readFileSync(p),
          uploadAndPresign: (o) => uploadAndPresign({ client: s3, presignClient: presignS3, ...o }),
          upsertStickyComment: (o) => upsertStickyComment({ octokit, ...o }),
        },
        {
          planJsonPath, bucket, ttlSeconds,
          repo: `${owner}/${repo}`, owner, repoName: repo,
          prNumber, sha, outPng: outArchPng,
        },
      );
      core.setSecret(archResult.imageUrl);
      core.setOutput('arch-image-url', archResult.imageUrl);
      core.info(`burnmap ${archResult.commentAction} arch comment ${archResult.commentId}`);
    }
  } finally {
    rmSync(outPng, { force: true });
    rmSync(outArchPng, { force: true });
  }
```

- [ ] **Step 7: Add the `mode` input and `arch-image-url` output to `action.yml`**

Add under `inputs:` (after `web-dist`):

```yaml
  mode:
    description: "What to render: plan (diff, default) | arch (architecture) | both."
    required: false
    default: plan
```

Add under `outputs:`:

```yaml
  arch-image-url:
    description: Presigned URL of the uploaded architecture diagram (arch/both mode).
```

- [ ] **Step 8: Build the action and run its full suite**

Run: `npm run build -w @burnmap/action && npm test -w @burnmap/action`
Expected: `tsc` compiles; all action tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/action/src/arch-run.ts packages/action/src/main.ts packages/action/src/index.ts packages/action/test/arch-run.test.ts action.yml
git commit -m "feat(action): mode input routes plan/arch/both with a second sticky comment"
```

---

## Task 14: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the `mode` input and architecture diagram**

Add a short section to `README.md` after the Inputs table:

```markdown
## Architecture diagrams

Set `mode` to render an architecture diagram of the stack instead of (or
alongside) the plan diff:

- `plan` (default) — the change-diff diagram. Unchanged behavior.
- `arch` — a clustered diagram of the stack's resources and their references,
  derived from the plan's `configuration` section. Posted as a separate sticky
  comment; URL exposed as the `arch-image-url` output.
- `both` — render both; changed resources are tinted on the architecture.

Phase 1 scope: resources within one stack, edges resolved within a module scope
(cross-module edges and data sources are not yet drawn). Generate diagrams
locally with the CLI:

    burnmap-graph plan.json --out arch.svg     # scalable, docs-friendly
    burnmap-graph plan.json --out arch.png      # raster (needs Chromium)
```

- [ ] **Step 2: Run the entire test suite and build across all workspaces**

Run: `npm test && npm run build`
Expected: every package's tests PASS; all builds compile.

- [ ] **Step 3: End-to-end CLI smoke against a fixture**

Run:
```bash
npx tsx packages/graph/src/cli.ts packages/graph/test/fixtures/nested-modules.json --out /tmp/arch.svg --repo o/r --sha test
head -c 60 /tmp/arch.svg; echo
```
Expected: prints `/tmp/arch.svg`; the file starts with `<svg`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document mode input and burnmap-graph CLI"
```

---

## Self-Review Notes

- **Spec coverage:** package split (Task 1), ArchModel + config-ref parsing (Tasks 2-4), filter transform (Task 5), ChangeModel join/tint (Task 6), ELK layout (Task 7), themed SVG (Task 8), shoot rasterize (Task 9), CLI SVG/PNG (Tasks 10-11), action `mode` + separate sticky comment (Tasks 12-13), docs (Task 14). All spec sections map to a task.
- **Type consistency:** `ArchMeta`/`ArchNode`/`ArchEdge`/`ArchCluster`/`ArchModel` (Task 3) are used unchanged through layout (`Positioned*` extend them), join, render, CLI, and action. `s3Key`'s new optional `kind` is backward compatible. `archToPng(plan, meta, out)` signature matches the action dep and CLI call sites.
- **Edge-source limitation** (within-module only) and **data-source exclusion** are stated in the header, asserted in Task 4 tests, and surfaced to users in Task 14 docs — consistent with the spec's "misses edges routed through locals/vars" note.
