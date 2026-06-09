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
  for (const e of allEdges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }

  const result = new Set<string>();
  for (const start of kept) {
    const seen = new Set<string>();
    const stack = [...(adj.get(start) ?? [])];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === undefined || seen.has(cur)) continue;
      seen.add(cur);
      if (kept.has(cur)) result.add(`${start}->${cur}`);
      else for (const next of adj.get(cur) ?? []) stack.push(next);
    }
  }
  return [...result].map((k) => {
    const [from, to] = k.split('->');
    return { from: from as string, to: to as string };
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
