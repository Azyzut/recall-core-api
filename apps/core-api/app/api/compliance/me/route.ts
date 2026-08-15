// API Route for fetching compliance data for authenticated user
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findDiscoveriesByEmail, findDiscoveriesWithCompanyById } from '@recall/shared/services/discovery';
import { buildComplianceResponse } from '@/lib/services/compliance-builder';
import db from '@recall/shared/db';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    // First check if user has a linked companyId
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    let result;

    if (user?.companyId) {
      result = await findDiscoveriesWithCompanyById(user.companyId);
    } else if (session.user.email) {
      result = await findDiscoveriesByEmail(session.user.email);
    }

    if (!result || result.discoveries.length === 0) {
      return NextResponse.json(
        { error: 'No compliance data found. Run a discovery first.' },
        { status: 404 }
      );
    }

    const response = await buildComplianceResponse(result.company, result.discoveries);
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[API] Compliance fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch compliance data' },
      { status: 500 }
    );
  }
}
