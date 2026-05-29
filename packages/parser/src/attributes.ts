import type { Action, AttrChange, JsonValue } from './types.js';
import type { RawChange } from './plan-json.js';
import { flattenLeaves, flattenTruePaths, isCoveredBy, pathToString } from './paths.js';

const REDACTED = '«sensitive»';
const UNKNOWN_AFTER = '(known after apply)';

/**
 * Compute changed attributes for an update/replace change.
 * Returns [] for create/delete — the action itself is the information there.
 */
export function diffAttributes(change: RawChange, action: Action): AttrChange[] {
  if (action !== 'update' && action !== 'replace') return [];

  const beforeLeaves = flattenLeaves(change.before ?? {});
  const afterLeaves = flattenLeaves(change.after ?? {});
  const unknown = flattenTruePaths(change.after_unknown ?? false);
  const sensitive = new Set<string>([
    ...flattenTruePaths(change.before_sensitive ?? false),
    ...flattenTruePaths(change.after_sensitive ?? false),
  ]);
  const force = new Set<string>(
    (change.replace_paths ?? []).map((segments) => pathToString(segments)),
  );

  const paths = new Set<string>([
    ...beforeLeaves.keys(),
    ...afterLeaves.keys(),
    ...unknown,
  ]);

  const out: AttrChange[] = [];
  for (const path of paths) {
    const isUnknown = isCoveredBy(path, unknown) || unknown.has(path);
    const before: JsonValue | null = beforeLeaves.has(path) ? beforeLeaves.get(path)! : null;
    const after: JsonValue | null = afterLeaves.has(path) ? afterLeaves.get(path)! : null;

    const changed = isUnknown || !valuesEqual(before, after);
    if (!changed) continue;

    const isSensitive = isCoveredBy(path, sensitive) || sensitive.has(path);
    out.push({
      path,
      before: isSensitive ? REDACTED : before,
      after: isSensitive ? REDACTED : isUnknown ? UNKNOWN_AFTER : after,
      sensitive: isSensitive,
      unknown: isUnknown,
      forcesReplacement: isCoveredBy(path, force) || force.has(path),
    });
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Leaf values are primitives; strict equality is sufficient. */
function valuesEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  return a === b;
}
