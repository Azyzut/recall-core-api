// Public API for the Recall Advisor chat.
//
// The AI logic now lives in the internal AI service (apps/ai-service). This
// route authenticates the user, resolves their companyId and company profile,
// and forwards both to that service.
//
// It deliberately does NOT evaluate recall.recallAdvisor. The gate lives in the
// AI service, which owns the capability, so that turning the flag off darkens
// that component specifically rather than being short-circuited here. The 403
// the AI service returns is relayed unchanged, so the browser sees exactly the
// response the monolith produced.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import db from '@recall/shared/db';
import { callAiService, AiServiceUnavailableError } from '@/lib/services/ai-client';

export async function POST(request: NextRequest) {
  // 0. Auth check
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // 1. Resolve companyId
  const user = await db
    .selectFrom('users')
    .select(['companyId'])
    .where('id', '=', session.user.id)
    .executeTakeFirst();

  if (!user?.companyId) {
    return NextResponse.json(
      { error: 'No company linked to your account. Run a discovery first.' },
      { status: 400 }
    );
  }
  const companyId = user.companyId;

  // 2. Fetch the company profile the AI service needs for FM targeting.
  //    Resolved here because this is the component with the session; forwarded
  //    so the AI service can set custom properties before it evaluates the flag.
  const companyForProps = await db
    .selectFrom('companies')
    .select(['employeeCount', 'naicsCode', 'state'])
    .where('id', '=', companyId)
    .executeTakeFirst();

  // 3. Parse request
  let body: { message: string; conversationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, conversationId } = body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // 4. Forward to the AI service and relay its response verbatim.
  try {
    const { status, body: result } = await callAiService('/chat', {
      method: 'POST',
      body: {
        message,
        conversationId,
        context: {
          userId: session.user.id,
          email: session.user.email ?? undefined,
          companyId,
          employeeCount: companyForProps?.employeeCount ?? undefined,
          naicsCode: companyForProps?.naicsCode ?? undefined,
          state: companyForProps?.state ?? undefined,
        },
      },
      signal: request.signal,
    });

    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request cancelled', aborted: true }, { status: 499 });
    }
    if (error instanceof AiServiceUnavailableError) {
      return NextResponse.json(
        { error: 'Recall Advisor is unavailable', details: error.message },
        { status: 503 }
      );
    }
    console.error('[Chat] Error:', error);
    return NextResponse.json(
      { error: `Chat failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
