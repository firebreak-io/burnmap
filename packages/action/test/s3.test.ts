import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Key, uploadAndPresign } from '../src/s3.js';

// Mock the presigner to a deterministic URL.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/shot.png?sig=abc'),
}));

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('s3Key', () => {
  it('namespaces by owner/repo/pr/sha', () => {
    expect(s3Key({ repo: 'firebreak-io/infra', prNumber: 142, sha: 'a1b9c2f' }))
      .toBe('burnmap/firebreak-io/infra/142/a1b9c2f.png');
  });
});

describe('uploadAndPresign', () => {
  it('uploads the PNG (private) and returns a presigned GET url', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const client = new S3Client({ region: 'us-east-1' });
    const url = await uploadAndPresign({
      client, bucket: 'burnmap-shots', key: 'burnmap/x/y/1/s.png',
      body: Buffer.from('PNGDATA'), ttlSeconds: 3600,
    });
    expect(url).toBe('https://signed.example/shot.png?sig=abc');
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]!.input).toMatchObject({
      Bucket: 'burnmap-shots',
      Key: 'burnmap/x/y/1/s.png',
      ContentType: 'image/png',
    });
    // the presigned GET must target the same bucket/key with the requested TTL
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: { Bucket: 'burnmap-shots', Key: 'burnmap/x/y/1/s.png' } }),
      { expiresIn: 3600 },
    );
  });

  it('presigns with the main client when no presignClient is given', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const client = new S3Client({ region: 'us-east-1' });
    await uploadAndPresign({
      client, bucket: 'b', key: 'k', body: Buffer.from('x'), ttlSeconds: 3600,
    });
    expect(getSignedUrl).toHaveBeenCalledWith(client, expect.anything(), { expiresIn: 3600 });
  });

  it('presigns with a dedicated presignClient when provided (upload still via the main client)', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const client = new S3Client({ region: 'us-east-1' });
    const presignClient = new S3Client({ region: 'us-east-1' });
    // 7-day TTL is only viable with the presigner's long-lived static creds.
    const url = await uploadAndPresign({
      client, presignClient, bucket: 'burnmap-shots', key: 'burnmap/x/y/1/s.png',
      body: Buffer.from('PNGDATA'), ttlSeconds: 604800,
    });
    expect(url).toBe('https://signed.example/shot.png?sig=abc');
    // upload goes through the main (OIDC) client
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    // ...but the GET URL is signed by the dedicated presign client, not the main one
    expect(getSignedUrl).toHaveBeenCalledWith(
      presignClient,
      expect.objectContaining({ input: { Bucket: 'burnmap-shots', Key: 'burnmap/x/y/1/s.png' } }),
      { expiresIn: 604800 },
    );
  });
});
