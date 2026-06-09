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
