import type {
  ModuleGroup, OutputChange, ResourceChange, ResourceTypeGroup,
} from './types.js';
import type { RawChange } from './plan-json.js';
import { mapAction } from './actions.js';
import { flattenTruePaths } from './paths.js';

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function maxScore(resources: ResourceChange[]): number {
  return resources.reduce((m, r) => Math.max(m, r.dangerScore), 0);
}

/** Group changes into module → type, ordered most-dangerous-first at every level. */
export function groupByModule(changes: ResourceChange[]): ModuleGroup[] {
  const byModule = new Map<string, ResourceChange[]>();
  for (const c of changes) pushTo(byModule, c.module, c);

  const groups: ModuleGroup[] = [];
  for (const [module, list] of byModule) {
    const byType = new Map<string, ResourceChange[]>();
    for (const c of list) pushTo(byType, c.type, c);

    const types: ResourceTypeGroup[] = [];
    for (const [type, resources] of byType) {
      resources.sort(
        (a, b) => b.dangerScore - a.dangerScore || a.address.localeCompare(b.address),
      );
      types.push({ type, resources });
    }
    types.sort(
      (a, b) => maxScore(b.resources) - maxScore(a.resources) || a.type.localeCompare(b.type),
    );
    groups.push({ module, types });
  }

  groups.sort((a, b) => {
    const sa = Math.max(0, ...a.types.map((t) => maxScore(t.resources)));
    const sb = Math.max(0, ...b.types.map((t) => maxScore(t.resources)));
    return sb - sa || a.module.localeCompare(b.module);
  });
  return groups;
}

/** Normalize root output_changes, dropping no-ops. */
export function parseOutputs(outputs: Record<string, RawChange>): OutputChange[] {
  const result: OutputChange[] = [];
  for (const [name, change] of Object.entries(outputs)) {
    const action = mapAction(change.actions);
    if (action === 'no-op') continue;
    const sensitive =
      flattenTruePaths(change.before_sensitive ?? false).size > 0 ||
      flattenTruePaths(change.after_sensitive ?? false).size > 0;
    result.push({ name, action, sensitive });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
