import { describe, it, expect } from 'vitest';
import { ACTION_GLYPH, ACTION_LABEL, ACTION_KIND } from '../src/glyphs';

describe('glyph maps', () => {
  it('maps every action to a glyph, label, and css kind', () => {
    expect(ACTION_GLYPH.create).toBe('+');
    expect(ACTION_GLYPH.update).toBe('~');
    expect(ACTION_GLYPH.replace).toBe('±');
    expect(ACTION_GLYPH.delete).toBe('×');
    expect(ACTION_LABEL.delete).toBe('destroy');
    expect(ACTION_LABEL.replace).toBe('replace');
    // css "kind" token drives color classes; delete renders as the "destroy" palette
    expect(ACTION_KIND.delete).toBe('destroy');
    expect(ACTION_KIND.create).toBe('create');
  });
});
