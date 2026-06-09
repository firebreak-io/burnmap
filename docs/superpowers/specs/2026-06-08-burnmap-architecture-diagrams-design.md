# burnmap architecture diagrams — Phase 1 design

Date: 2026-06-08
Status: approved, ready for implementation plan

## Summary

Extend burnmap beyond plan-diff visualization to also render architecture
diagrams of OpenTofu stacks. Phase 1 delivers a single-stack, resource-level
diagram engine that derives resources and their relationships from the same
`tofu show -json <plan>` input burnmap already requires, renders them as a
clustered node graph (boxes grouped into labeled module clusters, arrows for
references), and exposes it two ways: a CLI that emits SVG/PNG for docs, and a
new action mode that posts the diagram as a sticky PR comment.

This is the foundational diagram engine. Higher-altitude stack graphs and
drill-down are deferred to later phases (see Roadmap).

## Goals

- Resource-level architecture diagram for one stack, from `tofu show -json`.
- Clustered visual style: typed boxes grouped into module clusters, edges from
  configuration references (chosen style "C").
- Two front-ends from one engine: CLI (SVG default, PNG optional) and a
  PR-comment action mode.
- Full backward compatibility: existing plan-diff behavior is the default.
- A data model that makes purpose-specific filtered diagrams (e.g. network-only)
  a pure downstream transform, no parser or renderer changes.

## Non-goals (Phase 1)

- Stack-level / cross-stack graphs (Terragrunt dependency graph, module graph).
- Layered drill-down between altitudes.
- Provider service-icon ("AWS architecture poster") rendering.
- Purpose-specific filtered diagrams (designed for, not shipped).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trigger / use | Both PR-comment and on-demand CLI | One engine, two front-ends. |
| Altitude (Phase 1) | Resources within one stack | Foundational; stack graph is Phase 2. |
| Edge source | `tofu show -json` configuration references | Same input as today; no new tooling; works for plan and (no-op-plan) state. |
| Visual style | Clustered graph (style C) | Carries structure and wiring in one language; maps to the layered roadmap. |
| Layout engine | ELK (`elkjs`) | Only mature pure-JS engine with good nested-container layout. |
| Rasterization | Reuse `@burnmap/shoot` (Chromium screenshot of SVG) | No new rasterizer dependency. |
| PR integration | Separate sticky comment, `mode` input on action | Independent of plan comment; either can be disabled. |

## Architecture

Same input contract as burnmap today; the diagram reads a different section of
the plan JSON. burnmap's existing parser reads `resource_changes`; the diagram
reads `configuration` (each resource's `references`) plus `planned_values` (the
resource set).

```
tofu show -json <plan>
        |
        |-- @burnmap/parser   -> ChangeModel      (existing: the diff)
        |
        '-- @burnmap/graph    -> ArchModel        (new: nodes, clusters, edges)
                                   |
              @burnmap/web (new arch view: ELK layout -> SVG)
                                   |
              @burnmap/shoot (existing Chromium screenshot) --> PNG
                                   |
              |- CLI: emit SVG (docs) and/or PNG
              '- @burnmap/action: sticky PR comment (mode: plan | arch | both)
```

New code: one new package (`@burnmap/graph`) holding the parser, the ArchModel,
the filter transform, and the SVG generator. `@burnmap/web` gets a new arch
view. `@burnmap/shoot` is untouched. `@burnmap/action` gets a `mode` toggle.

### Why a standalone SVG generator (not a React component)

The SVG generator lives in `@burnmap/graph` and runs headless (no browser needed
to produce SVG). The CLI calls it directly; the web package's arch view also
renders it. This keeps the CLI free of a browser dependency for the SVG path and
keeps one source of truth for the drawing. PNG is a screenshot of the SVG via
`shoot`. Rejected alternatives: rendering the diagram only as a React component
in the SPA (couples CLI to a browser, more moving parts), and Graphviz-wasm for
combined layout+render (less theming control, heavier wasm blob).

## Data model: ArchModel

Parsed from the plan's `configuration.root_module`, recursing into
`module_calls`.

```ts
type Action = 'create' | 'update' | 'delete' | 'replace' | 'no-op' | 'read';

interface ArchNode {
  id: string;        // config address, "module.network.aws_subnet.app"
  type: string;      // "aws_subnet"
  name: string;      // "app"
  cluster: string;   // module path, "" = root
  action?: Action;   // optional; set in PR mode by joining the ChangeModel
}

interface ArchEdge {
  from: string;      // ArchNode.id
  to: string;        // ArchNode.id
}

interface ArchCluster {
  id: string;        // "module.network"
  label: string;     // "module.network"
  parent: string;    // enclosing cluster id, "" = root
}

interface ArchModel {
  meta: { repo: string; commitSha: string; terraformVersion: string; generatedAt: string };
  nodes: ArchNode[];
  edges: ArchEdge[];
  clusters: ArchCluster[];
}
```

Key choices:

- **Config-level nodes.** Nodes are config addresses (`aws_subnet.app`), not
  expanded instances (`[0]`, `[1]`). Pre-expansion gives a stable, readable
  diagram regardless of `count` / `for_each`.
- **Edges from configuration references.** Each resource's `expressions`
  reference list yields resource-to-resource edges. References to
  `var.*`, `local.*`, provider config, and outputs are dropped.
- **Clusters = module nesting.** Drives the grouped style-C look and sets up the
  Phase 3 drill-down.
- **Optional `action` tint.** In action `both` mode, the ArchModel is joined to
  the existing ChangeModel by address so changed resources are tinted
  (create / update / delete / replace) on the architecture. In CLI/docs mode the
  field is absent and nodes render neutral.

### Filters are a first-class downstream transform

Purpose-specific diagrams (network-only, etc.) are a pure function
`ArchModel -> ArchModel`: keep nodes matching a predicate (e.g. `type` in a
set), keep induced edges, optionally reconnect edges transitively across dropped
nodes. No parser or renderer changes. Network-only is the first planned
follow-up; the transform and its tests ship in Phase 1 even though no CLI flag
exposes a named filter yet.

## Rendering

1. **Layout — ELK (`elkjs`).** Feed nodes, edges, and clusters to ELK's
   `layered` algorithm with `hierarchyHandling: INCLUDE_CHILDREN` for nested
   clusters. ELK returns coordinates for nodes, clusters, and edge routes.
2. **Draw — SVG.** A generator module renders ELK's coordinates to themed SVG
   (burnmap dark/fire theme; box and cluster styling per approved mockup C).
   Headless, no browser.
3. **Rasterize — `@burnmap/shoot`.** For PNG, load the SVG in the existing
   headless Chromium and screenshot.

SVG is the native artifact; PNG is a screenshot of it.

## Front-ends

### CLI

A `@burnmap/graph` bin, mirroring the existing parser CLI:

```
burnmap-graph --plan plan.json --out arch.svg     # docs artifact, default
burnmap-graph --plan plan.json --out arch.png     # raster, via shoot
```

SVG is the default for docs: scalable, small, diff-able. For a current-state
docs diagram, the user runs a (possibly no-op) `tofu plan` to produce a plan
JSON whose `configuration` section is fully populated.

### Action mode

`@burnmap/action` gains a `mode` input:

- `plan` (default) — today's behavior, unchanged. Backward compatible.
- `arch` — render the architecture diagram.
- `both` — render both; changed resources tinted on the architecture via the
  ChangeModel join.

The architecture diagram posts as a separate sticky comment with its own marker,
upserted the same way burnmap upserts the plan comment. Independent of the plan
comment; either can be disabled.

## Testing

Per-package, following burnmap's fixture-driven style:

- **`@burnmap/graph` parsing** (correctness core, most tests): fixture
  `tofu show -json` plans to asserted ArchModel — node set, cluster nesting,
  edge extraction, reference filtering drops var/local/provider/output refs,
  `count`/`for_each` collapses to one config node.
- **Filter transform**: node-subset and induced-edge logic, including transitive
  reconnection.
- **ChangeModel join**: changed resources get the right `action`; unchanged stay
  neutral.
- **SVG generator**: deterministic structural snapshot from a small fixed
  ArchModel (ELK input pinned so output is stable). Assert structure, not pixels.
- **PNG/shoot**: one smoke test that SVG to PNG produces a valid non-empty PNG.
- **Action mode**: `mode` routing and separate-marker upsert, reusing existing
  action test patterns.

## Roadmap (later phases, not designed here)

- **Phase 2 — stack-level graph.** Nodes = stacks/modules, edges = Terragrunt
  `dependency` blocks (`terragrunt graph-dependencies` DOT) first, then OpenTofu
  module calls behind the same graph model. Reuses the ELK-SVG-shoot renderer
  and the cluster concept.
- **Phase 3 — layered drill-down.** Top-level stack graph links into per-stack
  resource diagrams.
- **Follow-up — purpose-specific filtered diagrams** (network-only first), as
  ArchModel filter transforms.

## Open questions

None blocking Phase 1. ELK layout tuning (spacing, edge routing, cluster
padding) is an implementation detail to settle during build against real
fixtures.
