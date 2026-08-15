// API endpoint for single requirement operations
// GET: Get a single requirement by ID
// PATCH: Update status/priority/notes
// DELETE: Delete a requirement

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import db from '@recall/shared/db';
import {
  getRequirementById,
  updateRequirement,
  deleteRequirement,
  type UpdateRequirementInput,
  type RequirementStatus,
  type RequirementPriorityType,
} from '@recall/shared/services/requirements';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/requirements/[id]
 * Get a single requirement by ID
 * Supports both authenticated users and anonymous token-based access
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const requirement = await getRequirementById(id);
    if (!requirement) {
      return NextResponse.json(
        { error: 'Requirement not found' },
        { status: 404 }
      );
    }

    // Auth check: either session or valid access token
    const session = await auth();
    if (session?.user?.id) {
      // Authenticated: verify user owns the company
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
    } else if (token) {
      // Anonymous: verify token belongs to the same company
      const company = await db
        .selectFrom('companies')
        .select(['id'])
        .where('accessToken', '=', token)
        .executeTakeFirst();

      if (!company || company.id !== requirement.companyId) {
        return NextResponse.json(
          { error: 'Invalid access token for this requirement' },
          { status: 403 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse JSON fields for the response
    const parsed = {
      ...requirement,
      triggers: typeof requirement.triggers === 'string'
        ? JSON.parse(requirement.triggers)
        : requirement.triggers || [],
      regulationSummary: typeof requirement.regulationSummary === 'string'
        ? JSON.parse(requirement.regulationSummary)
        : requirement.regulationSummary || null,
      possibleObligations: typeof requirement.possibleObligations === 'string'
        ? JSON.parse(requirement.possibleObligations as string)
        : requirement.possibleObligations || [],
    };

    return NextResponse.json({
      success: true,
      requirement: parsed,
    });
  } catch (error) {
    console.error('[API] Requirement GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requirement' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/requirements/[id]
 * Update a requirement's status, priority, or notes
 * Body: { status?, priority?, notes? }
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required to edit' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    // First get the requirement to check ownership
    const existing = await getRequirementById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Requirement not found' },
        { status: 404 }
      );
    }

    // Verify user owns the company this requirement belongs to
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user || user.companyId !== existing.companyId) {
      return NextResponse.json(
        { error: 'You do not have access to this requirement' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { status, priority, notes, title, name, citation, appliesTo, triggers, excerpt, sortOrder, dueDate, calendarTracking, frequency } = body;

    // Validate fields if provided
    const update: UpdateRequirementInput = {
      modifiedByUserId: session.user.id,
    };

    if (status !== undefined) {
      if (!['pending', 'in_progress', 'compliant', 'non_compliant', 'n_a'].includes(status)) {
        return NextResponse.json(
          { error: 'Invalid status value' },
          { status: 400 }
        );
      }
      update.status = status as RequirementStatus;
    }

    if (priority !== undefined) {
      if (!['high', 'medium', 'low'].includes(priority)) {
        return NextResponse.json(
          { error: 'Invalid priority value' },
          { status: 400 }
        );
      }
      update.priority = priority as RequirementPriorityType;
    }

    if (notes !== undefined) {
      update.notes = notes;
    }

    if (title !== undefined) {
      update.title = String(title);
    }

    if (name !== undefined) {
      update.name = String(name);
    }

    if (citation !== undefined) {
      update.citation = String(citation);
    }

    if (appliesTo !== undefined) {
      update.appliesTo = String(appliesTo);
    }

    if (triggers !== undefined) {
      if (!Array.isArray(triggers)) {
        return NextResponse.json(
          { error: 'Triggers must be an array' },
          { status: 400 }
        );
      }
      update.triggers = triggers;
    }

    if (excerpt !== undefined) {
      update.excerpt = String(excerpt);
    }

    if (sortOrder !== undefined) {
      if (typeof sortOrder !== 'number' || sortOrder < 0) {
        return NextResponse.json(
          { error: 'sortOrder must be a non-negative number' },
          { status: 400 }
        );
      }
      update.sortOrder = sortOrder;
    }

    if (dueDate !== undefined) {
      // Validate ISO date string or null
      if (dueDate !== null && typeof dueDate !== 'string') {
        return NextResponse.json(
          { error: 'dueDate must be an ISO date string or null' },
          { status: 400 }
        );
      }
      if (dueDate !== null) {
        const parsed = new Date(dueDate);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: 'dueDate must be a valid ISO date string' },
            { status: 400 }
          );
        }
      }
      update.dueDate = dueDate;
    }

    if (calendarTracking !== undefined) {
      if (typeof calendarTracking !== 'boolean') {
        return NextResponse.json(
          { error: 'calendarTracking must be a boolean' },
          { status: 400 }
        );
      }
      update.calendarTracking = calendarTracking;
    }

    if (frequency !== undefined) {
      const validFrequencies = ['annual', 'semi_annual', 'quarterly', 'monthly', 'one_time'];
      if (frequency !== null && !validFrequencies.includes(frequency)) {
        return NextResponse.json(
          { error: `frequency must be one of: ${validFrequencies.join(', ')}, or null` },
          { status: 400 }
        );
      }
      update.frequency = frequency;
    }

    // Check if there's anything to update
    const hasUpdate = [
      update.status, update.priority, update.notes,
      update.title, update.name, update.citation,
      update.appliesTo, update.triggers, update.excerpt,
      update.sortOrder, update.dueDate, update.calendarTracking,
      update.frequency,
    ].some(v => v !== undefined);

    if (!hasUpdate) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const requirement = await updateRequirement(id, update);

    return NextResponse.json({
      success: true,
      requirement,
    });
  } catch (error) {
    console.error('[API] Requirement PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update requirement' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/requirements/[id]
 * Delete a requirement
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required to delete' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    // First get the requirement to check ownership
    const existing = await getRequirementById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Requirement not found' },
        { status: 404 }
      );
    }

    // Verify user owns the company this requirement belongs to
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    if (!user || user.companyId !== existing.companyId) {
      return NextResponse.json(
        { error: 'You do not have access to this requirement' },
        { status: 403 }
      );
    }

    const deleted = await deleteRequirement(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete requirement' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Requirement deleted',
    });
  } catch (error) {
    console.error('[API] Requirement DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete requirement' },
      { status: 500 }
    );
  }
}
