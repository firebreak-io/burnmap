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

  it('exits non-zero with a message when the plan file is missing', () => {
    expect(() => run(['/nonexistent/plan.json'])).toThrow();
  });
});
