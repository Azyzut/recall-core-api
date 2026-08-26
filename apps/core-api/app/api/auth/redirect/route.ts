// API endpoint to get post-auth redirect URL
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isServiceKilled, MAINTENANCE_MESSAGE } from '@/lib/fm-kill-switch';
import { getPostAuthRedirect } from '@/lib/services/auth-redirect';
import { record } from '@/lib/error-metrics';

const ROUTE = 'GET /api/auth/redirect';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // FM demo kill switch. See lib/fm-kill-switch.ts for why this is checked here
    // AND on the endpoints the authenticated pages depend on.
    if (await isServiceKilled(session.user.id, session.user.email)) {
      record(ROUTE, 503, 'recall.dashboardRedesign');
      return NextResponse.json(
        { error: MAINTENANCE_MESSAGE, maintenance: true },
        { status: 503 }
      );
    }

    const result = await getPostAuthRedirect(session.user.id, session.user.email);

    record(ROUTE, 200);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Redirect error:', error);
    record(ROUTE, 500);
    return NextResponse.json(
      { error: 'Failed to determine redirect', redirect: '/discover' },
      { status: 500 }
    );
  }
}
