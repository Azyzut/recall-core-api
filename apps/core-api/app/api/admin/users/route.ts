// Admin API - List all users (companies) with their discovery stats
import { NextRequest, NextResponse } from 'next/server';
import db from '@recall/shared/db';
import { sql } from 'kysely';

// No fallback. This repository is a template attendees copy, so a hardcoded
// default is a PUBLISHED password on an app reachable at a public hostname — and
// the previous default was a guessable constant, which was exactly that.
//
// Unset (or the `unset` sentinel, which is how Unify stores "not configured yet")
// means these endpoints refuse every request. Failing closed is correct for an
// admin surface: an endpoint that accepts a credential anyone can read on GitHub
// is worse than one that is switched off.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_ENABLED = !!ADMIN_PASSWORD && ADMIN_PASSWORD !== 'unset';

export async function GET(request: NextRequest) {
  // Simple auth check via header or query param
  const authHeader = request.headers.get('x-admin-password');
  const { searchParams } = new URL(request.url);
  const authParam = searchParams.get('auth');

  if (!ADMIN_ENABLED) {
    return NextResponse.json(
      { error: 'Admin endpoints are disabled. Set ADMIN_PASSWORD to enable them.' },
      { status: 503 }
    );
  }

  if (authHeader !== ADMIN_PASSWORD && authParam !== ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: 'Unauthorized. Admin access required.' },
      { status: 401 }
    );
  }

  try {
    // Get all companies with discovery and requirement counts in a single query
    // This replaces the N+1 query pattern (was: 1 query for companies + N queries for requirements)
    const usersWithRequirements = await db
      .selectFrom('companies')
      .leftJoin('discoveries', 'companies.id', 'discoveries.companyId')
      .leftJoin('requirements', 'companies.id', 'requirements.companyId')
      .select([
        'companies.id',
        'companies.companyName',
        'companies.website',
        'companies.normalizedWebsite',
        'companies.naicsCode',
        'companies.employeeCount',
        'companies.state',
        'companies.contactEmail',
        'companies.firstDiscoveredAt',
        sql<number>`COUNT(DISTINCT discoveries.id)::int`.as('discoveryCount'),
        sql<number>`COUNT(DISTINCT requirements.id)::int`.as('totalRequirements'),
      ])
      .groupBy('companies.id')
      .orderBy('companies.firstDiscoveredAt', 'desc')
      .execute();

    // Calculate stats
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const totalDiscoveries = await db
      .selectFrom('discoveries')
      .select(sql<number>`COUNT(*)`.as('count'))
      .executeTakeFirst();

    const usersThisWeek = usersWithRequirements.filter(
      (c) => new Date(c.firstDiscoveredAt) >= oneWeekAgo
    ).length;

    const totalRequirements = usersWithRequirements.reduce(
      (sum, u) => sum + u.totalRequirements,
      0
    );

    return NextResponse.json({
      users: usersWithRequirements,
      stats: {
        totalUsers: usersWithRequirements.length,
        totalDiscoveries: Number(totalDiscoveries?.count || 0),
        totalRequirements,
        usersThisWeek,
      },
    });
  } catch (error) {
    console.error('[Admin API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin data' },
      { status: 500 }
    );
  }
}
