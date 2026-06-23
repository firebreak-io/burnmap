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
