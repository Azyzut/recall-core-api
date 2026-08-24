// API Route for fetching compliance data for authenticated user
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findDiscoveriesByEmail, findDiscoveriesWithCompanyById } from '@recall/shared/services/discovery';
import { buildComplianceResponse } from '@/lib/services/compliance-builder';
import db from '@recall/shared/db';
import { isServiceKilled, MAINTENANCE_MESSAGE } from '@/lib/fm-kill-switch';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  // The kill switch has to be enforced here, not only at sign-in: this is what every
  // authenticated page load fetches, so gating it is what makes a refresh land in the
  // same place rather than sailing past the switch.
  if (await isServiceKilled(session.user.id, session.user.email || '')) {
    return NextResponse.json({ error: MAINTENANCE_MESSAGE }, { status: 503 });
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
