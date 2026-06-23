import { describe, it, expect } from 'vitest';
import { commentMarker, buildCommentBody, buildMultiCommentBody } from '../src/comment.js';
import type { ChangeModel } from '@burnmap/parser';

const model: ChangeModel = {
  meta: { repo: 'firebreak-io/infra', prNumber: 142, commitSha: 'a1b9c2f', terraformVersion: '1.12.1', generatedAt: '2026-05-29T00:00:00Z' },
  summary: { create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 },
  modules: [
    { module: 'module.data', types: [{ type: 'aws_db_instance', resources: [
      { address: 'module.data.aws_db_instance.main', module: 'module.data', type: 'aws_db_instance', name: 'main', provider: 'aws', action: 'replace', attrs: [], dangerScore: 100, dangerReasons: ['forces replacement: engine_version'] },
    ] }] },
    { module: '', types: [{ type: 'aws_security_group_rule', resources: [
      { address: 'aws_security_group_rule.legacy', module: '', type: 'aws_security_group_rule', name: 'legacy', provider: 'aws', action: 'delete', attrs: [], dangerScore: 70, dangerReasons: ['resource will be destroyed'] },
    ] }] },
  ],
  outputs: [],
};

describe('commentMarker', () => {
  it('is a stable HTML comment keyed by PR number', () => {
    expect(commentMarker(142)).toBe('<!-- burnmap:pr-142 -->');
  });
});

describe('buildCommentBody', () => {
  const body = buildCommentBody(model, 'https://s3.example/shot.png');

  it('starts with the sticky marker so it can be found and updated', () => {
    expect(body.startsWith('<!-- burnmap:pr-142 -->')).toBe(true);
  });

  it('embeds the image and a counts line (omitting zero counts)', () => {
    expect(body).toContain('![burnmap plan](https://s3.example/shot.png)');
    expect(body).toContain('**4 to add');
    expect(body).toContain('1 to destroy**');
    expect(body).not.toContain('to read'); // zero counts omitted
  });

  it('includes a collapsible plain-text manifest fallback with addresses and a danger marker', () => {
    expect(body).toContain('<details>');
    expect(body).toContain('module.data.aws_db_instance.main');
    expect(body).toContain('aws_security_group_rule.legacy');
    expect(body).toMatch(/⚠.*aws_db_instance\.main/); // high-risk flagged in the fallback
  });

  it('references repo and commit in the heading', () => {
    expect(body).toContain('firebreak-io/infra');
    expect(body).toContain('a1b9c2f');
  });
});

describe('buildMultiCommentBody', () => {
  it('starts with the plan marker and embeds one section per item', () => {
    const body = buildMultiCommentBody(7, 'o/r', 'abc', [
      { rel: 'a/plan.json', imageUrl: 'https://s/a.png' },
      { rel: 'b/plan.json', imageUrl: 'https://s/b.png', caption: 'B module' },
    ]);
    expect(body.startsWith('<!-- burnmap:pr-7 -->')).toBe(true);
    expect(body).toContain('a/plan.json');
    expect(body).toContain('![burnmap plan](https://s/a.png)');
    expect(body).toContain('B module');           // caption overrides the heading
    expect(body).toContain('![burnmap plan](https://s/b.png)');
  });
});
