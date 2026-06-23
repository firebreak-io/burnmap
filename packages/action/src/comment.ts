import type { ChangeModel } from '@burnmap/parser';

const GLYPH: Record<string, string> = {
  create: '+', update: '~', replace: '±', delete: '×', 'no-op': '·', read: '?',
};
const HIGH_RISK = 60;

/** Hidden marker that identifies burnmap's single sticky comment on a PR. */
export function commentMarker(prNumber: number): string {
  return `<!-- burnmap:pr-${prNumber} -->`;
}

function countsLine(s: ChangeModel['summary']): string {
  const parts: string[] = [];
  if (s.create) parts.push(`${s.create} to add`);
  if (s.update) parts.push(`${s.update} to change`);
  if (s.replace) parts.push(`${s.replace} to replace`);
  if (s.delete) parts.push(`${s.delete} to destroy`);
  return `**${parts.join(' · ') || 'no changes'}**`;
}

function manifestLines(model: ChangeModel): string {
  const lines: string[] = [];
  for (const m of model.modules) {
    lines.push(`${m.module || 'root'}`);
    for (const t of m.types) {
      for (const rc of t.resources) {
        const flag = rc.dangerScore >= HIGH_RISK ? '⚠ ' : '  ';
        lines.push(`  ${flag}${GLYPH[rc.action] ?? '?'} ${rc.address}`);
      }
    }
  }
  return lines.join('\n');
}

/** Build the full sticky-comment markdown body. */
export function buildCommentBody(model: ChangeModel, imageUrl: string): string {
  const { meta } = model;
  return [
    commentMarker(meta.prNumber),
    `### 🔥 burnmap — plan for \`${meta.repo}\` @ \`${meta.commitSha}\``,
    '',
    countsLine(model.summary),
    '',
    `![burnmap plan](${imageUrl})`,
    '',
    '<details><summary>Plain-text manifest</summary>',
    '',
    '```',
    manifestLines(model),
    '```',
    '',
    '</details>',
  ].join('\n');
}

export interface MultiCommentItem {
  rel: string;
  imageUrl: string;
  caption?: string;
}

/** One sticky comment embedding several plan diagrams (multi-plan runs). */
export function buildMultiCommentBody(
  prNumber: number,
  repo: string,
  sha: string,
  items: MultiCommentItem[],
): string {
  const lines: string[] = [
    commentMarker(prNumber),
    `### 🔥 burnmap — plans for \`${repo}\` @ \`${sha}\``,
    '',
  ];
  for (const it of items) {
    lines.push(`**${it.caption ?? it.rel}**`, '', `![burnmap plan](${it.imageUrl})`, '');
  }
  return lines.join('\n');
}
