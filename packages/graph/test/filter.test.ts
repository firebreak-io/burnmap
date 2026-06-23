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
    const keep = (n: { type: string }) => n.type === 'aws_vpc' || n.type === 'aws_instance';
    const m = filterArch(MODEL, keep, { reconnect: true });
    expect(m.edges).toEqual([{ from: 'aws_instance.web', to: 'aws_vpc.main' }]);
  });
});
