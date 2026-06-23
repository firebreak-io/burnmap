import { realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { glob } from 'tinyglobby';

export interface ResolvedPlan {
  /** Canonical absolute path (symlinks resolved). */
  path: string;
  /** Path relative to cwd, forward slashes, no leading "./". */
  rel: string;
}

/** Expand a literal path or glob into a stable, deduped, canonical plan list. */
export async function resolvePlans(
  pattern: string,
  cwd: string = process.cwd(),
): Promise<ResolvedPlan[]> {
  const cwdCanonical = realpathSync(cwd);
  const matches = await glob(pattern, { cwd, absolute: true, onlyFiles: true, dot: false });

  const byCanonical = new Map<string, ResolvedPlan>();
  for (const m of matches) {
    let canonical: string;
    try {
      canonical = realpathSync(m);
    } catch {
      canonical = path.resolve(m);
    }
    if (byCanonical.has(canonical)) continue;
    const rel = path.relative(cwdCanonical, canonical).split(path.sep).join('/');
    byCanonical.set(canonical, { path: canonical, rel });
  }

  const out = [...byCanonical.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (out.length === 0) {
    throw new Error(`no plan files matched "${pattern}" (cwd: ${cwd})`);
  }
  return out;
}

/** Short, stable discriminator for a plan's relative path (S3 key slug). */
export function planSlug(rel: string): string {
  return createHash('sha256').update(rel).digest('hex').slice(0, 8);
}
