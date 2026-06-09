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
        const a = segs[0];
        const b = segs[1];
        if (a === undefined || b === undefined) continue;
        const cand = `${a}.${b}`;
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
