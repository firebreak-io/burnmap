import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runArch } from '../src/commands/arch.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));

function deps(overrides = {}) {
  const written: Record<string, string> = {};
  const calls: string[] = [];
  return {
    written, calls,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    renderSvg: async () => { calls.push('svg'); return '<svg/>'; },
    renderPng: async (_p: unknown, _m: unknown, out: string) => { calls.push('png'); written[out] = 'PNG'; return out; },
    writeFile: (p: string, d: string) => { written[p] = d; },
    stdout: () => {},
    ensureChromium: () => { calls.push('ensure'); },
    now: () => '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

describe('runArch', () => {
  it('writes SVG without touching Chromium', async () => {
    const d = deps();
    await runArch(parseArgs(['arch', fixture, '--out', 'arch.svg']), d);
    expect(d.written['arch.svg']).toBe('<svg/>');
    expect(d.calls).toContain('svg');
    expect(d.calls).not.toContain('ensure');
  });

  it('calls ensureChromium then renderPng for a .png target', async () => {
    const d = deps();
    await runArch(parseArgs(['arch', fixture, '--out', 'arch.png']), d);
    expect(d.calls).toEqual(['ensure', 'png']);
    expect(d.written['arch.png']).toBe('PNG');
  });

  it('does NOT render when Chromium guard throws', async () => {
    const d = deps({ ensureChromium: () => { throw new CliError('no chromium', 3); } });
    await expect(runArch(parseArgs(['arch', fixture, '--out', 'arch.png']), d)).rejects.toMatchObject({ code: 3 });
    expect(d.calls).not.toContain('png');
  });

  it('requires --out (CliError 2)', async () => {
    await expect(runArch(parseArgs(['arch', fixture]), deps())).rejects.toMatchObject({ code: 2 });
  });

  it('rejects a .json --out (CliError 2)', async () => {
    await expect(runArch(parseArgs(['arch', fixture, '--out', 'x.json']), deps())).rejects.toMatchObject({ code: 2 });
  });
});
