import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

export interface UpsertOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  marker: string;
  body: string;
}

export interface UpsertResult {
  action: 'created' | 'updated';
  id: number;
}

/** Create burnmap's comment, or update the existing one identified by the marker. */
export async function upsertStickyComment(opts: UpsertOptions): Promise<UpsertResult> {
  const { octokit, owner, repo, prNumber, marker, body } = opts;

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  // Match only burnmap's own comment: it always writes the marker as the first line.
  // `startsWith` (not `includes`) avoids matching an unrelated comment that merely
  // quotes the marker — editing someone else's comment would 403 and fail the action.
  const existing = comments.find((c) => typeof c.body === 'string' && c.body.startsWith(marker));

  if (existing) {
    try {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
      return { action: 'updated', id: existing.id };
    } catch {
      // Couldn't edit it (e.g. 403 on a comment we don't own) — fall back to creating ours.
    }
  }
  const created = await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  return { action: 'created', id: created.data.id };
}
