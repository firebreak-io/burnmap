import type { ArchMeta } from '@burnmap/graph';
import type { MultiCommentItem } from './comment.js';

/** Hidden marker identifying burnmap's architecture sticky comment. */
export function archCommentMarker(prNumber: number): string {
  return `<!-- burnmap:arch:pr-${prNumber} -->`;
}

/** Build the architecture sticky-comment markdown body. */
export function buildArchCommentBody(meta: ArchMeta, imageUrl: string): string {
  return [
    archCommentMarker(meta.prNumber),
    `### 🗺 burnmap — architecture for \`${meta.repo}\` @ \`${meta.commitSha}\``,
    '',
    `![burnmap architecture](${imageUrl})`,
  ].join('\n');
}

/** One sticky comment embedding several architecture diagrams (multi-plan runs). */
export function buildArchMultiCommentBody(
  prNumber: number,
  repo: string,
  sha: string,
  items: MultiCommentItem[],
): string {
  const lines: string[] = [
    archCommentMarker(prNumber),
    `### 🗺 burnmap — architecture for \`${repo}\` @ \`${sha}\``,
    '',
  ];
  for (const it of items) {
    lines.push(`**${it.caption ?? it.rel}**`, '', `![burnmap architecture](${it.imageUrl})`, '');
  }
  return lines.join('\n');
}
