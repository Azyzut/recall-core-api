// S3 service for presigned URL generation (upload + download)

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.S3_BUCKET || 'ehs-documents-219826710834';
const REGION = process.env.AWS_REGION || 'us-west-2';

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
    Bucket: BUCKET,
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
    Bucket: BUCKET,
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
    Bucket: BUCKET,
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
