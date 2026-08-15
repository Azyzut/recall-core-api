// Admin API - Get single user (company) details with discoveries
import { NextRequest, NextResponse } from 'next/server';
import db from '@recall/shared/db';
import type { AgencyType } from '@recall/shared/db';
import { getRequirementsByCompany } from '@recall/shared/services/requirements';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'recall-admin-2024';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Simple auth check via header or query param
  const authHeader = request.headers.get('x-admin-password');
  const { searchParams } = new URL(request.url);
  const authParam = searchParams.get('auth');

  if (!ADMIN_PASSWORD || (authHeader !== ADMIN_PASSWORD && authParam !== ADMIN_PASSWORD)) {
    return NextResponse.json(
      { error: 'Unauthorized. Admin access required.' },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    // Get company details
    const company = await db
      .selectFrom('companies')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!company) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get all discoveries for this company
    const discoveries = await db
      .selectFrom('discoveries')
      .selectAll()
      .where('companyId', '=', id)
      .orderBy('discoveredAt', 'desc')
      .execute();

    // Get user-added requirements from the requirements table
    const userAddedReqs = await getRequirementsByCompany(id);

    // Group user-added requirements by agency
    const userReqsByAgency: Record<AgencyType, typeof userAddedReqs> = {
      FDA: [],
      CPSC: [],
    };

    for (const req of userAddedReqs) {
      const agency = req.agency as AgencyType;
      if (userReqsByAgency[agency]) {
        userReqsByAgency[agency].push(req);
      }
    }

    // Build discoveries by merging AI-generated (from JSON blob) + user-added (from table)
    const parsedDiscoveries = discoveries.map((d) => {
      let metadata = null;
      try {
        metadata = typeof d.metadata === 'string'
          ? JSON.parse(d.metadata)
          : d.metadata;
      } catch {
        // Skip malformed JSON
      }

      // Get AI-generated requirements from JSON blob
      let aiRequirements: Record<string, unknown>[] = [];
      try {
        const parsed = typeof d.requirements === 'string'
          ? JSON.parse(d.requirements)
          : d.requirements;

        if (Array.isArray(parsed)) {
          aiRequirements = parsed.map((req: Record<string, unknown>, index: number) => ({
            ...req,
            id: req.id || `${d.id}-${index}`,
            createdBy: 'AI',
          }));
        }
      } catch {
        // Skip malformed JSON
      }

      // Get user-added requirements for this agency
      const userRequirements = userReqsByAgency[d.agency as AgencyType] || [];
      const mappedUserReqs = userRequirements.map(r => ({
        id: r.id,
        citation: r.citation,
        title: r.title,
        name: r.name,
        agency: r.agency,
        confidence: r.confidence,
        appliesTo: r.appliesTo,
        triggers: typeof r.triggers === 'string' ? JSON.parse(r.triggers) : r.triggers,
        excerpt: r.excerpt,
        status: r.status,
        priority: r.priority,
        notes: r.notes,
        createdBy: 'user',
        source: r.source,
      }));

      // Combine: AI requirements first, then user-added
      const allRequirements = [...aiRequirements, ...mappedUserReqs];

      return {
        id: d.id,
        agency: d.agency,
        requirements: allRequirements,
        discoveredAt: d.discoveredAt,
        metadata,
      };
    });

    // Parse websiteAnalysis
    let websiteAnalysis = null;
    try {
      websiteAnalysis = typeof company.websiteAnalysis === 'string'
        ? JSON.parse(company.websiteAnalysis)
        : company.websiteAnalysis;
    } catch {
      // Skip malformed JSON
    }

    return NextResponse.json({
      company: {
        ...company,
        websiteAnalysis,
      },
      discoveries: parsedDiscoveries,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user data' },
      { status: 500 }
    );
  }
}
