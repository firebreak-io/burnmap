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

/** Quote strings; JSON-encode everything else. */
export function formatValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
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

/** Drop the "module.x." prefix so a row shows type.name within its group. */
export function relativeAddress(rc: ResourceChange): string {
  if (rc.module && rc.address.startsWith(`${rc.module}.`)) {
    return rc.address.slice(rc.module.length + 1);
  }
  return rc.address;
}
