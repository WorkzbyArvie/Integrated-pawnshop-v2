/**
 * Centralized API client for the NestJS backend.
 *
 * Every request automatically attaches:
 *   - Authorization header (Bearer <supabase-token>)
 *   - pawnshop-id header (from localStorage)
 *   - user-id header (from Supabase session)
 *
 * The client normalizes HTTP errors into a consistent shape so
 * callers can always `try/catch` and read `error.message`.
 */

import { supabase } from './supabaseClient';
import { getBackendUrl } from './backendUrl';

const BACKEND_URL = getBackendUrl();
const SAFE_RULE_KEYS = new Set([
  'required',
  'minLength',
  'maxLength',
  'uppercase',
  'lowercase',
  'number',
  'symbol',
  'noSurroundingWhitespace',
  'common',
]);

function safeRuleKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (key): key is string => typeof key === 'string' && SAFE_RULE_KEYS.has(key),
  );
}

/**
 * Header the backend reads the session-bound MFA assertion from.
 * Mirrors `MFA_ASSERTION_HEADER` in backend/src/security/mfa-assertion.service.ts.
 */
export const MFA_ASSERTION_HEADER = 'x-mfa-assertion';

let mfaAssertion: string | null = null;
let mfaAssertionExpiresAt: number | null = null;
let mfaAssertionUserId: string | null = null;

function toTimestamp(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Hold the server-issued MFA assertion in module memory only. Never written to
 * localStorage, sessionStorage, a URL, or a log, and cleared at every session
 * boundary so a previous session's assertion can never be replayed.
 */
export function setMfaAssertion(
  assertion: string,
  options: { expiresAt?: string | number | Date | null; userId?: string | null } = {},
): void {
  const value = typeof assertion === 'string' ? assertion.trim() : '';
  if (!value) {
    clearMfaAssertion();
    return;
  }
  mfaAssertion = value;
  mfaAssertionExpiresAt = toTimestamp(options.expiresAt);
  mfaAssertionUserId = options.userId ?? mfaAssertionUserId;
}

export function getMfaAssertion(): string | null {
  if (!mfaAssertion) return null;
  if (mfaAssertionExpiresAt !== null && Date.now() >= mfaAssertionExpiresAt) {
    clearMfaAssertion();
    return null;
  }
  return mfaAssertion;
}

const MFA_ASSERTION_DENIED = 'MFA_VERIFICATION_REQUIRED';

/**
 * Whether the server has refused this session for want of an MFA assertion.
 *
 * Every protected route answers 403 with this code while the account is
 * MFA-enabled and the assertion is absent, stale or bound to another session.
 * Until an assertion is held, *no* tenant-scoped call can succeed, so firing them
 * is not merely wasteful - it is guaranteed noise, and it drove the reload storm
 * and the 403 storm that made the app look broken on first paint.
 *
 * Set the first time a denial is seen and cleared by `clearMfaAssertion`, so a
 * caller can ask "is this session still waiting on MFA?" without inspecting
 * error shapes at each call site.
 */
let mfaAssertionDenied = false;

/**
 * Routes the AccountSecurityGuard exempts from the MFA decision. The challenge
 * and the credential-status read have to keep working while the assertion is
 * still missing - that is how the app learns MFA is on and asks for a code - so
 * they must not be short-circuited by the guard below.
 */
const MFA_EXEMPT_ROUTES = new Set([
  'GET /security/credential-status',
  'POST /security/change-password',
  'POST /security/recovery/complete',
  'GET /security/activity',
  'GET /security/activity-log',
  'GET /auth/credential-status',
  'POST /auth/logout',
  'POST /auth/sign-out',
  'POST /security/mfa/enable-challenge',
  'POST /security/mfa/verify',
  'POST /security/mfa/login-challenge',
  'POST /security/mfa/disable',
]);

/**
 * Declare that the current session is known to be MFA-blocked, from the
 * server-owned credential status rather than from a 403 already seen.
 *
 * The 403-driven flag arrives too late to help: a screen-mount burst fires many
 * calls concurrently, so they are all in flight before the first denial comes
 * back. Setting this the moment `mfaEnabled` is known lets `request` refuse them
 * up front, which is what turns a wall of console errors into a single pending
 * challenge.
 */
export function markMfaAssertionPending(pending: boolean): void {
  if (pending) mfaAssertionDenied = true;
  else clearMfaAssertion();
}

export function isMfaAssertionPending(): boolean {
  return mfaAssertionDenied && getMfaAssertion() === null;
}

function isMfaExempt(method: string, path: string): boolean {
  const normalized =
    path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return MFA_EXEMPT_ROUTES.has(`${method.toUpperCase()} ${normalized}`);
}

/** True when a 403 carries the server's MFA-verification code. */
export function isMfaDenial(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 403 && error.code === MFA_ASSERTION_DENIED;
  }
  return getApiErrorDetails(error).code === MFA_ASSERTION_DENIED;
}

export function clearMfaAssertion(): void {
  mfaAssertion = null;
  mfaAssertionExpiresAt = null;
  mfaAssertionUserId = null;
  mfaAssertionDenied = false;
}

/**
 * Bind a held assertion to the subject that is currently authenticated and drop it
 * as soon as that subject changes. A held assertion is never carried into a new
 * login or a different account, and sign-out leaves nothing behind to replay.
 */
function bindAssertionToSession(userId: string | null, authenticated: boolean): void {
  if (!mfaAssertion) return;
  if (!authenticated) {
    clearMfaAssertion();
    return;
  }
  if (mfaAssertionUserId === null) {
    mfaAssertionUserId = userId;
    return;
  }
  if (mfaAssertionUserId !== userId) {
    clearMfaAssertion();
  }
}

function errorDetails(body: unknown): { code?: string; failedRules: string[] } {
  if (!body || typeof body !== 'object') return { failedRules: [] };
  const payload = body as Record<string, unknown>;
  const code = typeof payload.error === 'string' ? payload.error : undefined;
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : undefined;
  return { code, failedRules: safeRuleKeys(data?.failed) };
}

/**
 * Unwrap the backend's `{ success, data }` envelope.
 *
 * Repeated rather than single-level because a controller that already returns an
 * envelope, combined with the global wrapping interceptor, produced a second
 * layer. The client then received the envelope instead of the payload, so a
 * valid response was read as an absent one, which the credential preflight
 * reported as an unavailable account security status. Bounded so a pathological
 * payload cannot spin.
 */
function unwrapEnvelope<T>(value: unknown): T {
  let current: unknown = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) break;
    const envelope = current as Record<string, unknown>;
    if (envelope.success !== true || envelope.data === undefined) break;
    current = envelope.data;
  }
  return current as T;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  code?: string;
  failedRules: string[];

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    const details = errorDetails(body);
    this.code = details.code;
    this.failedRules = details.failedRules;
  }
}

export function getApiErrorDetails(error: unknown): {
  code?: string;
  failedRules: string[];
} {
  if (error instanceof ApiError) {
    return { code: error.code, failedRules: [...error.failedRules] };
  }
  return errorDetails(error);
}

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    let {
      data: { session },
    } = await supabase.auth.getSession();

    // Ensure we use a fresh token when current session is near expiry.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (session?.expires_at && session.expires_at <= nowSeconds + 30) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed?.session ?? session;
    }

    if (session?.access_token) {
      const userId = session.user?.id ?? null;
      bindAssertionToSession(userId, true);
      headers['Authorization'] = `Bearer ${session.access_token}`;
      headers['user-id'] = userId ?? '';
      const assertion = getMfaAssertion();
      if (assertion) {
        headers[MFA_ASSERTION_HEADER] = assertion;
      }
    } else {
      bindAssertionToSession(null, false);
    }
  } catch {
    // No session available — proceed unauthenticated
  }

  const pawnshopId =
    localStorage.getItem('active_pawnshop_id') ?? '';
  if (pawnshopId) {
    headers['pawnshop-id'] = pawnshopId;
  }

  const branchId = localStorage.getItem('active_branch_id') ?? '';
  if (branchId) {
    headers['branch-id'] = branchId;
  }

  return headers;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  queryParams?: Record<string, string | number | boolean | undefined>,
  retryCount = 0,
): Promise<T> {
  // Refuse before the network, not after.
  //
  // While the session is waiting on an MFA assertion the server answers every
  // protected route with the same 403. Firing them anyway produced the 403 storm
  // on first paint and, where a component retried, a retry storm that tripped the
  // verify throttle. One local failure here is indistinguishable to callers and
  // costs nothing; the same call in flight costs a round trip and console noise.
  // Exempt routes - the challenge itself, and the status read that reports
  // `mfaEnabled` - must still reach the server or the user can never get in.
  if (isMfaAssertionPending() && !isMfaExempt(method, path)) {
    throw new ApiError('Multi-factor verification is required for this account.', 403, {
      success: false,
      error: MFA_ASSERTION_DENIED,
      reason: 'assertion',
    });
  }

  const headers = await getHeaders();

  let url = `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;

  if (queryParams) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(queryParams)) {
      if (val !== undefined && val !== null && val !== '') {
        params.append(key, String(val));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // Authenticated, per-user data must never be served from the HTTP cache.
    // A revalidation `304 Not Modified` carries no body, so treating it as a
    // normal response left callers with an empty payload and a false
    // "unavailable" credential state.
    cache: 'no-store',
  });

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  // A `304` can still arrive from an intermediary that ignores `no-store`. It
  // has no body, so refetch unconditionally once rather than surfacing an error
  // for a request that actually succeeded.
  if (res.status === 304 && retryCount < 1) {
    const forced = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'reload',
    });
    if (forced.status === 304) {
      throw new ApiError('Request returned no body', 304, null);
    }
    return parseResponse<T>(forced, method, path, body, queryParams, retryCount);
  }

  return parseResponse<T>(res, method, path, body, queryParams, retryCount);
}

async function parseResponse<T>(
  res: Response,
  method: string,
  path: string,
  body?: unknown,
  queryParams?: Record<string, string | number | boolean | undefined>,
  retryCount = 0,
): Promise<T> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    // If auth token is expired/invalid, refresh once and retry transparently.
    if (res.status === 401 && retryCount < 1) {
      try {
        const { data } = await supabase.auth.refreshSession();
        if (data?.session?.access_token) {
          return request<T>(method, path, body, queryParams, retryCount + 1);
        }
      } catch {
        // Fall through to standard error handling.
      }
    }

    const message =
      (data as any)?.message ||
      (data as any)?.error ||
      `Request failed with status ${res.status}`;

    // Record that this session is waiting on an MFA assertion. The app reads
    // `isMfaAssertionPending()` to hold back tenant-scoped work, so without this
    // a screen-mount burst fires into a wall of 403s before the challenge has
    // ever been answered. `clearMfaAssertion` resets the flag, so this cannot
    // latch on past a successful verification.
    if (
      res.status === 403 &&
      (data as any)?.error === MFA_ASSERTION_DENIED
    ) {
      mfaAssertionDenied = true;
    }

    throw new ApiError(
      typeof message === 'string' ? message : JSON.stringify(message),
      res.status,
      data,
    );
  }

  return unwrapEnvelope<T>(data);
}

// ── Convenience Methods ─────────────────────────────────────────

export const api = {
  get: <T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ) => request<T>('GET', path, undefined, query),

  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>('POST', path, body),

  patch: <T = unknown>(path: string, body?: unknown) =>
    request<T>('PATCH', path, body),

  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>('PUT', path, body),

  del: <T = unknown>(path: string) => request<T>('DELETE', path),
};

export async function getCurrentUserId(): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? '';
  } catch {
    return '';
  }
}

export default api;
