// Auth redirect service - determines where to send users after login/registration
import { db } from '@recall/shared/db';

export interface RedirectResult {
  redirect: string;
  linked?: boolean;  // True if we linked user to a company
  companyName?: string;
}

/**
 * Determine where to redirect user after authentication
 *
 * Logic:
 * 1. User has companyId → /matrix (they have data)
 * 2. User email matches company.contactEmail → link & /matrix (prior anon discovery)
 * 3. No match → /discover (need to run discovery first)
 */
export async function getPostAuthRedirect(userId: string, email: string): Promise<RedirectResult> {
  // 1. Check if user already has a linked company
  const user = await db
    .selectFrom('users')
    .select(['id', 'companyId'])
    .where('id', '=', userId)
    .executeTakeFirst();

  if (user?.companyId) {
    // User already has a company linked
    const company = await db
      .selectFrom('companies')
      .select(['companyName'])
      .where('id', '=', user.companyId)
      .executeTakeFirst();

    return {
      redirect: '/matrix',
      companyName: company?.companyName || undefined,
    };
  }

  // 2. Check if email matches a company from prior anonymous discovery
  const company = await db
    .selectFrom('companies')
    .select(['id', 'companyName'])
    .where('contactEmail', '=', email.toLowerCase())
    .executeTakeFirst();

  if (company) {
    // Link user to this company
    await db
      .updateTable('users')
      .set({ companyId: company.id })
      .where('id', '=', userId)
      .execute();

    return {
      redirect: '/matrix',
      linked: true,
      companyName: company.companyName,
    };
  }

  // 3. No prior discovery - send to discover page
  return {
    redirect: '/discover',
  };
}

/**
 * Link anonymous discoveries to a user on registration
 * Called after user is created to check for prior discoveries
 */
export async function linkAnonymousDiscoveries(userId: string, email: string): Promise<boolean> {
  // Find company where contactEmail matches
  const company = await db
    .selectFrom('companies')
    .select(['id'])
    .where('contactEmail', '=', email.toLowerCase())
    .executeTakeFirst();

  if (company) {
    // Link user to company
    await db
      .updateTable('users')
      .set({ companyId: company.id })
      .where('id', '=', userId)
      .execute();

    return true;
  }

  return false;
}
