// API endpoint to get post-auth redirect URL
import { NextResponse } from 'next/server';
// @ts-ignore — rox-node v6, externalized singleton
import Rox from 'rox-node';
import { auth } from '@/auth';
import { getPostAuthRedirect } from '@/lib/services/auth-redirect';

export async function GET() {
  try {
    // FM demo kill switch — when recall.errorState is on, force a 404 on login
    if (Rox.dynamicApi.isEnabled('recall.errorState', false)) {
      return NextResponse.json(
        { error: 'Not Found', notFound: true },
        { status: 404 }
      );
    }

    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
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
