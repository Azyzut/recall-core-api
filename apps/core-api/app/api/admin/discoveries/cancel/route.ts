// Admin API: Cancel an Active Discovery
// Aborts a running discovery to stop API calls and save costs.
//
// The AbortController lives in the Recall Discovery worker's in-memory registry,
// so this proxies. Admin authentication stays here — the worker has no ingress
// route and trusts its caller.

import { NextRequest, NextResponse } from 'next/server';
import { callWorker, WorkerUnavailableError } from '@/lib/services/worker-client';

// No fallback. This repository is a template attendees copy, so a hardcoded
// default is a PUBLISHED password on an app reachable at a public hostname — and
// the previous default was a guessable constant, which was exactly that.
//
// Unset (or the `unset` sentinel, which is how Unify stores "not configured yet")
// means these endpoints refuse every request. Failing closed is correct for an
// admin surface.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_ENABLED = !!ADMIN_PASSWORD && ADMIN_PASSWORD !== 'unset';

export async function POST(request: NextRequest) {
  // Check admin authentication
  const { searchParams } = new URL(request.url);
  const auth = searchParams.get('auth');

  if (!ADMIN_ENABLED) {
    return NextResponse.json(
      { error: 'Admin endpoints are disabled. Set ADMIN_PASSWORD to enable them.' },
      { status: 503 }
    );
  }

  if (auth !== ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { discoveryId } = body;

    if (!discoveryId) {
      return NextResponse.json(
        { error: 'discoveryId is required' },
        { status: 400 }
      );
    }

    const { status } = await callWorker(
      `/discoveries/${encodeURIComponent(discoveryId)}/cancel`,
      { method: 'POST' }
    );

    if (status === 200) {
      console.log(`[Admin] Cancelled discovery: ${discoveryId}`);
      return NextResponse.json({
        success: true,
        message: `Discovery ${discoveryId} cancelled`,
      });
    }

    return NextResponse.json(
      { error: 'Discovery not found or already completed' },
      { status: 404 }
    );
  } catch (error) {
    if (error instanceof WorkerUnavailableError) {
      return NextResponse.json(
        { error: 'Discovery service is unavailable', details: error.message },
        { status: 503 }
      );
    }
    console.error('[Admin] Cancel error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel discovery' },
      { status: 500 }
    );
  }
}
