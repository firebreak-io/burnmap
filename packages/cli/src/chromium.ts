import { CliError } from './errors.js';

export interface ChromiumDeps {
  /** Path Playwright would launch (playwright's chromium.executablePath). */
  executablePath: () => string;
  /** Filesystem existence check (node:fs existsSync). */
  exists: (p: string) => boolean;
}

const HINT = 'Chromium is not installed. Run: npx playwright install chromium';

/** Throw CliError(3) with a friendly hint unless a usable Chromium is present. */
export function ensureChromium(deps: ChromiumDeps): void {
  let path: string;
  try {
    path = deps.executablePath();
  } catch {
    // Playwright throws if no browser is registered at all.
    throw new CliError(HINT, 3);
  }
  if (!path || !deps.exists(path)) {
    throw new CliError(HINT, 3);
  }
}
