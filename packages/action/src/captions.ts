// packages/action/src/captions.ts
import path from 'node:path';

export type LabelsFrom = 'none' | 'filename' | 'path-parent' | 'relative-path';

const MAX = 80;

/** Parse the `labels` JSON-object input. Empty → {}. Malformed → throws. */
export function parseLabels(json: string): Record<string, string> {
  const trimmed = json.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`labels: invalid JSON object (${(err as Error).message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('labels: must be a JSON object of { "relative/path": "caption" }');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string') throw new Error(`labels: value for "${k}" must be a string`);
    out[k] = v;
  }
  return out;
}

function derive(rel: string, from: LabelsFrom): string {
  switch (from) {
    case 'filename': return path.basename(rel, '.json');
    case 'path-parent': return path.basename(path.dirname(rel));
    case 'relative-path': return rel;
    case 'none': default: return '';
  }
}

/** Clean control chars/newlines and truncate. */
function clean(raw: string): string | undefined {
  // strip control chars (incl. newlines/tabs/DEL), then collapse whitespace
  // eslint-disable-next-line no-control-regex
  const oneLine = raw.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return oneLine.length > MAX ? `${oneLine.slice(0, MAX)}…` : oneLine;
}

/** Resolve the caption for one plan. labels[rel] wins over labels-from. */
export function resolveCaption(
  rel: string,
  opts: { labelsFrom: LabelsFrom; labels: Record<string, string> },
): string | undefined {
  const explicit = opts.labels[rel];
  const raw = explicit !== undefined ? explicit : derive(rel, opts.labelsFrom);
  return clean(raw);
}
