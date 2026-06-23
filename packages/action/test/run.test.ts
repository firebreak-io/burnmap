import { describe, it, expect, vi } from 'vitest';
import { run } from '../src/run.js';
import { renderPlanImage } from '../src/run.js';

function deps() {
  return {
    readPlanJson: vi.fn(() => ({ terraform_version: '1.12.1', resource_changes: [], output_changes: {} })),
    writeShotHtml: vi.fn(() => '/web/dist/__burnmap_shot.html'),
    cleanupShotHtml: vi.fn(),
    capture: vi.fn(async () => '/tmp/shot.png'),
    readPng: vi.fn(() => Buffer.from('PNG')),
    uploadAndPresign: vi.fn(async () => 'https://signed.example/x.png'),
    upsertStickyComment: vi.fn(async () => ({ action: 'created' as const, id: 5 })),
  };
}

const inputs = {
  planJsonPath: '/p/plan.json',
  webDist: '/web/dist',
  bucket: 'burnmap-shots',
  ttlSeconds: 3600,
  repo: 'firebreak-io/infra',
  owner: 'firebreak-io',
  repoName: 'infra',
  prNumber: 142,
  sha: 'a1b9c2f',
  outPng: '/tmp/shot.png',
};

describe('run', () => {
  it('parses → shoots → uploads → upserts a comment with the presigned url', async () => {
    const d = deps();
    const res = await run(d as never, inputs);

    expect(d.writeShotHtml).toHaveBeenCalledWith('/web/dist', expect.objectContaining({ meta: expect.any(Object) }));
    expect(d.capture).toHaveBeenCalledWith(expect.objectContaining({ shotHtmlPath: '/web/dist/__burnmap_shot.html', outPath: '/tmp/shot.png' }));
    expect(d.uploadAndPresign).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'burnmap-shots', key: 'burnmap/firebreak-io/infra/142/a1b9c2f.png' }));
    const commentArgs = d.upsertStickyComment.mock.calls[0]![0];
    expect(commentArgs.body).toContain('https://signed.example/x.png');
    expect(commentArgs.marker).toBe('<!-- burnmap:pr-142 -->');
    expect(res.commentAction).toBe('created');
  });

  it('always cleans up the temp shot HTML, even if capture throws', async () => {
    const d = deps();
    d.capture = vi.fn(async () => { throw new Error('boom'); });
    await expect(run(d as never, inputs)).rejects.toThrow('boom');
    expect(d.cleanupShotHtml).toHaveBeenCalledWith('/web/dist');
  });
});

describe('renderPlanImage', () => {
  it('renders + uploads with a slugged key and does NOT comment', async () => {
    const d = deps();
    const res = await renderPlanImage(d as never, { ...inputs, slug: 'deadbe' });
    expect(d.uploadAndPresign).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'burnmap/firebreak-io/infra/142/a1b9c2f-deadbe.png' }),
    );
    expect(d.upsertStickyComment).not.toHaveBeenCalled();
    expect(res.imageUrl).toBe('https://signed.example/x.png');
    expect(res.model.meta).toBeDefined();
  });
});
