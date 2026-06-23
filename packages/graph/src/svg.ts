import type { PositionedArch, PositionedEdge } from './layout.js';

// burnmap dark theme. Action tints applied via CSS class on each node rect.
const STYLE = `
  .bg { fill: #1a1614; }
  .cluster { fill: #211b18; stroke: #6a5b53; stroke-width: 1; }
  .cluster-label { fill: #b8a99e; font: 12px ui-sans-serif, system-ui; }
  .node { fill: #2b2320; stroke: #888; stroke-width: 1.5; }
  .node.create { stroke: #7fb069; }
  .node.update { stroke: #d9c36b; }
  .node.replace { stroke: #e8a33d; }
  .node.delete { stroke: #e8743b; }
  .ntype { fill: #e8a07b; font: 12px ui-sans-serif, system-ui; }
  .nname { fill: #cbb; font: 11px ui-sans-serif, system-ui; }
  .edge { stroke: #888; fill: none; stroke-width: 1.25; }
`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function edgePath(e: PositionedEdge): string {
  if (e.points.length === 0) return '';
  const [first, ...rest] = e.points;
  if (!first) return '';
  const d = `M${first.x} ${first.y}` + rest.map((p) => ` L${p.x} ${p.y}`).join('');
  return `<path class="edge" d="${d}" marker-end="url(#arrow)"/>`;
}

/** Render a positioned diagram to a standalone SVG string. */
export function renderSvg(arch: PositionedArch): string {
  const w = arch.width;
  const h = arch.height;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  parts.push(`<style>${STYLE}</style>`);
  parts.push('<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#888"/></marker></defs>');
  parts.push(`<rect class="bg" x="0" y="0" width="${w}" height="${h}"/>`);

  for (const c of arch.clusters) {
    parts.push(`<rect class="cluster" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="6"/>`);
    parts.push(`<text class="cluster-label" x="${c.x + 10}" y="${c.y + 18}">${esc(c.label)}</text>`);
  }
  for (const e of arch.edges) parts.push(edgePath(e));
  for (const n of arch.nodes) {
    const cls = n.action ? `node ${n.action}` : 'node';
    const cx = n.x + n.w / 2;
    parts.push(`<rect class="${cls}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4"/>`);
    parts.push(`<text class="ntype" x="${cx}" y="${n.y + 17}" text-anchor="middle">${esc(n.type)}</text>`);
    parts.push(`<text class="nname" x="${cx}" y="${n.y + 31}" text-anchor="middle">${esc(n.name)}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}
