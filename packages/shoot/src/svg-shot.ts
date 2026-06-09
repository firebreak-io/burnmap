import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture } from './capture.js';

/** Wrap an SVG in a minimal HTML page that signals readiness, then screenshot it. */
export async function rasterizeSvg(svg: string, outPath: string): Promise<string> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}</style></head>
<body><div class="arch-shot" style="display:inline-block">${svg}</div>
<script>window.__BURNMAP_READY__ = true;</script></body></html>`;

  const htmlPath = path.join(tmpdir(), `burnmap-arch-${process.pid}-${outPath.length}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  try {
    await capture({ shotHtmlPath: htmlPath, outPath, selector: '.arch-shot' });
    return outPath;
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
