import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3KeyParts {
  repo: string;      // "owner/repo"
  prNumber: number;
  sha: string;
  kind?: 'plan' | 'arch';
}

/** Stable, per-commit object key: burnmap/<owner>/<repo>/<pr>/<sha>[-arch].png */
export function s3Key({ repo, prNumber, sha, kind = 'plan' }: S3KeyParts): string {
  const suffix = kind === 'arch' ? '-arch' : '';
  return `burnmap/${repo}/${prNumber}/${sha}${suffix}.png`;
}

export interface UploadOptions {
  client: S3Client;
  /** Optional client used ONLY to presign the GET URL. Supply one backed by
   *  long-lived (non-session) credentials to lift the presigned-URL lifetime to
   *  the S3 SigV4 max of 7 days — temporary session creds (e.g. an OIDC role)
   *  cap it at their session length. Defaults to `client`. */
  presignClient?: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  ttlSeconds: number;
}

/** Upload the PNG to a private bucket and return a presigned GET URL. */
export async function uploadAndPresign(opts: UploadOptions): Promise<string> {
  const { client, presignClient, bucket, key, body, ttlSeconds } = opts;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'image/png',
  }));
  return getSignedUrl(
    presignClient ?? client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );
}
