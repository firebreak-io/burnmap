import { describe, it, expect, vi } from 'vitest';
import { upsertStickyComment } from '../src/github.js';

function fakeOctokit(existing: Array<{ id: number; body: string }>) {
  return {
    paginate: vi.fn(async () => existing),
    rest: {
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(async () => ({ data: { id: 999 } })),
        updateComment: vi.fn(async () => ({ data: { id: existing[0]?.id ?? 0 } })),
      },
    },
  };
}

const base = { owner: 'firebreak-io', repo: 'infra', prNumber: 142, marker: '<!-- burnmap:pr-142 -->' };

describe('upsertStickyComment', () => {
  it('creates a comment when none with the marker exists', async () => {
    const octokit = fakeOctokit([{ id: 1, body: 'unrelated comment' }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nhi' });
    expect(res.action).toBe('created');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing marked comment in place', async () => {
    const octokit = fakeOctokit([{ id: 77, body: '<!-- burnmap:pr-142 -->\nold' }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nnew' });
    expect(res.action).toBe('updated');
    expect(res.id).toBe(77);
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('skips comments with a null body (GitHub returns body:null for empty comments) and creates', async () => {
    const octokit = fakeOctokit([{ id: 2, body: null as unknown as string }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nhi' });
    expect(res.action).toBe('created');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });

  it('only matches a comment whose FIRST line is the marker (not one that merely quotes it)', async () => {
    const octokit = fakeOctokit([{ id: 9, body: 'see this: <!-- burnmap:pr-142 -->' }]);
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nhi' });
    expect(res.action).toBe('created');
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('falls back to creating when updateComment fails (e.g. 403 on a comment we do not own)', async () => {
    const octokit = fakeOctokit([{ id: 88, body: '<!-- burnmap:pr-142 -->\ntheirs' }]);
    octokit.rest.issues.updateComment = vi.fn(async () => { throw new Error('403'); });
    const res = await upsertStickyComment({ octokit: octokit as never, ...base, body: '<!-- burnmap:pr-142 -->\nmine' });
    expect(res.action).toBe('created');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });
});
