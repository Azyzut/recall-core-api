// S3 service for presigned URL generation (upload + download)

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// No fallback bucket. The previous default, 'ehs-documents-219826710834', named a
// real account's bucket in a repository attendees copy: every unconfigured
// deployment would have aimed presigned URLs at it.
//
// The workshop does not provision S3, so document upload is simply unavailable.
// That is fine — but it has to FAIL CLEARLY, because the UI does expose upload
// (drag-and-drop on /matrix/requirements/[id]). Silently pointing at a bucket
// nobody owns produces an opaque AWS error; this produces a sentence.
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'us-east-1';

/** Whether document storage is configured for this deployment. */
export function isStorageConfigured(): boolean {
  return !!BUCKET && BUCKET !== 'unset';
}

function requireBucket(): string {
  if (!isStorageConfigured()) {
    throw new Error(
      'Document storage is not configured for this deployment. Set S3_BUCKET to enable uploads.',
    );
  }
  return BUCKET as string;
}

const s3Client = new S3Client({
  region: REGION,
  // Uses EC2 instance role credentials, or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
});

/**
 * Generate a presigned PUT URL for uploading a file directly to S3
 */
export async function getUploadUrl(
  s3Key: string,
  contentType: string,
  expiresIn = 300 // 5 minutes
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: requireBucket(),
    Key: s3Key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Generate a presigned GET URL for downloading a file from S3
 */
export async function getDownloadUrl(
  s3Key: string,
  filename: string,
  expiresIn = 3600 // 1 hour
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: requireBucket(),
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete a file from S3
 */
export async function deleteFromS3(s3Key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: requireBucket(),
    Key: s3Key,
  });
  await s3Client.send(command);
}

/**
 * Build S3 key for a requirement document
 */
export function buildS3Key(
  companyId: string,
  requirementId: string,
  fileId: string,
  filename: string
): string {
  return `companies/${companyId}/requirements/${requirementId}/${fileId}-${filename}`;
}
