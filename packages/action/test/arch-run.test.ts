import { describe, it, expect, vi } from 'vitest';
import { runArch, type ArchRunDeps } from '../src/arch-run.js';

const plan = { terraform_version: '1.8.0', configuration: { root_module: { resources: [
  { address: 'aws_vpc.main', mode: 'managed', type: 'aws_vpc', name: 'main', expressions: {} },
] } } };

describe('runArch', () => {
  it('renders, uploads under the arch key, and upserts the arch comment', async () => {
    const deps: ArchRunDeps = {
      readPlanJson: vi.fn(() => plan),
      archToPng: vi.fn(async (_p, _m, out) => out),
      readPng: vi.fn(() => Buffer.from('PNG')),
      uploadAndPresign: vi.fn(async () => 'https://signed/arch.png'),
      upsertStickyComment: vi.fn(async () => ({ action: 'created' as const, id: 99 })),
    };
    const result = await runArch(deps, {
      planJsonPath: 'plan.json', bucket: 'b', ttlSeconds: 60,
      repo: 'o/r', owner: 'o', repoName: 'r', prNumber: 7, sha: 'abc',
      outPng: '/tmp/x-arch.png',
    });
    expect(result.imageUrl).toBe('https://signed/arch.png');
    expect(result.commentId).toBe(99);
    const upload = (deps.uploadAndPresign as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(upload.key).toBe('burnmap/o/r/7/abc-arch.png');
    const comment = (deps.upsertStickyComment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(comment.marker).toBe('<!-- burnmap:arch:pr-7 -->');
  });

  it('forwards changes to archToPng when provided (both mode)', async () => {
    const changes = { meta: {}, summary: {}, modules: [], outputs: [] } as unknown as import('@burnmap/parser').ChangeModel;
    const archToPng = vi.fn(async (_p: unknown, _m: unknown, out: string) => out);
    const deps: ArchRunDeps = {
      readPlanJson: vi.fn(() => plan),
      archToPng,
      readPng: vi.fn(() => Buffer.from('PNG')),
      uploadAndPresign: vi.fn(async () => 'https://signed/arch.png'),
      upsertStickyComment: vi.fn(async () => ({ action: 'created' as const, id: 1 })),
    };
    await runArch(deps, {
      planJsonPath: 'plan.json', bucket: 'b', ttlSeconds: 60,
      repo: 'o/r', owner: 'o', repoName: 'r', prNumber: 7, sha: 'abc',
      outPng: '/tmp/x-arch.png', changes,
    });
    expect(archToPng.mock.calls[0]![3]).toBe(changes);
  });
});
