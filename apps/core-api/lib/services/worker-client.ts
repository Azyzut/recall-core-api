// Client for the internal Recall Discovery worker.
//
// The worker is a ClusterIP service with no ingress route, so it is reachable
// only from inside the cluster. Everything public-facing — auth, rate limiting,
// admin password checks — stays on this side of the call.

const WORKER_URL = process.env.RECALL_WORKER_URL || 'http://recall-worker:8080';

export class WorkerUnavailableError extends Error {}

/**
 * Call the worker and return its parsed JSON plus HTTP status.
 *
 * Status is returned rather than thrown on so callers can relay the worker's own
 * status code — a 400 from the pipeline should reach the browser as a 400, not
 * be flattened into a 502.
 */
export async function callWorker(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal }
): Promise<{ status: number; body: unknown }> {
  const url = `${WORKER_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (error) {
    // Re-throw aborts so callers can distinguish cancellation from an outage.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    console.error(`[worker-client] ${url} unreachable:`, error);
    throw new WorkerUnavailableError(
      error instanceof Error ? error.message : 'Recall worker unreachable'
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
