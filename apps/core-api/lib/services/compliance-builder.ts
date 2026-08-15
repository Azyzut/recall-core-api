// Shared logic for building compliance API responses
// Handles auto-migration of AI requirements from JSON blob → requirements table

import {
  getRequirementsByCompany,
  migrateCompanyDiscoveries,
} from '@recall/shared/services/requirements';
import type { Discovery } from '@recall/shared/services/discovery';
import type { CompanyTable, AgencyType } from '@recall/shared/db';
import type { Selectable } from 'kysely';

type Company = Selectable<CompanyTable>;

/**
 * Build the compliance response for both token-based and authenticated endpoints.
 * Auto-migrates AI requirements into the requirements table on first load,
 * then serves exclusively from the table so all IDs are real UUIDs.
 */
export async function buildComplianceResponse(
  company: Company,
  discoveries: Discovery[]
) {
  // Auto-migrate: always attempt migration for each discovery.
  // migrateDiscoveryRequirements() is idempotent — it skips discoveries
  // that already have rows in the requirements table.
  try {
    const migrated = await migrateCompanyDiscoveries(company.id);
    if (migrated > 0) {
      console.log(`[Compliance] Auto-migrated ${migrated} requirements for company ${company.id}`);
    }
  } catch (err) {
    console.error(`[Compliance] Migration failed for company ${company.id}:`, err);
    // Fall through — we'll serve from whatever is available
  }

  // Fetch all requirements from the table (now includes migrated AI reqs)
  const allReqs = await getRequirementsByCompany(company.id);

  // Group requirements by agency
  const reqsByAgency: Record<string, typeof allReqs> = {};
  for (const req of allReqs) {
    const agency = req.agency;
    if (!reqsByAgency[agency]) reqsByAgency[agency] = [];
    reqsByAgency[agency].push(req);
  }

  // Helper to map requirement rows to frontend shape
  const mapReq = (r: typeof allReqs[number]) => ({
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
    source: r.source,
    dueDate: r.dueDate,
    calendarTracking: r.calendarTracking,
    frequency: r.frequency,
    possibleObligations: typeof r.possibleObligations === 'string'
      ? JSON.parse(r.possibleObligations)
      : r.possibleObligations || [],
  });

  // Track which agencies are covered by discoveries
  const discoveryAgencies = new Set(discoveries.map(d => d.agency));

  // Build discovery objects for the frontend
  const builtDiscoveries = discoveries.map((d: Discovery) => {
    // Use requirements from the table for this agency
    const tableReqs = reqsByAgency[d.agency as AgencyType] || [];

    // Parse metadata to get discovery status
    let metadata: Record<string, unknown> = {};
    try {
      if (typeof d.metadata === 'string') {
        metadata = JSON.parse(d.metadata);
      } else if (d.metadata && typeof d.metadata === 'object') {
        metadata = d.metadata as Record<string, unknown>;
      }
    } catch {
      // Ignore parse errors
    }

    return {
      id: d.id,
      agency: d.agency,
      requirements: tableReqs.map(mapReq),
      discoveredAt: d.discoveredAt,
      status: (metadata.status as string) || 'complete',
    };
  });

  // Add virtual discovery entries for agencies that have requirements
  // but no discovery run (e.g., agent-created EPA requirements)
  for (const [agency, reqs] of Object.entries(reqsByAgency)) {
    if (!discoveryAgencies.has(agency as AgencyType) && reqs.length > 0) {
      builtDiscoveries.push({
        id: `agent-${agency.toLowerCase()}`,
        agency: agency as AgencyType,
        requirements: reqs.map(mapReq),
        discoveredAt: reqs[0].createdAt,
        status: 'complete',
      });
    }
  }

  // Check if any discovery is still in progress
  const discoveryInProgress = builtDiscoveries.some(
    (d: { status?: string }) => d.status === 'in_progress'
  );

  return {
    success: true,
    company: {
      id: company.id,
      name: company.companyName,
      website: company.website,
      naicsCode: company.naicsCode,
      employeeCount: company.employeeCount,
      state: company.state,
    },
    discoveries: builtDiscoveries,
    discoveryInProgress,
  };
}
