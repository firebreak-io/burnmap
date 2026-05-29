import { describe, it, expect } from 'vitest';
import { sampleModel } from '../src/sample-data';
import { highRiskList } from '../src/model-view';

describe('sampleModel', () => {
  it('is a realistic model with two high-risk changes (matches the design mockup)', () => {
    expect(sampleModel.summary).toEqual({ create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 });
    const hot = highRiskList(sampleModel);
    expect(hot.map((r) => r.action).sort()).toEqual(['delete', 'replace']);
    // module.data is present and contains the forced DB replace
    const data = sampleModel.modules.find((m) => m.module === 'module.data');
    expect(data).toBeDefined();
    expect(JSON.stringify(sampleModel)).not.toContain('hunter2'); // no real secrets baked in
  });
});
