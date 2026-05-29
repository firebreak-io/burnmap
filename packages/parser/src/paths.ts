import type { JsonValue } from './types.js';

/** Convert a segment array (["tags","Name"] or ["ports",0]) to "tags.Name" / "ports[0]". */
export function pathToString(segments: Array<string | number>): string {
  let s = '';
  for (const seg of segments) {
    if (typeof seg === 'number') s += `[${seg}]`;
    else s += s ? `.${seg}` : seg;
  }
  return s;
}

/** Flatten an object/array to a Map of leaf-path → primitive value. null is a leaf. */
export function flattenLeaves(
  value: unknown,
  prefix = '',
  out: Map<string, JsonValue> = new Map(),
): Map<string, JsonValue> {
  if (value === null || typeof value !== 'object') {
    // A bare scalar at the top level has no attribute path; skip it rather than
    // emit a confusing empty-string key. Callers always start from an object.
    if (prefix === '') return out;
    out.set(prefix, value as JsonValue);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenLeaves(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flattenLeaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Collect every path whose value is exactly `true` (tofu's unknown/sensitive masks). */
export function flattenTruePaths(
  value: unknown,
  prefix = '',
  out: Set<string> = new Set(),
): Set<string> {
  if (value === true) {
    out.add(prefix);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenTruePaths(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flattenTruePaths(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** True if `path` equals a marker or descends from one (ancestor coverage). */
export function isCoveredBy(path: string, markers: Set<string>): boolean {
  if (markers.has(path)) return true;
  for (const m of markers) {
    if (path.startsWith(`${m}.`) || path.startsWith(`${m}[`)) return true;
  }
  return false;
}
