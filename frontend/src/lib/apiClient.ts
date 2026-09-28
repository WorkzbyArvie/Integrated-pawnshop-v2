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

export function clearMfaAssertion(): void {
  mfaAssertion = null;
  mfaAssertionExpiresAt = null;
  mfaAssertionUserId = null;
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
  });

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

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
    throw new ApiError(
      typeof message === 'string' ? message : JSON.stringify(message),
      res.status,
      data,
    );
  }

  // Unwrap the backend's { success, data } response envelope
  if (data && typeof data === 'object' && 'success' in (data as any) && 'data' in (data as any)) {
    return (data as any).data as T;
  }

  return data as T;
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
