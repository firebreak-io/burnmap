import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3KeyParts {
  repo: string;      // "owner/repo"
  prNumber: number;
  sha: string;
}

/** Stable, per-commit object key: burnmap/<owner>/<repo>/<pr>/<sha>.png */
export function s3Key({ repo, prNumber, sha }: S3KeyParts): string {
  return `burnmap/${repo}/${prNumber}/${sha}.png`;
}

export interface UploadOptions {
  client: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  ttlSeconds: number;
}

/** Upload the PNG to a private bucket and return a short-TTL presigned GET URL. */
export async function uploadAndPresign(opts: UploadOptions): Promise<string> {
  const { client, bucket, key, body, ttlSeconds } = opts;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'image/png',
  }));
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}
