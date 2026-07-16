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

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
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
      headers['Authorization'] = `Bearer ${session.access_token}`;
      headers['user-id'] = session.user?.id ?? '';
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

export default api;
