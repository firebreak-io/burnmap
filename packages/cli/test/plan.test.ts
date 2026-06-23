import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../src/commands/plan.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));

function deps(overrides = {}) {
  const calls: string[] = [];
  const written: string[] = [];
  return {
    calls, written,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    renderDiffPng: async (_model: unknown, out: string) => { calls.push('render'); written.push(out); },
    stdout: () => {},
    ensureChromium: () => { calls.push('ensure'); },
    now: () => '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

describe('runPlan', () => {
  it('guards Chromium before rendering the diff PNG', async () => {
    const d = deps();
    await runPlan(parseArgs(['plan', fixture, '--out', 'diff.png']), d);
    expect(d.calls).toEqual(['ensure', 'render']);
    expect(d.written).toEqual(['diff.png']);
  });

  it('does NOT render when the Chromium guard throws', async () => {
    const d = deps({ ensureChromium: () => { throw new CliError('no chromium', 3); } });
    await expect(runPlan(parseArgs(['plan', fixture, '--out', 'diff.png']), d)).rejects.toMatchObject({ code: 3 });
    expect(d.calls).not.toContain('render');
  });

  it('requires --out (CliError 2)', async () => {
    await expect(runPlan(parseArgs(['plan', fixture]), deps())).rejects.toMatchObject({ code: 2 });
  });

  it('rejects a non-.png --out (CliError 2)', async () => {
    await expect(runPlan(parseArgs(['plan', fixture, '--out', 'x.svg']), deps())).rejects.toMatchObject({ code: 2 });
  });
});
