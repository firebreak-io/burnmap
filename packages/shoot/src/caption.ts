import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture } from './capture.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Composite a caption strip above an existing PNG and screenshot the result. */
export async function captionPng(png: Buffer, caption: string, outPath: string): Promise<string> {
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  // Caption strip: dark bg, light single-line sans-serif text, ~32px tall.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .captioned{display:inline-block;background:#1a1614}
    .cap{height:32px;line-height:32px;padding:0 12px;color:#e8d8cf;
      font:13px/32px "Noto Sans","DejaVu Sans",ui-sans-serif,system-ui,sans-serif;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #3a302b}
    .cap-img{display:block}
  </style></head><body>
  <div class="captioned"><div class="cap">${esc(caption)}</div>
  <img class="cap-img" src="${dataUri}"></div>
  <script>
    // signal readiness only once the embedded image has decoded
    const img = document.querySelector('.cap-img');
    if (img.complete) window.__BURNMAP_READY__ = true;
    else img.onload = () => { window.__BURNMAP_READY__ = true; };
  </script></body></html>`;

  const htmlPath = path.join(tmpdir(), `burnmap-caption-${process.pid}-${outPath.length}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  try {
    await capture({ shotHtmlPath: htmlPath, outPath, selector: '.captioned' });
    return outPath;
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
