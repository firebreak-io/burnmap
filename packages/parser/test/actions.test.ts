import { describe, it, expect } from 'vitest';
import { mapAction } from '../src/actions.js';

describe('mapAction', () => {
  it('maps single-action arrays', () => {
    expect(mapAction(['no-op'])).toBe('no-op');
    expect(mapAction(['create'])).toBe('create');
    expect(mapAction(['read'])).toBe('read');
    expect(mapAction(['update'])).toBe('update');
    expect(mapAction(['delete'])).toBe('delete');
  });

  it('maps both replace orderings to "replace"', () => {
    expect(mapAction(['create', 'delete'])).toBe('replace');
    expect(mapAction(['delete', 'create'])).toBe('replace');
  });

  it('falls back to "update" for unrecognized combinations', () => {
    expect(mapAction(['something-weird'])).toBe('update');
    expect(mapAction([])).toBe('update');
  });
});
