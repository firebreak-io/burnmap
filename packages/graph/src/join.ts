import type { Action, ChangeModel } from '@burnmap/parser';
import type { ArchModel } from './types.js';

// Higher value wins when several instances of one config node have different actions.
const RANK: Record<Action, number> = {
  delete: 5, replace: 4, create: 3, update: 2, read: 1, 'no-op': 0,
};

/** Strip a trailing `[index]` / `["key"]` from a resource address. */
function configAddress(address: string): string {
  return address.replace(/\[[^\]]*\]$/, '');
}

/** Set `node.action` from the ChangeModel, joining by config address. */
export function tintWithChanges(model: ArchModel, changes: ChangeModel): ArchModel {
  const byNode = new Map<string, Action>();
  for (const mod of changes.modules) {
    for (const group of mod.types) {
      for (const rc of group.resources) {
        const id = configAddress(rc.address);
        const prev = byNode.get(id);
        if (prev === undefined || RANK[rc.action] > RANK[prev]) byNode.set(id, rc.action);
      }
    }
  }
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      const action = byNode.get(n.id);
      return action ? { ...n, action } : n;
    }),
  };
}
