// GET  /api/admin/metrics — request and failure counts for the last few minutes.
// POST /api/admin/metrics — clears them, so a demo does not open on the last spike.
//
// Admin-password protected via the x-admin-password header. This exposes route
// names, status codes and timestamps — no user data, no company data — but it is
// still operational detail that does not belong in an unauthenticated endpoint.
//
// Node runtime, not edge: it reads the Feature Management server SDK, which is a
// Node library. Same constraint as lib/fm-kill-switch.ts.

import { NextResponse } from 'next/server';
// @ts-ignore — rox-node v6, externalized singleton
import Rox from 'rox-node';
import { getConfigChanges } from '@recall/shared/fm';
import { checkAdminAuth } from '@/lib/admin-auth';
import { snapshot, reset } from '@/lib/error-metrics';

export const runtime = 'nodejs';

/** Flags whose state is worth showing next to the graph. */
const WATCHED = [
  'recall.dashboardRedesign',
  'recall.recallAdvisor',
  'recall.exportPdf',
  'recall.calendarView',
] as const;

export async function GET(request: Request) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // If the SDK never initialised, every flag reads as its default. Say so, rather
  // than reporting a confident `false` that means "no SDK key" — that ambiguity
  // has cost debugging time before.
  const fmReady = !!process.env.FM_KEY && process.env.FM_KEY !== 'unset';

  const flags: Record<string, boolean> = {};
  for (const name of WATCHED) {
    flags[name] = Rox.dynamicApi.isEnabled(name, false);
  }

  return NextResponse.json(
    {
      ...snapshot(),
      fmReady,
      flags,
      configChanges: getConfigChanges(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  reset();
  return NextResponse.json({ ok: true });
}
