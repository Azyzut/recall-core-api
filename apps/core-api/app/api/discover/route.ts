// Public API for Dynamic Recall Discovery.
//
// The pipeline itself now lives in the Recall Discovery worker
// (apps/recall-worker). This route keeps the public concerns — rate limiting and
// input validation — and proxies the run to the worker's internal endpoint.
//
// The proxy is intentionally *blocking*, matching the monolith: the worker
// writes each recall to the database as it is discovered, and the UI polls
// /api/compliance against those rows while this request is still open.

import { NextRequest, NextResponse } from 'next/server';
import { callWorker, WorkerUnavailableError } from '@/lib/services/worker-client';

// --- Rate Limiter (in-memory, per IP) ---
// 3 discoveries per IP per hour, auto-cleans expired entries
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;
const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(ip, recent);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

// Clean stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, recent);
  }
}, 10 * 60 * 1000);

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function rateLimitResponse() {
  return NextResponse.json(
    { error: 'Too many discovery requests. Please try again in an hour.' },
    { status: 429, headers: { 'Retry-After': '3600' } }
  );
}

interface DiscoveryInput {
  naicsCode?: string;       // kept for compatibility, maps to productCategory
  productCategory?: string;
  supplyChainRole?: string;
  employeeCount: number;
  website?: string;         // optional
  companyName?: string;
  state?: string;
  email?: string;           // required for database persistence
  maxResults?: number;
  includeCPSC?: boolean;
}

async function dispatch(input: DiscoveryInput, signal?: AbortSignal) {
  try {
    const { status, body } = await callWorker('/discoveries', {
      method: 'POST',
      body: input,
      signal,
    });
    // Relay the worker's own status so validation errors stay 400s
    // rather than being flattened into a 502.
    return NextResponse.json(body, { status });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('[API] Client disconnected - discovery request aborted');
      return NextResponse.json(
        { error: 'Request cancelled', aborted: true },
        { status: 499 } // Client Closed Request
      );
    }
    if (error instanceof WorkerUnavailableError) {
      return NextResponse.json(
        { error: 'Discovery service is unavailable', details: error.message },
        { status: 503 }
      );
    }
    console.error('[API] Discovery error:', error);
    return NextResponse.json(
      {
        error: 'Failed to discover requirements',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) return rateLimitResponse();

  let body: DiscoveryInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }

  return await dispatch(body, request.signal);
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) return rateLimitResponse();

  const { searchParams } = new URL(request.url);

  const naicsCode = searchParams.get('naicsCode');
  const productCategory = searchParams.get('productCategory');
  const employeeCount = searchParams.get('employeeCount');
  const website = searchParams.get('website');

  if (!productCategory && !naicsCode) {
    return NextResponse.json(
      { error: 'productCategory (or naicsCode) query parameter is required' },
      { status: 400 }
    );
  }

  if (!employeeCount) {
    return NextResponse.json(
      { error: 'employeeCount query parameter is required' },
      { status: 400 }
    );
  }

  const input: DiscoveryInput = {
    naicsCode: naicsCode || undefined,
    productCategory: productCategory || undefined,
    supplyChainRole: searchParams.get('supplyChainRole') || undefined,
    employeeCount: parseInt(employeeCount, 10),
    website: website || undefined,
    companyName: searchParams.get('companyName') || undefined,
    state: searchParams.get('state') || undefined,
    // `email` is deliberately not read from the query string. The pipeline
    // requires it and rejects with 400, which means this GET handler has never
    // completed a discovery. Leaving it that way is intentional: nothing calls
    // it (app/discover/page.tsx uses POST), and wiring it up would expose an
    // unauthenticated route — rate limited to 3/hour/IP, but unauthenticated —
    // that spends Anthropic and Voyage credit and writes a company row.
    // Candidate for deletion as dead code during Phase 2 hardening.
    maxResults: parseInt(searchParams.get('maxResults') || '20', 10),
    includeCPSC: searchParams.get('includeCPSC') !== 'false',
  };

  return await dispatch(input, request.signal);
}
