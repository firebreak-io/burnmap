import { describe, it, expect } from 'vitest';
import { diffAttributes } from '../src/attributes.js';
import type { RawChange } from '../src/plan-json.js';

describe('diffAttributes', () => {
  it('returns [] for create and delete actions', () => {
    const change: RawChange = { actions: ['create'], before: null, after: { a: 1 } };
    expect(diffAttributes(change, 'create')).toEqual([]);
    expect(diffAttributes({ ...change, actions: ['delete'] }, 'delete')).toEqual([]);
  });

  it('reports only changed leaf paths for an update', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { instance_type: 't3.micro', ami: 'ami-1', tags: { Name: 'web' } },
      after: { instance_type: 't3.small', ami: 'ami-1', tags: { Name: 'web' } },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs).toHaveLength(1);
    expect(attrs[0]).toMatchObject({
      path: 'instance_type',
      before: 't3.micro',
      after: 't3.small',
      sensitive: false,
      unknown: false,
      forcesReplacement: false,
    });
  });

  it('flags forced replacement from replace_paths (including descendants)', () => {
    const change: RawChange = {
      actions: ['delete', 'create'],
      before: { engine_version: '14.7' },
      after: { engine_version: '15.4' },
      replace_paths: [['engine_version']],
    };
    const attrs = diffAttributes(change, 'replace');
    expect(attrs[0]).toMatchObject({ path: 'engine_version', forcesReplacement: true });
  });

  it('marks unknown ("known after apply") values', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { arn: 'arn:old' },
      after: { arn: null },
      after_unknown: { arn: true },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs[0]).toMatchObject({ path: 'arn', unknown: true, after: '(known after apply)' });
  });

  it('redacts sensitive values and never leaks them', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { password: 'hunter2' },
      after: { password: 'correct-horse' },
      before_sensitive: { password: true },
      after_sensitive: { password: true },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs[0]).toMatchObject({
      path: 'password',
      sensitive: true,
      before: '«sensitive»',
      after: '«sensitive»',
    });
    expect(JSON.stringify(attrs)).not.toContain('hunter2');
    expect(JSON.stringify(attrs)).not.toContain('correct-horse');
  });

  it('sorts attributes by path', () => {
    const change: RawChange = {
      actions: ['update'],
      before: { zeta: 1, alpha: 1 },
      after: { zeta: 2, alpha: 2 },
    };
    const attrs = diffAttributes(change, 'update');
    expect(attrs.map((a) => a.path)).toEqual(['alpha', 'zeta']);
  });
});
