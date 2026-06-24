import { parsePlan, type RawPlan } from '@burnmap/parser';
import { outKind, type ParsedArgs } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface ParseDeps {
  readFile: (p: string) => string;
  writeFile: (p: string, data: string) => void;
  stdout: (s: string) => void;
  now: () => string;
}

export function runParse(args: ParsedArgs, deps: ParseDeps): void {
  if (!args.planPath) throw new CliError('parse requires a <plan.json> path', 2);
  if (args.out && outKind(args.out) !== 'json') {
    throw new CliError(`parse --out must end in .json (got ${args.out})`, 2);
  }

  let raw: string;
  try {
    raw = deps.readFile(args.planPath);
  } catch (err) {
    throw new CliError(`cannot read ${args.planPath}: ${(err as Error).message}`, 2);
  }

  let plan: RawPlan;
  try {
    plan = JSON.parse(raw) as RawPlan;
  } catch (err) {
    throw new CliError(`invalid JSON in ${args.planPath}: ${(err as Error).message}`, 2);
  }

  const model = parsePlan(plan, buildMeta(plan, deps.now()));
  const json = `${JSON.stringify(model, null, 2)}\n`;
  if (args.out) deps.writeFile(args.out, json);
  else deps.stdout(json);
}
