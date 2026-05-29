#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlan } from './parse.js';
import type { ChangeMeta } from './types.js';
import type { RawPlan } from './plan-json.js';

interface Flags {
  planPath?: string;
  repo: string;
  pr: number;
  sha: string;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { repo: '', pr: 0, sha: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--repo': flags.repo = argv[++i] ?? ''; break;
      case '--pr': flags.pr = Number(argv[++i] ?? '0'); break;
      case '--sha': flags.sha = argv[++i] ?? ''; break;
      default:
        if (!arg.startsWith('--')) flags.planPath = arg;
    }
  }
  return flags;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.planPath) {
    process.stderr.write('usage: burnmap-parse <plan.json> [--repo R] [--pr N] [--sha S]\n');
    process.exit(2);
  }

  let plan: RawPlan | undefined;
  try {
    plan = JSON.parse(readFileSync(flags.planPath, 'utf8')) as RawPlan;
  } catch (err) {
    process.stderr.write(`error: cannot read plan file ${flags.planPath}: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const resolvedPlan = plan!;
  const meta: ChangeMeta = {
    repo: flags.repo,
    prNumber: flags.pr,
    commitSha: flags.sha,
    terraformVersion: resolvedPlan.terraform_version ?? 'unknown',
    generatedAt: new Date().toISOString(),
  };

  process.stdout.write(`${JSON.stringify(parsePlan(resolvedPlan, meta), null, 2)}\n`);
}

main();
