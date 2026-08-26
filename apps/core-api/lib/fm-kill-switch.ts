// The recall.dashboardRedesign kill switch.
//
// The flag is named for the feature an audience is hoping to see. Turning it on takes
// the application away; turning it off brings it back in seconds, with no deployment.
// That is the demonstration — and it lands harder when the thing being rolled back was
// something the room actually wanted.
//
// Checked in more than one place on purpose. It was originally evaluated only on
// /api/auth/redirect, which runs once immediately after sign-in — so a refresh went
// straight to the matrix, never asked, and the user was through. A kill switch you can
// escape by pressing F5 is not a kill switch.
//
// The web UI responds to a 503 from here by ending the session and returning to the
// login page, which then refuses to let anyone back in while the flag is on. An earlier
// version left the session intact and rendered an error in place; that assumed pages
// could cope with having no data, and they could not — a 503 reached code expecting a
// payload and tripped Next's error boundary. Signing out is only a loop if the login
// page says nothing, so it says something.
//
// This deliberately does NOT live in middleware. Middleware runs on the edge runtime
// and the Feature Management server SDK is a Node library, so the flag has to be
// evaluated where the SDK actually exists.

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

  return Rox.dynamicApi.isEnabled('recall.dashboardRedesign', false);
}
