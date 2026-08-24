// The recall.errorState kill switch.
//
// Checked in more than one place on purpose. It was originally evaluated only on
// /api/auth/redirect, which runs once immediately after sign-in — so a refresh went
// straight to the matrix, never asked, and the user was through. A kill switch you can
// escape by pressing F5 is not a kill switch.
//
// Two things this deliberately does NOT do:
//
//   - It does not destroy the session. Forcing a logout produces a loop — sign in, get
//     ejected, try again — which reads as a broken application rather than a service
//     that has been deliberately closed.
//   - It does not live in middleware. Middleware runs on the edge runtime, and the
//     Feature Management server SDK is a Node library. This has to be evaluated where
//     the SDK actually exists.

// @ts-ignore — rox-node v6, externalized singleton
import Rox from 'rox-node';
import { setFmCustomProperties } from '@recall/shared/fm';
import db from '@recall/shared/db';

export const MAINTENANCE_MESSAGE =
  'Recall Tracker is temporarily unavailable. Your data is safe — please try again shortly.';

/**
 * Applies the signed-in user's targeting properties, then evaluates the kill switch.
 *
 * The properties matter: a flag targeted at an email or a companySize evaluates false
 * against an SDK that has never been told who the user is, so the switch appears to do
 * nothing while looking perfectly healthy.
 */
export async function isServiceKilled(userId: string, email: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select(['companyId'])
    .where('id', '=', userId)
    .executeTakeFirst();

  const company = user?.companyId
    ? await db
        .selectFrom('companies')
        .select(['companyName', 'employeeCount', 'naicsCode', 'state'])
        .where('id', '=', user.companyId)
        .executeTakeFirst()
    : undefined;

  setFmCustomProperties({
    userId,
    email,
    isLoggedIn: true,
    companyId: user?.companyId ?? undefined,
    companyName: company?.companyName ?? undefined,
    employeeCount: company?.employeeCount ?? undefined,
    naicsCode: company?.naicsCode ?? undefined,
    state: company?.state ?? undefined,
  });

  return Rox.dynamicApi.isEnabled('recall.errorState', false);
}
