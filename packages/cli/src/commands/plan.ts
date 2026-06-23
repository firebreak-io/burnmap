import { parsePlan, type RawPlan, type ChangeModel } from '@burnmap/parser';
import { outKind, type ParsedArgs } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface PlanDeps {
  readFile: (p: string) => string;
  renderDiffPng: (model: ChangeModel, out: string) => Promise<void>;
  stdout: (s: string) => void;
  ensureChromium: () => void;
  now: () => string;
}

export async function runPlan(args: ParsedArgs, deps: PlanDeps): Promise<void> {
  if (!args.planPath) throw new CliError('plan requires a <plan.json> path', 2);
  if (!args.out) throw new CliError('plan requires --out <file.png>', 2);
  if (outKind(args.out) !== 'png') throw new CliError('plan --out must be .png', 2);

  let plan: RawPlan;
  try {
    plan = JSON.parse(deps.readFile(args.planPath)) as RawPlan;
  } catch (err) {
    throw new CliError(`cannot read or parse ${args.planPath}: ${(err as Error).message}`, 2);
  }

  const model = parsePlan(plan, buildMeta(plan, deps.now()));
  deps.ensureChromium();
  await deps.renderDiffPng(model, args.out);
  deps.stdout(`${args.out}\n`);
}
