import type { AttrChange, ChangeModel, ResourceChange } from '@burnmap/parser';

/** Resources scoring at or above this are surfaced in the danger index and rendered "hot". */
export const HIGH_RISK_THRESHOLD = 60;

export function isHighRisk(rc: ResourceChange): boolean {
  return rc.dangerScore >= HIGH_RISK_THRESHOLD;
}

/** All high-risk resources across every module, most dangerous first. */
export function highRiskList(model: ChangeModel): ResourceChange[] {
  return model.modules
    .flatMap((m) => m.types.flatMap((t) => t.resources))
    .filter(isHighRisk)
    .sort((a, b) => b.dangerScore - a.dangerScore || a.address.localeCompare(b.address));
}

/** Longest attribute value we display inline before truncating, to protect row layout. */
export const MAX_VALUE_LEN = 120;

/**
 * Render a JSON value for display. `JSON.stringify` gives correctly-quoted,
 * fully-escaped output for strings (handling embedded quotes/newlines/tabs) and
 * the natural form for numbers/booleans/null/objects. Long values are truncated
 * so a giant blob (e.g. an inline IAM policy) can't blow out the row.
 */
export function formatValue(value: unknown): string {
  const s = JSON.stringify(value) ?? String(value);
  return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s;
}

/** "path before → after", with markers (sensitive / known-after-apply) shown unquoted. */
export function formatAttr(attr: AttrChange): string {
  const before = attr.sensitive ? '«sensitive»' : formatValue(attr.before);
  const after = attr.sensitive
    ? '«sensitive»'
    : attr.unknown
      ? '(known after apply)'
      : formatValue(attr.after);
  return `${attr.path} ${before} → ${after}`;
}

/**
 * Drop the "module.x." prefix so a row shows type.name within its group.
 * Invariant: for non-root resources the parser's `address` starts with
 * `${module}.`. If a future address format diverges, this falls back to the
 * full address (the row would then show a redundant module prefix).
 */
export function relativeAddress(rc: ResourceChange): string {
  if (rc.module && rc.address.startsWith(`${rc.module}.`)) {
    return rc.address.slice(rc.module.length + 1);
  }
  return rc.address;
}

/**
 * True when the plan has resource actions to take (create/update/replace/delete).
 * `model.modules` is built by the parser from exactly those displayed actions
 * — `no-op`/`read` are excluded — so an empty `modules` means "no changes",
 * mirroring tofu's own "No changes" determination. Output changes and drift are
 * handled separately (as tofu does) and do not affect this predicate.
 */
export function hasResourceChanges(model: ChangeModel): boolean {
  return model.modules.length > 0;
}
