import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runParse } from '../src/commands/parse.js';
import { parseArgs } from '../src/args.js';
import { CliError } from '../src/errors.js';

const fixture = fileURLToPath(new URL('./fixtures/simple.json', import.meta.url));
const NOW = '2026-06-23T00:00:00Z';

function deps(overrides = {}) {
  const written: Record<string, string> = {};
  const printed: string[] = [];
  return {
    written, printed,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    writeFile: (p: string, d: string) => { written[p] = d; },
    stdout: (s: string) => { printed.push(s); },
    now: () => NOW,
    ...overrides,
  };
}

describe('runParse', () => {
  it('prints ChangeModel JSON to stdout when no --out', () => {
    const d = deps();
    runParse(parseArgs(['parse', fixture]), d);
    const printed = d.printed.join('');
    const model = JSON.parse(printed);
    expect(model.summary.create).toBe(1);
    expect(model.meta.terraformVersion).toBe('1.12.1');
    expect(Object.keys(d.written)).toHaveLength(0);
  });

  it('writes JSON to --out and prints nothing to stdout', () => {
    const d = deps();
    runParse(parseArgs(['parse', fixture, '--out', 'model.json']), d);
    expect(d.printed.join('')).toBe('');
    expect(JSON.parse(d.written['model.json']!).summary.create).toBe(1);
  });

  it('throws CliError(2) when plan path is missing', () => {
    try { runParse(parseArgs(['parse']), deps()); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('throws CliError(2) on unreadable plan', () => {
    const d = deps({ readFile: () => { throw new Error('ENOENT'); } });
    try { runParse(parseArgs(['parse', 'nope.json']), d); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('throws CliError(2) on invalid JSON', () => {
    const d = deps({ readFile: () => '{ not json' });
    try { runParse(parseArgs(['parse', 'bad.json']), d); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('rejects a non-.json --out', () => {
    try { runParse(parseArgs(['parse', fixture, '--out', 'x.png']), deps()); throw new Error('no throw'); }
    catch (e) { expect((e as CliError).code).toBe(2); }
  });
});
