import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { archToSvg } from '../src/render.js';
import type { ArchMeta } from '../src/types.js';

const META: ArchMeta = {
  repo: 'o/r', prNumber: 1, commitSha: 'x', terraformVersion: '1.8.0', generatedAt: 'now',
};
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

describe('archToSvg', () => {
  it('parses, lays out, and renders an SVG for a fixture plan', async () => {
    const svg = await archToSvg(load('flat-stack.json'), META);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/class="node/g) ?? []).length).toBe(4);
    expect(svg).toContain('aws_instance');
  });
});
