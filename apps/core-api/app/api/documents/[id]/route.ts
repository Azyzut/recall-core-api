// API endpoint for single document operations
// GET: Get presigned download URL
// DELETE: Delete document + S3 object

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import db from '@recall/shared/db';
import { getDocumentById, deleteDocument } from '@recall/shared/services/documents';
import { getDownloadUrl, deleteFromS3 , isStorageConfigured} from '@/lib/services/s3';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/[id]
 * Get a presigned download URL for the document
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: 'Document storage is not configured for this deployment.' },
      { status: 503 }
    );
  }

  try {
    const { id } = await context.params;
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const document = await getDocumentById(id);
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Verify access
    if (session?.user?.id) {
      const user = await db
        .selectFrom('users')
        .select(['companyId'])
        .where('id', '=', session.user.id)
        .executeTakeFirst();
      if (!user || user.companyId !== document.companyId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    } else if (token) {
      const company = await db
        .selectFrom('companies')
        .select(['id'])
        .where('accessToken', '=', token)
        .executeTakeFirst();
      if (!company || company.id !== document.companyId) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const downloadUrl = await getDownloadUrl(document.s3Key, document.filename);

    return NextResponse.json({
      success: true,
      downloadUrl,
      document,
    });
  } catch (error) {
    console.error('[API] Document GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get download URL' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete document record and S3 object
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: 'Document storage is not configured for this deployment.' },
      { status: 503 }
    );
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required to delete files' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const document = await getDocumentById(id);
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user || user.companyId !== document.companyId) {
      return NextResponse.json(
        { error: 'You do not have access to this document' },
        { status: 403 }
      );
    }

    // Delete from S3 first, then DB
    try {
      await deleteFromS3(document.s3Key);
    } catch {
      console.warn(`[API] Failed to delete S3 object ${document.s3Key}, continuing with DB delete`);
    }

    await deleteDocument(id);

    return NextResponse.json({
      success: true,
      message: 'Document deleted',
    });
  } catch (error) {
    console.error('[API] Document DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}
