import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildShotHtml } from './html.js';

/** Filename for the temporary injected HTML, written inside dist so ./assets resolve. */
export const SHOT_HTML_NAME = '__burnmap_shot.html';

/** Absolute path to the built @burnmap/web dist directory. */
export function resolveWebDist(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve('@burnmap/web/package.json');
  return path.join(path.dirname(pkgJson), 'dist');
}

/** Write the injected HTML into the dist dir; returns its absolute path. */
export function writeShotHtml(webDist: string, model: unknown): string {
  const builtHtml = readFileSync(path.join(webDist, 'index.html'), 'utf8');
  const outPath = path.join(webDist, SHOT_HTML_NAME);
  writeFileSync(outPath, buildShotHtml(builtHtml, model), 'utf8');
  return outPath;
}

/** Remove the temporary injected HTML (best-effort). */
export function cleanupShotHtml(webDist: string): void {
  rmSync(path.join(webDist, SHOT_HTML_NAME), { force: true });
}
