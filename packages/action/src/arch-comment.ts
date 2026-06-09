import type { ArchMeta } from '@burnmap/graph';

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
