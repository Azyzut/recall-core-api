// Admin password check, in one place.
//
// The four existing routes under app/api/admin/ each carry their own copy of this
// logic, and two of them accept the password as a `?auth=` query parameter. That
// is worth changing eventually — a password in a query string ends up in access
// logs, in the browser's history, and in the Referer header sent to any third
// party the page loads — but changing it means touching the admin UI at the same
// time, so those four are left alone for now.
//
// New admin routes use this helper and take the password from a header only.

import { timingSafeEqual } from 'node:crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/**
 * `unset` is the workshop's sentinel for "no value supplied yet" — Unify will not
 * save an empty variable, so the pipeline passes the literal word instead. Treating
 * it as a real password would leave admin endpoints open to anyone who guessed the
 * convention, so it disables them exactly as an absent value does.
 */
export const ADMIN_ENABLED = !!ADMIN_PASSWORD && ADMIN_PASSWORD !== 'unset';

function matches(supplied: string): boolean {
  const expected = ADMIN_PASSWORD!;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare lengths first and always run the comparison.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/** Checks the x-admin-password header. Query parameters are deliberately not read. */
export function checkAdminAuth(request: Request): AdminAuthResult {
  if (!ADMIN_ENABLED) {
    return {
      ok: false,
      status: 503,
      error: 'Admin endpoints are disabled because ADMIN_PASSWORD is not set.',
    };
  }

  const supplied = request.headers.get('x-admin-password');
  if (!supplied || !matches(supplied)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}
