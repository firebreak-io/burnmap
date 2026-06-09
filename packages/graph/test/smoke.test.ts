import { describe, it, expect } from 'vitest';
import { PACKAGE } from '../src/index.js';

describe('@burnmap/graph', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@burnmap/graph');
  });
});
