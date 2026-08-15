// Admin API: List Active Discoveries
// Returns all currently running discoveries for admin monitoring.
//
// The registry is an in-memory Map inside the Recall Discovery worker, so this
// proxies rather than reading locally. Admin authentication stays here — the
// worker has no ingress route and trusts its caller.

import { NextRequest, NextResponse } from 'next/server';
import { callWorker, WorkerUnavailableError } from '@/lib/services/worker-client';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'recall-admin-2024';

interface WorkerActiveDiscovery {
  id: string;
  companyId: string;
  companyName: string;
  email: string;
  startedAt: string;
  progress: {
    current: number;
    total: number;
    currentCitation?: string;
  };
}

export async function GET(request: NextRequest) {
  // Check admin authentication
  const { searchParams } = new URL(request.url);
  const auth = searchParams.get('auth');

  if (auth !== ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { status, body } = await callWorker('/discoveries/active');

    if (status !== 200) {
      return NextResponse.json(body, { status });
    }

    const discoveries = ((body as { discoveries?: WorkerActiveDiscovery[] })?.discoveries) ?? [];

    return NextResponse.json({
      count: discoveries.length,
      discoveries: discoveries.map(d => {
        const startedAt = new Date(d.startedAt);
        return {
          id: d.id,
          companyId: d.companyId,
          companyName: d.companyName,
          email: d.email,
          startedAt: startedAt.toISOString(),
          elapsedSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
          progress: {
            current: d.progress.current,
            total: d.progress.total,
            percent: d.progress.total
              ? Math.round((d.progress.current / d.progress.total) * 100)
              : 0,
            currentCitation: d.progress.currentCitation,
          },
        };
      }),
    });
  } catch (error) {
    if (error instanceof WorkerUnavailableError) {
      return NextResponse.json(
        { error: 'Discovery service is unavailable', details: error.message },
        { status: 503 }
      );
    }
    console.error('[Admin] Active discoveries error:', error);
    return NextResponse.json(
      { error: 'Failed to list active discoveries' },
      { status: 500 }
    );
  }
}
