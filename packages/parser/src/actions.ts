import type { Action } from './types.js';

/** Normalize a tofu plan `change.actions` array into a single Action. */
export function mapAction(actions: string[]): Action {
  switch (actions.join(',')) {
    case 'no-op': return 'no-op';
    case 'create': return 'create';
    case 'read': return 'read';
    case 'update': return 'update';
    case 'delete': return 'delete';
    case 'create,delete':
    case 'delete,create':
      return 'replace';
    default:
      return 'update'; // defensive: unknown combos render as a plain change
  }
}
