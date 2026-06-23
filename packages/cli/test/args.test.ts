import { describe, it, expect } from 'vitest';
import { parseArgs, outKind } from '../src/args.js';
import { CliError } from '../src/errors.js';

describe('parseArgs', () => {
  it('reads command, positional plan path, and --out', () => {
    const a = parseArgs(['arch', 'plan.json', '--out', 'out.svg']);
    expect(a.command).toBe('arch');
    expect(a.planPath).toBe('plan.json');
    expect(a.out).toBe('out.svg');
  });

  it('reads --out-dir and short/long help & version flags', () => {
    expect(parseArgs(['render', 'p.json', '--out-dir', './x']).outDir).toBe('./x');
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('treats the first non-flag as command and the second as plan path', () => {
    const a = parseArgs(['parse', 'a/b/plan.json']);
    expect(a.command).toBe('parse');
    expect(a.planPath).toBe('a/b/plan.json');
    expect(a.out).toBeUndefined();
  });

  it('throws CliError(2) on an unrecognized long option', () => {
    expect(() => parseArgs(['arch', 'p.json', '--out-dor', 'x.svg'])).toThrowError(CliError);
    try { parseArgs(['arch', 'p.json', '--out-dor', 'x.svg']); } catch (e) { expect((e as CliError).code).toBe(2); }
  });

  it('throws CliError(2) on an unrecognized short option', () => {
    expect(() => parseArgs(['parse', 'p.json', '-x'])).toThrowError(CliError);
    try { parseArgs(['parse', 'p.json', '-x']); } catch (e) { expect((e as CliError).code).toBe(2); }
  });
});

describe('outKind', () => {
  it('maps known extensions', () => {
    expect(outKind('x.svg')).toBe('svg');
    expect(outKind('x.PNG')).toBe('png');
    expect(outKind('dir/model.json')).toBe('json');
  });

  it('throws CliError(2) on an unsupported extension', () => {
    expect(() => outKind('x.gif')).toThrowError(CliError);
    try { outKind('x.gif'); } catch (e) { expect((e as CliError).code).toBe(2); }
  });
});
