/** Walk an expression tree and collect every string in any `references` array. */
export function collectReferences(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (key === 'references' && Array.isArray(val)) {
          for (const r of val) if (typeof r === 'string') out.push(r);
        } else {
          visit(val);
        }
      }
    }
  };
  visit(value);
  return out;
}
