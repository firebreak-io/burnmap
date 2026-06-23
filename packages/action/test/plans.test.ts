import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolvePlans } from '../src/plans.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'burnmap-plans-'));
  mkdirSync(path.join(root, 'a'), { recursive: true });
  mkdirSync(path.join(root, 'b'), { recursive: true });
  writeFileSync(path.join(root, 'a', 'plan.json'), '{}');
  writeFileSync(path.join(root, 'b', 'plan.json'), '{}');
  writeFileSync(path.join(root, 'top.json'), '{}');
  // symlink pointing at an existing real file → must dedupe by canonical path
  symlinkSync(path.join(root, 'a', 'plan.json'), path.join(root, 'link.json'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolvePlans', () => {
  it('resolves a single literal path to one entry', async () => {
    const out = await resolvePlans('top.json', root);
    expect(out).toHaveLength(1);
    expect(out[0]!.rel).toBe('top.json');
  });

  it('expands a recursive glob, sorted lexicographically by canonical path', async () => {
    const out = await resolvePlans('**/plan.json', root);
    expect(out.map((p) => p.rel)).toEqual(['a/plan.json', 'b/plan.json']);
  });

  it('dedupes a symlink that resolves to an already-matched real file', async () => {
    const out = await resolvePlans('*.json', root);
    // top.json + link.json(→a/plan.json); link dedupes against a/plan.json only
    // if a/plan.json is also matched. With *.json (non-recursive) only top.json
    // and link.json match; link canonicalizes to a/plan.json (outside the match
    // set), so both remain — one canonical top.json, one canonical a/plan.json.
    expect(out.map((p) => p.rel).sort()).toEqual(['a/plan.json', 'top.json']);
  });

  it('throws a clear error when nothing matches', async () => {
    await expect(resolvePlans('nope/*.json', root)).rejects.toThrow(/no plan files matched/i);
  });
});
