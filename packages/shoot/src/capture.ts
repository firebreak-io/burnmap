import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

export interface CaptureOptions {
  /** Absolute path to the injected HTML file (inside the web dist dir). */
  shotHtmlPath: string;
  /** Where to write the PNG. */
  outPath: string;
  /** Render width in CSS px (the card maxes at 720 + padding). */
  width?: number;
  /** How long to wait for window.__BURNMAP_READY__ before failing. */
  readyTimeoutMs?: number;
  /** Element to screenshot. */
  selector?: string;
}

/** Load the built SPA, wait for READY, and screenshot the diagram to a PNG. */
export async function capture(opts: CaptureOptions): Promise<string> {
  const {
    shotHtmlPath, outPath, width = 760, readyTimeoutMs = 15000, selector = '.card',
  } = opts;

  // Vite emits `<script type="module" crossorigin>` + `<link crossorigin>`. Under
  // file:// the page origin is `null`, and ES modules are always fetched with CORS,
  // so chromium blocks the bundle/CSS. These flags allow the headless browser to
  // load our own locally-generated, self-contained diagram over file://. Safe here:
  // the content is trusted (we generated it) and no network requests are made.
  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files', '--disable-web-security'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      deviceScaleFactor: 2, // crisp output
    });
    await page.goto(pathToFileURL(shotHtmlPath).href);
    try {
      await page.waitForFunction(
        () => (window as unknown as { __BURNMAP_READY__?: boolean }).__BURNMAP_READY__ === true,
        undefined,
        { timeout: readyTimeoutMs },
      );
    } catch (err) {
      throw new Error(
        `capture: page never signalled __BURNMAP_READY__ within ${readyTimeoutMs}ms (${shotHtmlPath})`,
        { cause: err },
      );
    }
    // omitBackground drops Playwright's default white backdrop so the four
    // corners outside the card's rounded border render transparent. The shot
    // HTML also forces the html/body background transparent (see buildShotHtml).
    await page.locator(selector).first().screenshot({ path: outPath, omitBackground: true });
    return outPath;
  } finally {
    await browser.close();
  }
}
