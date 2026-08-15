// Client for the internal Recall Advisor AI service.
//
// The AI service is a ClusterIP service with no ingress route. The browser never
// reaches it directly — Web UI calls Core API, Core API calls this.

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://recall-ai-service:8080';

export class AiServiceUnavailableError extends Error {}

/**
 * Call the AI service and return its parsed JSON plus HTTP status.
 *
 * Status is returned rather than thrown on, so callers relay the service's own
 * code. This matters for recall.recallAdvisor: the AI service owns that gate and
 * answers 403 when it is off, and that 403 must reach the browser unchanged.
 */
export async function callAiService(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal }
): Promise<{ status: number; body: unknown }> {
  const url = `${AI_SERVICE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.error(`[ai-client] ${url} unreachable:`, error);
    throw new AiServiceUnavailableError(
      error instanceof Error ? error.message : 'AI service unreachable'
    );
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }

  return { status: response.status, body };
}
