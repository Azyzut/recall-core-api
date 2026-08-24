// API endpoint to get post-auth redirect URL
import { NextResponse } from 'next/server';
// @ts-ignore — rox-node v6, externalized singleton
import Rox from 'rox-node';
import { auth } from '@/auth';
import { setFmCustomProperties } from '@recall/shared/fm';
import db from '@recall/shared/db';
import { getPostAuthRedirect } from '@/lib/services/auth-redirect';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Targeting properties must be set BEFORE evaluating the flag, and that needs the
    // session — so the kill switch is checked after authentication, not before it.
    //
    // This used to evaluate recall.errorState as the very first statement in the
    // handler. The SDK was initialised, so the call succeeded, but no custom
    // properties had ever been set on it: core-api set none anywhere. A flag with no
    // targeting worked; a flag targeted at an email or a companySize silently
    // evaluated false, because there was nothing for the rule to match. The symptom
    // was "the kill switch does nothing", with a healthy SDK and a correct flag.
    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    const company = user?.companyId
      ? await db
          .selectFrom('companies')
          .select(['companyName', 'employeeCount', 'naicsCode', 'state'])
          .where('id', '=', user.companyId)
          .executeTakeFirst()
      : undefined;

    setFmCustomProperties({
      userId: session.user.id,
      email: session.user.email,
      isLoggedIn: true,
      companyId: user?.companyId ?? undefined,
      companyName: company?.companyName ?? undefined,
      employeeCount: company?.employeeCount ?? undefined,
      naicsCode: company?.naicsCode ?? undefined,
      state: company?.state ?? undefined,
    });

    // FM demo kill switch — when recall.errorState is on, force a 404 on login
    if (Rox.dynamicApi.isEnabled('recall.errorState', false)) {
      return NextResponse.json(
        { error: 'Not Found', notFound: true },
        { status: 404 }
      );
    }

    const result = await getPostAuthRedirect(session.user.id, session.user.email);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Redirect error:', error);
    return NextResponse.json(
      { error: 'Failed to determine redirect', redirect: '/discover' },
      { status: 500 }
    );
  }
}
