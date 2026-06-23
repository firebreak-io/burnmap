#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import type { RawPlan } from '@burnmap/parser';
import { archToSvg, archToPng } from './render.js';
import type { ArchMeta } from './types.js';

interface Flags { planPath?: string; out?: string; repo: string; pr: number; sha: string; }

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { repo: '', pr: 0, sha: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--out': flags.out = argv[++i]; break;
      case '--repo': flags.repo = argv[++i] ?? ''; break;
      case '--pr': {
        const v = argv[++i];
        flags.pr = v === undefined ? Number.NaN : Number(v);
        break;
      }
      case '--sha': flags.sha = argv[++i] ?? ''; break;
      default:
        if (!arg.startsWith('--')) flags.planPath = arg;
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.planPath || !flags.out) {
    process.stderr.write('usage: burnmap-graph <plan.json> --out <file.svg|file.png> [--repo R] [--pr N] [--sha S]\n');
    process.exit(2);
  }
  if (Number.isNaN(flags.pr)) {
    process.stderr.write('error: --pr requires a numeric value\n');
    process.exit(2);
  }

  let plan: RawPlan;
  try {
    plan = JSON.parse(readFileSync(flags.planPath, 'utf8')) as RawPlan;
  } catch (err) {
    process.stderr.write(`error: cannot read plan ${flags.planPath}: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const meta: ArchMeta = {
    repo: flags.repo,
    prNumber: flags.pr,
    commitSha: flags.sha,
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  if (flags.out.endsWith('.png')) {
    await archToPng(plan, meta, flags.out);
  } else {
    writeFileSync(flags.out, await archToSvg(plan, meta), 'utf8');
  }
  process.stdout.write(`${flags.out}\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
