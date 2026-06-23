import { parsePlan, type RawPlan, type ChangeMeta, type ChangeModel } from '@burnmap/parser';
import type { ParsedArgs } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface RenderDeps {
  readFile: (p: string) => string;
  writeFile: (p: string, data: string) => void;
  renderArchSvg: (plan: RawPlan, meta: ChangeMeta) => Promise<string>;
  renderDiffPng: (model: ChangeModel, out: string) => Promise<void>;
  join: (a: string, b: string) => string;
  stdout: (s: string) => void;
  ensureChromium: () => void;
  now: () => string;
}

export async function runRender(args: ParsedArgs, deps: RenderDeps): Promise<void> {
  if (!args.planPath) throw new CliError('render requires a <plan.json> path', 2);
  if (!args.outDir) throw new CliError('render requires --out-dir <dir>', 2);

  let plan: RawPlan;
  try {
    plan = JSON.parse(deps.readFile(args.planPath)) as RawPlan;
  } catch (err) {
    throw new CliError(`cannot read or parse ${args.planPath}: ${(err as Error).message}`, 2);
  }

  // Fail fast before writing partial output: the diff PNG needs Chromium.
  deps.ensureChromium();

  const meta = buildMeta(plan, deps.now());
  const model = parsePlan(plan, meta);

  const modelPath = deps.join(args.outDir, 'model.json');
  const archPath = deps.join(args.outDir, 'arch.svg');
  const diffPath = deps.join(args.outDir, 'diff.png');

  deps.writeFile(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  deps.writeFile(archPath, await deps.renderArchSvg(plan, meta));
  await deps.renderDiffPng(model, diffPath);

  deps.stdout(`${modelPath}\n${archPath}\n${diffPath}\n`);
}
