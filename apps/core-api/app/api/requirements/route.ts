// API endpoint for requirements CRUD
// GET: List requirements for a company (auth required)
// POST: Create a new requirement (auth required)

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import db from '@recall/shared/db';
import {
  getRequirementsByCompany,
  getComplianceStats,
  createRequirement,
  bulkUpdateSortOrder,
  type RequirementFilters,
  type CreateRequirementInput,
  type RequirementStatus,
  type RequirementPriorityType,
} from '@recall/shared/services/requirements';
import type { AgencyType } from '@recall/shared/db';

/**
 * GET /api/requirements
 * Query params:
 *   - companyId (required): Company to get requirements for
 *   - agency (optional): Filter by agency (FDA, CPSC)
 *   - status (optional): Filter by status
 *   - priority (optional): Filter by priority
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json(
        { error: 'companyId query parameter is required' },
        { status: 400 }
      );
    }

    // Verify user owns this company
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user || user.companyId !== companyId) {
      return NextResponse.json(
        { error: 'You do not have access to this company' },
        { status: 403 }
      );
    }

    // Build filters
    const filters: RequirementFilters = {};
    const agency = searchParams.get('agency');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    if (agency && ['FDA', 'CPSC'].includes(agency)) {
      filters.agency = agency as AgencyType;
    }

    if (status && ['pending', 'in_progress', 'compliant', 'non_compliant', 'n_a'].includes(status)) {
      filters.status = status as RequirementStatus;
    }

    if (priority && ['high', 'medium', 'low'].includes(priority)) {
      filters.priority = priority as RequirementPriorityType;
    }

    // Get requirements and stats
    const [requirements, stats] = await Promise.all([
      getRequirementsByCompany(companyId, filters),
      getComplianceStats(companyId),
    ]);

    return NextResponse.json({
      success: true,
      requirements,
      stats,
    });
  } catch (error) {
    console.error('[API] Requirements GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requirements' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/requirements
 * Create a new custom requirement
 * Body: { companyId, citation, title, agency, description?, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { companyId, discoveryId, citation, title, agency, description, notes, priority } = body;

    // Validate required fields
    if (!companyId) {
      return NextResponse.json(
        { error: 'companyId is required' },
        { status: 400 }
      );
    }

    if (!citation) {
      return NextResponse.json(
        { error: 'citation is required' },
        { status: 400 }
      );
    }

    if (!title) {
      return NextResponse.json(
        { error: 'title is required' },
        { status: 400 }
      );
    }

    if (!agency || !['FDA', 'CPSC'].includes(agency)) {
      return NextResponse.json(
        { error: 'agency must be FDA or CPSC' },
        { status: 400 }
      );
    }

    // Verify user owns this company
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user || user.companyId !== companyId) {
      return NextResponse.json(
        { error: 'You do not have access to this company' },
        { status: 403 }
      );
    }

    // If no discoveryId provided, try to get the latest discovery for this company
    let finalDiscoveryId = discoveryId;
    if (!finalDiscoveryId) {
      const latestDiscovery = await db
        .selectFrom('discoveries')
        .select('id')
        .where('companyId', '=', companyId)
        .orderBy('discoveredAt', 'desc')
        .executeTakeFirst();

      if (!latestDiscovery) {
        return NextResponse.json(
          { error: 'No discovery found for this company. Run a discovery first.' },
          { status: 400 }
        );
      }
      finalDiscoveryId = latestDiscovery.id;
    }

    const input: CreateRequirementInput = {
      discoveryId: finalDiscoveryId,
      companyId,
      citation,
      title,
      agency: agency as AgencyType,
      confidence: 100, // User-added requirements are 100% confidence
      appliesTo: description || null,
      source: 'user_added',
      priority: priority || 'medium',
      notes: notes || null,
    };

    const requirement = await createRequirement(input);

    return NextResponse.json({
      success: true,
      requirement,
    });
  } catch (error) {
    console.error('[API] Requirements POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create requirement' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/requirements
 * Bulk update sortOrder for drag-to-reorder
 * Body: { reorder: [{ id: string, sortOrder: number }, ...] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { reorder } = body;

    if (!Array.isArray(reorder) || reorder.length === 0) {
      return NextResponse.json(
        { error: 'reorder must be a non-empty array of { id, sortOrder }' },
        { status: 400 }
      );
    }

    // Validate each entry
    for (const item of reorder) {
      if (!item.id || typeof item.sortOrder !== 'number' || item.sortOrder < 0) {
        return NextResponse.json(
          { error: 'Each reorder item must have a valid id and non-negative sortOrder' },
          { status: 400 }
        );
      }
    }

    // Verify user has a company
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user?.companyId) {
      return NextResponse.json(
        { error: 'No company associated with your account' },
        { status: 403 }
      );
    }

    // Verify all requirement IDs belong to the user's company
    const reqIds = reorder.map((r: { id: string }) => r.id);
    const ownedReqs = await db
      .selectFrom('requirements')
      .select('id')
      .where('id', 'in', reqIds)
      .where('companyId', '=', user.companyId)
      .execute();

    if (ownedReqs.length !== reqIds.length) {
      return NextResponse.json(
        { error: 'Some requirements do not belong to your company' },
        { status: 403 }
      );
    }

    await bulkUpdateSortOrder(reorder);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Requirements PATCH (reorder) error:', error);
    return NextResponse.json(
      { error: 'Failed to reorder requirements' },
      { status: 500 }
    );
  }
}
