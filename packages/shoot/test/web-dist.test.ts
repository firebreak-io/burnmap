import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveWebDist, writeShotHtml, cleanupShotHtml, SHOT_HTML_NAME } from '../src/web-dist.js';

const tmps: string[] = [];
function fakeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'burnmap-dist-'));
  tmps.push(dir);
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!DOCTYPE html><html><head></head><body><div id="root"></div>' +
      '<script type="module" src="./assets/app.js"></script></body></html>',
    'utf8',
  );
  return dir;
}

afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('resolveWebDist', () => {
  it('points at the built @burnmap/web dist directory containing index.html', () => {
    const dist = resolveWebDist();
    expect(dist.endsWith(path.join('web', 'dist'))).toBe(true);
    expect(existsSync(path.join(dist, 'index.html'))).toBe(true); // requires web to be built
  });
});

describe('writeShotHtml / cleanupShotHtml', () => {
  it('writes the injected HTML into the dist dir and removes it on cleanup', () => {
    const dist = fakeDist();
    const out = writeShotHtml(dist, { summary: { create: 2 } });
    expect(out).toBe(path.join(dist, SHOT_HTML_NAME));
    expect(readFileSync(out, 'utf8')).toContain('window.__BURNMAP_DATA__ = {"summary":{"create":2}};');
    cleanupShotHtml(dist);
    expect(existsSync(out)).toBe(false);
  });
});
