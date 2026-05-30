import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'burnmap-cli-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const PLAN = {
  format_version: '1.2',
  terraform_version: '1.12.1',
  resource_changes: [
    {
      address: 'aws_s3_bucket.logs', mode: 'managed', type: 'aws_s3_bucket', name: 'logs',
      provider_name: 'registry.terraform.io/hashicorp/aws',
      change: { actions: ['create'], before: null, after: { bucket: 'logs' } },
    },
  ],
  output_changes: {},
};

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

describe('burnmap-shoot cli', () => {
  it('parses a plan json and writes a PNG', () => {
    const planPath = path.join(work, 'plan.json');
    const outPath = path.join(work, 'out.png');
    writeFileSync(planPath, JSON.stringify(PLAN), 'utf8');

    execFileSync('npx', ['tsx', cli, planPath, '--out', outPath, '--repo', 'firebreak-io/infra', '--pr', '7', '--sha', 'deadbee'], {
      encoding: 'utf8', env: { ...process.env },
    });

    expect(existsSync(outPath)).toBe(true);
    expect(isPng(readFileSync(outPath))).toBe(true);
  });

  it('exits non-zero when --out is missing', () => {
    const planPath = path.join(work, 'plan2.json');
    writeFileSync(planPath, JSON.stringify(PLAN), 'utf8');
    expect(() => execFileSync('npx', ['tsx', cli, planPath], { encoding: 'utf8' })).toThrow();
  });
});
