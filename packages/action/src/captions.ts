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

export interface CaptionResolution {
  caption: string | undefined;   // final: cleaned + truncated (same as resolveCaption)
  full: string | undefined;      // cleaned but NOT truncated (for logging)
  truncated: boolean;            // was the cleaned label longer than the budget?
  hadControlChars: boolean;      // did cleaning strip any control chars/newlines?
}

/** Resolve the caption for one plan with full diagnostic detail. labels[rel] wins over labels-from. */
export function resolveCaptionDetailed(
  rel: string,
  opts: { labelsFrom: LabelsFrom; labels: Record<string, string> },
): CaptionResolution {
  const explicit = opts.labels[rel];
  const raw = explicit !== undefined ? explicit : derive(rel, opts.labelsFrom);

  // eslint-disable-next-line no-control-regex
  const hadControlChars = /[\x00-\x1f\x7f]/.test(raw);

  // strip control chars (incl. newlines/tabs/DEL), then collapse whitespace
  // eslint-disable-next-line no-control-regex
  const oneLine = raw.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!oneLine) {
    return { caption: undefined, full: undefined, truncated: false, hadControlChars };
  }

  const truncated = oneLine.length > MAX;
  const full = oneLine;
  const caption = truncated ? `${oneLine.slice(0, MAX)}…` : oneLine;
  return { caption, full, truncated, hadControlChars };
}

/** Resolve the caption for one plan. labels[rel] wins over labels-from. */
export function resolveCaption(
  rel: string,
  opts: { labelsFrom: LabelsFrom; labels: Record<string, string> },
): string | undefined {
  return resolveCaptionDetailed(rel, opts).caption;
}
