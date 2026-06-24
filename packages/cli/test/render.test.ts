import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runRender } from '../src/commands/render.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));

function deps(overrides = {}) {
  const written: Record<string, string> = {};
  const calls: string[] = [];
  return {
    written, calls,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    writeFile: (p: string, d: string) => { written[p] = d; },
    renderArchSvg: async () => { calls.push('arch'); return '<svg/>'; },
    renderDiffPng: async (_m: unknown, out: string) => { calls.push('diff'); written[out] = 'PNG'; },
    join: (a: string, b: string) => `${a}/${b}`,
    stdout: () => {},
    ensureChromium: () => { calls.push('ensure'); },
    now: () => '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

describe('runRender', () => {
  it('emits model.json + arch.svg + diff.png into --out-dir', async () => {
    const d = deps();
    await runRender(parseArgs(['render', fixture, '--out-dir', 'out']), d);
    expect(JSON.parse(d.written['out/model.json']!).summary.create).toBe(1);
    expect(d.written['out/arch.svg']).toBe('<svg/>');
    expect(d.written['out/diff.png']).toBe('PNG');
    // Chromium guard runs before any PNG work.
    expect(d.calls.indexOf('ensure')).toBeLessThan(d.calls.indexOf('diff'));
  });

  it('fails fast (CliError 3) without writing anything when Chromium is missing', async () => {
    const d = deps({ ensureChromium: () => { throw new CliError('no chromium', 3); } });
    await expect(runRender(parseArgs(['render', fixture, '--out-dir', 'out']), d)).rejects.toMatchObject({ code: 3 });
    expect(Object.keys(d.written)).toHaveLength(0);
  });

  it('requires --out-dir (CliError 2)', async () => {
    await expect(runRender(parseArgs(['render', fixture]), deps())).rejects.toMatchObject({ code: 2 });
  });
});
