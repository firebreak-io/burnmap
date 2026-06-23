import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = path.join(__dirname, 'fixtures', 'flat-stack.json');
const cli = path.join(__dirname, '..', 'src', 'cli.ts');
const outSvg = path.join(tmpdir(), `burnmap-cli-${process.pid}.svg`);
afterAll(() => rmSync(outSvg, { force: true }));

const run = (args: string[]) =>
  execFileSync('npx', ['tsx', cli, ...args], { encoding: 'utf8' });

describe('burnmap-graph CLI', () => {
  it('writes an SVG file for --out *.svg', () => {
    run([fixture, '--out', outSvg, '--repo', 'o/r', '--sha', 'abc']);
    const svg = readFileSync(outSvg, 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('aws_vpc');
  });

  it('exits 2 with usage when no plan path is given', () => {
    expect(() => run(['--out', outSvg])).toThrow();
  });
});
