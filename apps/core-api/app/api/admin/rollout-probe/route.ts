// GET /api/admin/rollout-probe?flag=recall.exportPdf
//
// Measures a progressive rollout instead of reading it, and measures it PER
// IDENTITY so the answer is stable between polls.
//
// CloudBees does not expose the rollout percentage: not through the flag API,
// not in a connected configuration-as-code repository, and not reachably through
// the SDK's configuration endpoint. So this asks the real SDK the real question
// for a fixed set of identities and counts the answers.
//
// WHY IDENTITIES AND NOT BARE CALLS. The first version called isEnabled() 200
// times with no context. A percentage rollout then bucketed each call
// independently, because the default stickiness property is `rox.distinct_id` —
// a device property that means nothing in a process serving everybody. The grid
// reshuffled every two seconds, which is accurate but useless: a rollout is
// supposed to show the same users keeping the feature as the percentage grows.
//
// Passing a context makes the bucket md5(<stickiness value> + seed), fixed per
// identity. See setup.ts, where `userId` and `companySize` are registered as
// function properties that read from that context.
//
// REQUIRES ONE SETTING IN UNIFY: the flag's rollout stickiness property must be
// `userId`. Left at the default the grid still works but reshuffles, which is
// the behaviour this endpoint exists to avoid.
//
// Node runtime: the server SDK is a Node library, as with the other flag reads.

import { NextResponse } from 'next/server';
// @ts-ignore — rox-node v6, externalized singleton
import Rox from 'rox-node';
import { checkAdminAuth } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// Restricting this matters: an arbitrary flag name would turn the endpoint into
// a way to enumerate an organisation's flags.
const ALLOWED = [
  'recall.dashboardRedesign',
  'recall.recallAdvisor',
  'recall.exportPdf',
  'recall.calendarView',
] as const;

// A pyramid rather than even thirds, because a real book of business is one and
// because it makes "enterprise only" read as the small, high-value slice it is.
// The buckets match companySizeBucket() in packages/shared/src/fm/setup.ts, so a
// target group written against companySize behaves here exactly as it does for a
// signed-in user.
const SEGMENTS = [
  { name: 'small', count: 120 },
  { name: 'mid-market', count: 55 },
  { name: 'enterprise', count: 25 },
] as const;

const IDENTITIES = SEGMENTS.flatMap(seg =>
  Array.from({ length: seg.count }, (_, i) => ({
    userId: `${seg.name}-${i}`,
    companySize: seg.name,
  }))
);

export async function GET(request: Request) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const flag = url.searchParams.get('flag') ?? ALLOWED[0];
  if (!(ALLOWED as readonly string[]).includes(flag)) {
    return NextResponse.json(
      { error: `flag must be one of: ${ALLOWED.join(', ')}` },
      { status: 400 }
    );
  }

  // One evaluation per identity, each carrying its own context. Same call the
  // real gates make, minus the work that follows it.
  const pattern: boolean[] = [];
  const perSegment: Record<string, { total: number; enabled: number }> = {};
  for (const seg of SEGMENTS) perSegment[seg.name] = { total: 0, enabled: 0 };

  for (const identity of IDENTITIES) {
    const on = Rox.dynamicApi.isEnabled(flag, false, identity);
    pattern.push(on);
    const bucket = perSegment[identity.companySize];
    bucket.total++;
    if (on) bucket.enabled++;
  }

  const enabled = pattern.filter(Boolean).length;
  const fmReady = !!process.env.FM_KEY && process.env.FM_KEY !== 'unset';

  return NextResponse.json(
    {
      flag,
      samples: IDENTITIES.length,
      enabled,
      pattern,
      segments: SEGMENTS.map(s => ({ name: s.name, ...perSegment[s.name] })),
      // Without a key every flag reads its code default, which renders as a
      // uniformly dark grid and looks like a rollout set to zero.
      fmReady,
      at: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
