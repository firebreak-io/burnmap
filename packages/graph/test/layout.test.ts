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
    const cluster = out.clusters[0]!;
    const subnet = out.nodes.find((n) => n.id === 'module.network.aws_subnet.this')!;
    expect(subnet.x).toBeGreaterThanOrEqual(cluster.x);
    expect(subnet.y).toBeGreaterThanOrEqual(cluster.y);
  });
});
