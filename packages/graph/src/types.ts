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
