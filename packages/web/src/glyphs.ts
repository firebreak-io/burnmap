import type { Action } from '@burnmap/parser';

/** Single-character glyph drawn in the colored square for each action. */
export const ACTION_GLYPH: Record<Action, string> = {
  create: '+', update: '~', replace: '±', delete: '×', 'no-op': '·', read: '?',
};

/** Human label used in summary pills and badges. */
export const ACTION_LABEL: Record<Action, string> = {
  create: 'create', update: 'change', replace: 'replace', delete: 'destroy', 'no-op': 'no-op', read: 'read',
};

/** CSS color token: maps an action to one of create|update|replace|destroy. */
export const ACTION_KIND: Record<Action, string> = {
  create: 'create', update: 'update', replace: 'replace', delete: 'destroy', 'no-op': 'update', read: 'update',
};
