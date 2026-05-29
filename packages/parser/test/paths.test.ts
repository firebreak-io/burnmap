import { describe, it, expect } from 'vitest';
import {
  pathToString,
  flattenLeaves,
  flattenTruePaths,
  isCoveredBy,
} from '../src/paths.js';

describe('pathToString', () => {
  it('joins object keys with dots and indices with brackets', () => {
    expect(pathToString(['tags', 'Name'])).toBe('tags.Name');
    expect(pathToString(['ingress', 0, 'cidr'])).toBe('ingress[0].cidr');
    expect(pathToString(['engine_version'])).toBe('engine_version');
  });
});

describe('flattenLeaves', () => {
  it('flattens nested objects and arrays to leaf paths', () => {
    const m = flattenLeaves({
      instance_type: 't3.micro',
      tags: { Name: 'web', Env: 'prod' },
      ports: [80, 443],
    });
    expect(m.get('instance_type')).toBe('t3.micro');
    expect(m.get('tags.Name')).toBe('web');
    expect(m.get('tags.Env')).toBe('prod');
    expect(m.get('ports[0]')).toBe(80);
    expect(m.get('ports[1]')).toBe(443);
  });

  it('treats null as a leaf', () => {
    const m = flattenLeaves({ a: null });
    expect(m.has('a')).toBe(true);
    expect(m.get('a')).toBeNull();
  });
});

describe('flattenTruePaths', () => {
  it('collects only the paths whose value is exactly true', () => {
    const s = flattenTruePaths({ password: true, name: false, nested: { token: true } });
    expect([...s].sort()).toEqual(['nested.token', 'password']);
  });

  it('returns empty set for false / undefined', () => {
    expect(flattenTruePaths(false).size).toBe(0);
    expect(flattenTruePaths(undefined).size).toBe(0);
  });
});

describe('isCoveredBy', () => {
  it('matches exact paths', () => {
    expect(isCoveredBy('tags.Name', new Set(['tags.Name']))).toBe(true);
  });

  it('matches when an ancestor is marked', () => {
    expect(isCoveredBy('config.password', new Set(['config']))).toBe(true);
    expect(isCoveredBy('ingress[0].cidr', new Set(['ingress']))).toBe(true);
  });

  it('does not match unrelated or sibling-prefix paths', () => {
    expect(isCoveredBy('tags.Name', new Set(['tag']))).toBe(false);
    expect(isCoveredBy('name', new Set(['names']))).toBe(false);
  });
});
