import type { RawPlan, ChangeMeta } from '@burnmap/parser';
import type { ParsedArgs } from '../args.js';
import { outKind } from '../args.js';
import { buildMeta } from '../meta.js';
import { CliError } from '../errors.js';

export interface ArchDeps {
  readFile: (p: string) => string;
  renderSvg: (plan: RawPlan, meta: ChangeMeta) => Promise<string>;
  renderPng: (plan: RawPlan, meta: ChangeMeta, out: string) => Promise<string>;
  writeFile: (p: string, data: string) => void;
  stdout: (s: string) => void;
  ensureChromium: () => void;
  now: () => string;
}

export async function runArch(args: ParsedArgs, deps: ArchDeps): Promise<void> {
  if (!args.planPath) throw new CliError('arch requires a <plan.json> path', 2);
  if (!args.out) throw new CliError('arch requires --out <file.svg|file.png>', 2);
  const kind = outKind(args.out); // throws CliError(2) on a bad extension
  if (kind === 'json') throw new CliError('arch --out must be .svg or .png', 2);

  let plan: RawPlan;
  try {
    plan = JSON.parse(deps.readFile(args.planPath)) as RawPlan;
  } catch (err) {
    throw new CliError(`cannot read or parse ${args.planPath}: ${(err as Error).message}`, 2);
  }

  const meta = buildMeta(plan, deps.now());
  if (kind === 'svg') {
    deps.writeFile(args.out, await deps.renderSvg(plan, meta));
  } else {
    deps.ensureChromium();
    await deps.renderPng(plan, meta, args.out);
  }
  deps.stdout(`${args.out}\n`);
}
