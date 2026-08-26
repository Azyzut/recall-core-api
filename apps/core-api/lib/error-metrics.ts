// A small, deliberately honest error counter.
//
// It exists for one demonstration: turn a flag on, watch the failure rate climb,
// read the timestamp of the first failure, and go find the matching entry in
// Feature Management's audit history. That story only works if the numbers are
// real, so nothing here is simulated — every count comes from a request that
// actually reached this process, and every timestamp is the server's.
//
// This is NOT production observability, and it should not be presented as such.
// It holds a few minutes of counts in memory, in one process. Real answers to
// "what broke, when, and for whom" come from a metrics backend and structured
// logs shipped off the pod. What this gives you is the shape of that signal,
// visible on one screen, without asking a customer to trust a dashboard they
// cannot see the inside of.
//
// DEPENDS ON replicaCount: 1 (apps/core-api/chart/values.yaml). Counts live in
// this pod's heap. Scale core-api up and each replica reports only the requests
// it happened to serve, so the panel would show a fraction of the truth with no
// indication that it was doing so. recall-worker carries the same constraint and
// documents it in its Dockerfile; this is core-api's version of that note.
//
// State is parked on globalThis rather than in a module-level `const` for the
// same reason packages/shared/src/fm/setup.ts does it: Next re-evaluates modules
// on hot reload and across bundles, and a counter that silently resets is worse
// than no counter at all.

const GLOBAL_KEY = '__recallErrorMetrics__';

/** Width of one chart column. Small enough that a flag flip looks instant. */
export const BUCKET_MS = 2_000;

/** 150 buckets at 2s = five minutes, which is longer than any live demo. */
const BUCKETS = 150;

/** Most recent individual failures, for the "what exactly failed" list. */
const RECENT_LIMIT = 40;

export interface Bucket {
  /** Start of the bucket, epoch ms. */
  t: number;
  /** Requests that succeeded. */
  ok: number;
  /** Requests that failed. */
  err: number;
}

export interface Failure {
  ts: number;
  route: string;
  status: number;
  /** Set when this failure was caused by a feature flag rather than a fault. */
  flag?: string;
}

interface Store {
  buckets: Map<number, Bucket>;
  recent: Failure[];
  firstErrorAt: number | null;
  totalOk: number;
  totalErr: number;
  startedAt: number;
}

declare global {
  var __recallErrorMetrics__: Store | undefined;
}

function store(): Store {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      buckets: new Map(),
      recent: [],
      firstErrorAt: null,
      totalOk: 0,
      totalErr: 0,
      startedAt: Date.now(),
    };
  }
  return globalThis[GLOBAL_KEY]!;
}

function bucketFor(s: Store, ts: number): Bucket {
  const t = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
  let b = s.buckets.get(t);
  if (!b) {
    b = { t, ok: 0, err: 0 };
    s.buckets.set(t, b);
    // Drop anything that has fallen out of the window. Cheap because this only
    // runs when a new bucket opens, not on every request.
    const cutoff = t - BUCKETS * BUCKET_MS;
    for (const key of s.buckets.keys()) {
      if (key < cutoff) s.buckets.delete(key);
    }
  }
  return b;
}

/**
 * Records one request outcome.
 *
 * `status` is the HTTP status actually returned. Anything below 500 counts as a
 * success EXCEPT where a `flag` is named: a flag-gated 403 is not a fault, but it
 * is the thing we are trying to make visible, so it is counted as a failure and
 * labelled. 499 (client cancelled) is ignored entirely — the caller walked away,
 * nothing failed, and counting it would make an idle demo look unhealthy.
 */
export function record(route: string, status: number, flag?: string): void {
  if (status === 499) return;

  const s = store();
  const ts = Date.now();
  const b = bucketFor(s, ts);

  const failed = status >= 500 || !!flag;
  if (!failed) {
    b.ok++;
    s.totalOk++;
    return;
  }

  b.err++;
  s.totalErr++;
  if (s.firstErrorAt === null) s.firstErrorAt = ts;
  s.recent.unshift({ ts, route, status, ...(flag ? { flag } : {}) });
  if (s.recent.length > RECENT_LIMIT) s.recent.length = RECENT_LIMIT;
}

export interface Snapshot {
  now: number;
  bucketMs: number;
  windowMs: number;
  buckets: Bucket[];
  recent: Failure[];
  firstErrorAt: number | null;
  totalOk: number;
  totalErr: number;
  startedAt: number;
}

/** Buckets in time order, gaps filled with zeroes so the chart has no holes. */
export function snapshot(): Snapshot {
  const s = store();
  const now = Date.now();
  const newest = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const oldest = newest - (BUCKETS - 1) * BUCKET_MS;

  const buckets: Bucket[] = [];
  for (let t = oldest; t <= newest; t += BUCKET_MS) {
    buckets.push(s.buckets.get(t) ?? { t, ok: 0, err: 0 });
  }

  return {
    now,
    bucketMs: BUCKET_MS,
    windowMs: BUCKETS * BUCKET_MS,
    buckets,
    recent: s.recent,
    firstErrorAt: s.firstErrorAt,
    totalOk: s.totalOk,
    totalErr: s.totalErr,
    startedAt: s.startedAt,
  };
}

/** Clears everything. Between demo runs, so the previous spike is not on screen. */
export function reset(): void {
  globalThis[GLOBAL_KEY] = undefined;
  store();
}
