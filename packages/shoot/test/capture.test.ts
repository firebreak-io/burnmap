import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture } from '../src/capture.js';
import { resolveWebDist, writeShotHtml, cleanupShotHtml } from '../src/web-dist.js';

const outDir = mkdtempSync(path.join(tmpdir(), 'burnmap-shot-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

// A minimal-but-valid ChangeModel — avoids importing web's source across packages.
const model = {
  meta: { repo: 'firebreak-io/infra', prNumber: 1, commitSha: 'abc', terraformVersion: '1.12.1', generatedAt: '2026-05-29T00:00:00Z' },
  summary: { create: 1, update: 0, delete: 0, replace: 0, noop: 0, read: 0 },
  modules: [
    { module: '', types: [{ type: 'aws_s3_bucket', resources: [
      { address: 'aws_s3_bucket.logs', module: '', type: 'aws_s3_bucket', name: 'logs', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
    ] }] },
  ],
  outputs: [],
};

// PNG magic number: 89 50 4E 47 0D 0A 1A 0A
function isPng(buf: Buffer): boolean {
  return buf.length > 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

describe('capture', () => {
  it('screenshots the rendered diagram to a valid PNG', async () => {
    const webDist = resolveWebDist();
    const shotHtml = writeShotHtml(webDist, model);
    const outPath = path.join(outDir, 'shot.png');
    try {
      const result = await capture({ shotHtmlPath: shotHtml, outPath });
      expect(result).toBe(outPath);
      const buf = readFileSync(outPath);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(1000); // non-trivial image
    } finally {
      cleanupShotHtml(webDist);
    }
  });

  it('throws a clear error if READY never fires (bad html, short timeout)', async () => {
    const webDist = resolveWebDist();
    // write an HTML with no bundle so READY is never set
    const path2 = path.join(webDist, '__burnmap_never_ready.html');
    rmSync(path2, { force: true });
    const fs = await import('node:fs');
    fs.writeFileSync(path2, '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    try {
      await expect(capture({ shotHtmlPath: path2, outPath: path.join(outDir, 'x.png'), readyTimeoutMs: 1500 }))
        .rejects.toThrow(/ready/i);
    } finally {
      rmSync(path2, { force: true });
    }
  });
});
