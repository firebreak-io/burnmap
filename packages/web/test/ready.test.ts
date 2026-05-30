import { describe, it, expect } from 'vitest';
import { markReady, readModel } from '../src/ready';
import { sampleModel } from '../src/sample-data';

describe('markReady', () => {
  it('sets the screenshot-ready flag on the given window', () => {
    const win: Record<string, unknown> = {};
    markReady(win);
    expect(win.__BURNMAP_READY__).toBe(true);
  });
});

describe('readModel', () => {
  it('returns injected window data when present', () => {
    const injected = { ...sampleModel, meta: { ...sampleModel.meta, prNumber: 999 } };
    const win = { __BURNMAP_DATA__: injected } as Record<string, unknown>;
    expect(readModel(win, sampleModel).meta.prNumber).toBe(999);
  });

  it('falls back to the sample model when no data is injected', () => {
    expect(readModel({}, sampleModel)).toBe(sampleModel);
  });
});
