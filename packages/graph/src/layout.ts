// elkjs bundled export is a constructor but its .d.ts lacks construct signatures
// under NodeNext — use createRequire to sidestep the interop gap.
import { createRequire } from 'node:module';
import type { ELK as ELKInstance, ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
const _req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ELKCtor = _req('elkjs/lib/elk.bundled.js') as { default: new () => ELKInstance };
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

/** Build the nested ELK graph: clusters become container nodes holding children. */
function toElkGraph(model: ArchModel): ElkNode & { edges: ElkExtendedEdge[] } {
  const containers = new Map<string, ElkNode>();
  for (const c of model.clusters) {
    containers.set(c.id, {
      id: c.id,
      children: [],
      layoutOptions: { 'elk.padding': '[top=28,left=16,bottom=16,right=16]' },
    });
  }

  const rootChildren: ElkNode[] = [];

  const childrenOf = (cluster: string): ElkNode[] => {
    if (cluster === '') return rootChildren;
    const container = containers.get(cluster);
    // container always exists for a valid model; fall back to root
    return container?.children ?? rootChildren;
  };

  for (const c of model.clusters) childrenOf(c.parent).push(containers.get(c.id)!);
  for (const n of model.nodes) childrenOf(n.cluster).push({ id: n.id, width: NODE_W, height: NODE_H });

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      'elk.spacing.nodeNode': '28',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    },
    children: rootChildren,
    edges: model.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
}

/** Run ELK and flatten parent-relative coords into absolute coords. */
export async function layoutArch(model: ArchModel): Promise<PositionedArch> {
  const elk = new ELKCtor.default();
  const graph = toElkGraph(model);
  const laid = await elk.layout(graph);

  const nodes: PositionedNode[] = [];
  const clusters: PositionedCluster[] = [];
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const clusterById = new Map(model.clusters.map((c) => [c.id, c]));

  const visit = (n: ElkNode, ox: number, oy: number): void => {
    const ax = ox + (n.x ?? 0);
    const ay = oy + (n.y ?? 0);
    if (n.children && n.children.length > 0) {
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
    const ext = e as ElkExtendedEdge;
    const s = ext.sections?.[0];
    const points = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] : [];
    return { from: ext.sources[0] ?? '', to: ext.targets[0] ?? '', points };
  });

  return { meta: model.meta, nodes, clusters, edges, width: laid.width ?? 0, height: laid.height ?? 0 };
}
