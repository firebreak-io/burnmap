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

describe('parseArch — edges', () => {
  it('emits referencer->referenced edges, deduped, within root scope', () => {
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
    expect(m.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'module.network.aws_subnet.this->module.network.aws_vpc.this',
    ]);
  });
});
