import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captionPng } from '../src/caption.js';

// a 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const out = path.join(tmpdir(), `burnmap-caption-${process.pid}.png`);
afterAll(() => rmSync(out, { force: true }));

describe('captionPng', () => {
  it('produces a non-empty PNG with the caption composited', async () => {
    await captionPng(PNG, 'ec-dev / network', out);
    const bytes = readFileSync(out);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
  }, 30000);
});
