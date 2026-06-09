import { describe, it, expect } from 'vitest';
import { archCommentMarker, buildArchCommentBody } from '../src/arch-comment.js';
import { s3Key } from '../src/s3.js';

describe('arch comment', () => {
  it('uses a marker distinct from the plan comment', () => {
    expect(archCommentMarker(7)).toBe('<!-- burnmap:arch:pr-7 -->');
  });

  it('embeds the image and starts with the marker', () => {
    const body = buildArchCommentBody(
      { repo: 'o/r', prNumber: 7, commitSha: 'deadbeef', terraformVersion: '1.8.0', generatedAt: 'now' },
      'https://signed.example/arch.png',
    );
    expect(body.startsWith('<!-- burnmap:arch:pr-7 -->')).toBe(true);
    expect(body).toContain('![burnmap architecture](https://signed.example/arch.png)');
    expect(body).toContain('o/r');
  });

  it('s3Key separates arch from plan objects', () => {
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc', kind: 'arch' }))
      .toBe('burnmap/o/r/7/abc-arch.png');
    expect(s3Key({ repo: 'o/r', prNumber: 7, sha: 'abc' }))
      .toBe('burnmap/o/r/7/abc.png');
  });
});
