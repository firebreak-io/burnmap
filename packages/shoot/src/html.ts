const MODULE_SCRIPT = '<script type="module"';

/**
 * Insert `window.__BURNMAP_DATA__ = <model>` as an inline script immediately
 * before the app's module bundle, so the data exists when the bundle runs.
 * `<` is escaped to `<` so a string value containing `</script>` cannot
 * break out of the inline script.
 */
export function buildShotHtml(builtHtml: string, model: unknown): string {
  const idx = builtHtml.indexOf(MODULE_SCRIPT);
  if (idx === -1) {
    throw new Error('buildShotHtml: no module script tag found in built HTML');
  }
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const inject = `<script>window.__BURNMAP_DATA__ = ${json};</script>`;
  return builtHtml.slice(0, idx) + inject + builtHtml.slice(idx);
}
