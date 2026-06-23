// packages/action/test/captions.test.ts
import { describe, it, expect } from 'vitest';
import { parseLabels, resolveCaption, resolveCaptionDetailed } from '../src/captions.js';

describe('parseLabels', () => {
  it('treats empty string as no labels', () => {
    expect(parseLabels('')).toEqual({});
  });
  it('parses a JSON object', () => {
    expect(parseLabels('{"a/plan.json":"A"}')).toEqual({ 'a/plan.json': 'A' });
  });
  it('throws on malformed JSON', () => {
    expect(() => parseLabels('{nope')).toThrow(/labels/i);
  });
});

describe('resolveCaption', () => {
  const L = (labels: Record<string, string> = {}, labelsFrom: any = 'none') => ({ labels, labelsFrom });

  it('returns undefined for none with no labels', () => {
    expect(resolveCaption('plans/net/plan.json', L())).toBeUndefined();
  });
  it('derives filename without extension', () => {
    expect(resolveCaption('plans/network.json', L({}, 'filename'))).toBe('network');
  });
  it('derives the parent directory name', () => {
    expect(resolveCaption('plans/network/plan.json', L({}, 'path-parent'))).toBe('network');
  });
  it('uses the full relative path', () => {
    expect(resolveCaption('plans/network/plan.json', L({}, 'relative-path'))).toBe('plans/network/plan.json');
  });
  it('lets explicit labels override labels-from', () => {
    expect(resolveCaption('plans/network/plan.json', L({ 'plans/network/plan.json': 'NET' }, 'path-parent'))).toBe('NET');
  });
  it('strips newlines/control chars', () => {
    expect(resolveCaption('x', L({ x: 'a\nb\tc' }, 'none'))).toBe('a b c');
  });
  it('truncates to 80 chars with an ellipsis', () => {
    const long = 'z'.repeat(200);
    const out = resolveCaption('x', L({ x: long }, 'none'))!;
    expect(out.length).toBe(81); // 80 chars + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
  it('treats an empty derived/explicit caption as none', () => {
    expect(resolveCaption('x', L({ x: '   ' }, 'none'))).toBeUndefined();
  });
  it('preserves hyphens and slashes, collapsing only whitespace', () => {
    expect(resolveCaption('x', L({ x: 'ec-dev / network' }, 'none'))).toBe('ec-dev / network');
  });
});

describe('resolveCaptionDetailed', () => {
  const L = (labels: Record<string, string> = {}, labelsFrom: any = 'none') => ({ labels, labelsFrom });

  it('(a) a label with a newline sets hadControlChars and full is the cleaned text', () => {
    const res = resolveCaptionDetailed('x', L({ x: 'hello\nworld' }));
    expect(res.hadControlChars).toBe(true);
    expect(res.full).toBe('hello world');
    expect(res.caption).toBe('hello world');
    expect(res.truncated).toBe(false);
  });

  it('(b) a >80-char label sets truncated with full being the full cleaned text and caption the truncated form', () => {
    const long = 'a'.repeat(100);
    const res = resolveCaptionDetailed('x', L({ x: long }));
    expect(res.truncated).toBe(true);
    expect(res.full).toBe(long);
    expect(res.caption).toBe(`${'a'.repeat(80)}…`);
    expect(res.hadControlChars).toBe(false);
  });

  it('(c) a clean short label sets both flags false and full === caption', () => {
    const res = resolveCaptionDetailed('x', L({ x: 'my-stack' }));
    expect(res.hadControlChars).toBe(false);
    expect(res.truncated).toBe(false);
    expect(res.full).toBe('my-stack');
    expect(res.caption).toBe('my-stack');
    expect(res.full).toBe(res.caption);
  });
});

describe('caption no-op (regression)', () => {
  it('none + no labels yields undefined for every path shape', () => {
    const opts = { labelsFrom: 'none' as const, labels: {} };
    for (const rel of ['plan.json', 'a/plan.json', 'a/b/c/plan.json']) {
      expect(resolveCaption(rel, opts)).toBeUndefined();
    }
  });
});
