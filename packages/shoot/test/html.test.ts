import { describe, it, expect } from 'vitest';
import { buildShotHtml } from '../src/html.js';

const BUILT = `<!DOCTYPE html><html><head><title>burnmap</title></head>` +
  `<body><div id="root"></div><script type="module" crossorigin src="./assets/index-abc.js"></script></body></html>`;

describe('buildShotHtml', () => {
  it('injects window.__BURNMAP_DATA__ before the module script', () => {
    const out = buildShotHtml(BUILT, { summary: { create: 1 } });
    expect(out).toContain('window.__BURNMAP_DATA__ = {"summary":{"create":1}};');
    // injected before the bundle so it runs first
    expect(out.indexOf('__BURNMAP_DATA__')).toBeLessThan(out.indexOf('<script type="module"'));
    // bundle reference preserved
    expect(out).toContain('./assets/index-abc.js');
  });

  it('forces the html/body background transparent for the screenshot', () => {
    const out = buildShotHtml(BUILT, { summary: { create: 1 } });
    expect(out).toContain('html,body{background:transparent !important;}');
  });

  it('escapes < so a value containing </script> cannot break out', () => {
    const out = buildShotHtml(BUILT, { evil: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script><script>alert(1)');
    expect(out).toContain('\\u003c/script>'); // escaped form present
  });

  it('throws if the built HTML has no module script tag', () => {
    expect(() => buildShotHtml('<html><head></head><body></body></html>', {})).toThrow(/module script/i);
  });
});
