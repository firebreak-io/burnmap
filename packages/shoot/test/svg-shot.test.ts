import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rasterizeSvg } from '../src/svg-shot.js';

const out = path.join(tmpdir(), `burnmap-svg-test-${process.pid}.png`);
afterAll(() => rmSync(out, { force: true }));

describe('rasterizeSvg', () => {
  it('produces a non-empty PNG from an SVG string', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">'
      + '<rect class="arch-root" x="0" y="0" width="80" height="40" fill="#1a1614"/></svg>';
    await rasterizeSvg(svg, out);
    const bytes = readFileSync(out);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
  }, 30000);
});
