// API endpoint for documents
// POST: Create document record + get presigned upload URL
// GET: List documents for a requirement

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import db from '@recall/shared/db';
import { createDocument, getDocumentsByRequirement, getFileType } from '@recall/shared/services/documents';
import { getRequirementById } from '@recall/shared/services/requirements';
import { getUploadUrl, buildS3Key } from '@/lib/services/s3';
import { randomUUID } from 'crypto';

/**
 * POST /api/documents
 * Create a document record and return a presigned S3 upload URL
 * Body: { requirementId, filename, contentType, fileSizeBytes }
 */
export async function POST(request: NextRequest) {

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required to upload files' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { requirementId, filename, contentType, fileSizeBytes } = body;

    if (!requirementId || !filename || !contentType || !fileSizeBytes) {
      return NextResponse.json(
        { error: 'requirementId, filename, contentType, and fileSizeBytes are required' },
        { status: 400 }
      );
    }

    // Validate file size (max 50MB)
    if (fileSizeBytes > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size exceeds 50MB limit' },
        { status: 400 }
      );
    }

    // Verify requirement exists and user owns it
    const requirement = await getRequirementById(requirementId);
    if (!requirement) {
      return NextResponse.json(
        { error: 'Requirement not found' },
        { status: 404 }
      );
    }

    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user || user.companyId !== requirement.companyId) {
      return NextResponse.json(
        { error: 'You do not have access to this requirement' },
        { status: 403 }
      );
    }

    // Build S3 key and create document record
    const fileId = randomUUID();
    const s3Key = buildS3Key(requirement.companyId, requirementId, fileId, filename);
    const fileType = getFileType(filename);

    const document = await createDocument({
      userId: session.user.id,
      companyId: requirement.companyId,
      requirementId,
      filename,
      fileType,
      s3Key,
      fileSizeBytes,
    });

    // Generate presigned upload URL
    const uploadUrl = await getUploadUrl(s3Key, contentType);

    return NextResponse.json({
      success: true,
      document,
      uploadUrl,
    });
  } catch (error) {
    console.error('[API] Document POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create document' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/documents?requirementId=xxx
 * List all documents for a requirement
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const requirementId = searchParams.get('requirementId');
    const token = searchParams.get('token');

    if (!requirementId) {
      return NextResponse.json(
        { error: 'requirementId query parameter is required' },
        { status: 400 }
      );
    }

    // Verify access
    const requirement = await getRequirementById(requirementId);
    if (!requirement) {
      return NextResponse.json(
        { error: 'Requirement not found' },
        { status: 404 }
      );
    }

    if (session?.user?.id) {
      const user = await db
        .selectFrom('users')
        .select(['companyId'])
        .where('id', '=', session.user.id)
        .executeTakeFirst();
      if (!user || user.companyId !== requirement.companyId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    } else if (token) {
      const company = await db
        .selectFrom('companies')
        .select(['id'])
        .where('accessToken', '=', token)
        .executeTakeFirst();
      if (!company || company.id !== requirement.companyId) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const documents = await getDocumentsByRequirement(requirementId);

    return NextResponse.json({
      success: true,
      documents,
    });
  } catch (error) {
    console.error('[API] Documents GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list documents' },
      { status: 500 }
    );
  }
}
