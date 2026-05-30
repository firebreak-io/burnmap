import type { ChangeModel } from '@burnmap/parser';

/** Set the flag Playwright polls before screenshotting. */
export function markReady(win: Record<string, unknown>): void {
  win.__BURNMAP_READY__ = true;
}

/** Use injected plan data if present, else the bundled sample (dev convenience). */
export function readModel(win: Record<string, unknown>, fallback: ChangeModel): ChangeModel {
  const injected = win.__BURNMAP_DATA__;
  return (injected as ChangeModel | undefined) ?? fallback;
}
