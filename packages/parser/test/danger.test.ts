import { describe, it, expect } from 'vitest';
import { scoreDanger } from '../src/danger.js';
import type { AttrChange } from '../src/types.js';

const noAttrs: AttrChange[] = [];

describe('scoreDanger', () => {
  it('scores a create low with no reasons', () => {
    const r = scoreDanger('aws_subnet', 'create', noAttrs);
    expect(r.score).toBe(10);
    expect(r.reasons).toEqual([]);
  });

  it('scores a destroy of a stateful resource highest', () => {
    const r = scoreDanger('aws_db_instance', 'delete', noAttrs);
    expect(r.score).toBe(100); // 70 base + 30 stateful
    expect(r.reasons[0]).toMatch(/not recoverable/);
  });

  it('scores a plain (non-stateful) destroy with a generic reason', () => {
    const r = scoreDanger('aws_security_group_rule', 'delete', noAttrs);
    expect(r.score).toBe(70);
    expect(r.reasons[0]).toMatch(/will be destroyed/);
  });

  it('adds a force-replacement reason listing the paths', () => {
    const attrs: AttrChange[] = [
      { path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: true },
    ];
    const r = scoreDanger('aws_db_instance', 'replace', attrs);
    expect(r.score).toBe(100); // 60 base + 30 stateful + 10 forced
    expect(r.reasons.some((x) => x.includes('forces replacement: engine_version'))).toBe(true);
  });

  it('de-escalates cosmetic tag-only updates', () => {
    const attrs: AttrChange[] = [
      { path: 'tags.Version', before: '1.4.0', after: '1.5.0', sensitive: false, unknown: false, forcesReplacement: false },
    ];
    const r = scoreDanger('aws_ecs_service', 'update', attrs);
    expect(r.score).toBe(5);
    expect(r.reasons).toEqual([]);
  });

  it('keeps a normal update at base score', () => {
    const attrs: AttrChange[] = [
      { path: 'instance_type', before: 't3.micro', after: 't3.small', sensitive: false, unknown: false, forcesReplacement: false },
    ];
    const r = scoreDanger('aws_instance', 'update', attrs);
    expect(r.score).toBe(20);
  });
});
