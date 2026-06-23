import type { RawPlan, ChangeModel } from '@burnmap/parser';
import { rasterizeSvg } from '@burnmap/shoot';
import { parseArch } from './parse-config.js';
import { tintWithChanges } from './join.js';
import { layoutArch } from './layout.js';
import { renderSvg } from './svg.js';
import type { ArchMeta } from './types.js';

export interface RenderOptions {
  /** When provided, changed resources are tinted on the diagram. */
  changes?: ChangeModel;
}

/** Plan JSON → laid-out SVG string. */
export async function archToSvg(
  plan: RawPlan,
  meta: ArchMeta,
  opts: RenderOptions = {},
): Promise<string> {
  let model = parseArch(plan, meta);
  if (opts.changes) model = tintWithChanges(model, opts.changes);
  const positioned = await layoutArch(model);
  return renderSvg(positioned);
}

/** Plan JSON → PNG file (screenshot of the SVG). Returns the output path. */
export async function archToPng(
  plan: RawPlan,
  meta: ArchMeta,
  outPath: string,
  opts: RenderOptions = {},
): Promise<string> {
  const svg = await archToSvg(plan, meta, opts);
  return rasterizeSvg(svg, outPath);
}
