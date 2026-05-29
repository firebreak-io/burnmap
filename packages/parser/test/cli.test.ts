import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/replace-db.json', import.meta.url));

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync('npx', ['tsx', cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('cli', () => {
  it('prints a ChangeModel JSON for a plan file with meta from flags', () => {
    const out = run([fixture, '--repo', 'firebreak/infra', '--pr', '142', '--sha', 'abc123']);
    const model = JSON.parse(out);
    expect(model.meta.repo).toBe('firebreak/infra');
    expect(model.meta.prNumber).toBe(142);
    expect(model.meta.commitSha).toBe('abc123');
    expect(model.summary.replace).toBe(1);
    // engine_version's diff appears in the model; assert the attribute is present.
    const json = JSON.stringify(model);
    expect(json).toContain('engine_version');
    expect(json).toContain('15.4');
  });

  it('exits with code 1 and a "cannot read" message when the plan file is missing', () => {
    let err: { status?: number; stderr?: Buffer } | undefined;
    try {
      run(['/nonexistent/plan.json']);
    } catch (e) {
      err = e as { status?: number; stderr?: Buffer };
    }
    expect(err?.status).toBe(1);
    expect(err?.stderr?.toString()).toContain('cannot read plan file');
  });

  it('exits with code 2 when --pr is not numeric', () => {
    let err: { status?: number; stderr?: Buffer } | undefined;
    try {
      run([fixture, '--pr', 'not-a-number']);
    } catch (e) {
      err = e as { status?: number; stderr?: Buffer };
    }
    expect(err?.status).toBe(2);
    expect(err?.stderr?.toString()).toContain('--pr requires a numeric value');
  });

  it('exits with code 2 when --pr has no value (trailing flag)', () => {
    let err: { status?: number; stderr?: Buffer } | undefined;
    try {
      run([fixture, '--pr']);
    } catch (e) {
      err = e as { status?: number; stderr?: Buffer };
    }
    expect(err?.status).toBe(2);
    expect(err?.stderr?.toString()).toContain('--pr requires a numeric value');
  });
});
