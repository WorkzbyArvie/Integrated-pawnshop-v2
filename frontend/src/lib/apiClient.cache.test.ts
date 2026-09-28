import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './apiClient';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}));

const getSession = vi.mocked(supabase.auth.getSession);
const refreshSession = vi.mocked(supabase.auth.refreshSession);

const SESSION = {
  access_token: 'token-123',
  refresh_token: 'refresh-123',
  token_type: 'bearer' as const,
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1' },
} as unknown as Session;

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe('apiClient cache handling', () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: SESSION }, error: null } as never);
    refreshSession.mockReset().mockResolvedValue({ data: { session: SESSION }, error: null } as never);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests authenticated data with no-store so the cache is never revalidated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/security/credential-status');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.cache).toBe('no-store');
  });

  it('returns the payload for a normal 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: { mustChangePassword: true, mfaEnabled: false },
        }),
      ),
    );

    await expect(api.get('/security/credential-status')).resolves.toEqual({
      mustChangePassword: true,
      mfaEnabled: false,
    });
  });

  it('does not throw on a 304 and refetches the body instead', async () => {
    // Regression: a 304 has no body, and `res.ok` is false for it, so the old
    // code threw and the credential preflight reported a false "unavailable".
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(304, null))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          data: { mustChangePassword: false, mfaEnabled: false },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/security/credential-status')).resolves.toEqual({
      mustChangePassword: false,
      mfaEnabled: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forces an uncached refetch when it retries a 304', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(304, null))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/security/credential-status');

    const [, retryInit] = fetchMock.mock.calls[1];
    expect(retryInit.cache).toBe('reload');
  });

  it('surfaces a 503 credential-state failure as a typed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, { success: false, error: 'CREDENTIAL_STATE_UNAVAILABLE' }),
      ),
    );

    await expect(api.get('/security/credential-status')).rejects.toBeInstanceOf(ApiError);
  });

  it('still surfaces a genuine 500 as an error rather than retrying forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/boom')).rejects.toThrow('boom');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unwraps a double-wrapped envelope to the payload', async () => {
    // Regression: a controller returning `{ success, data }` combined with the
    // global wrapping interceptor produced two layers. The client unwrapped one,
    // received the envelope, and the credential preflight read a valid response
    // as an absent security status.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          data: {
            success: true,
            data: { mustChangePassword: true, mfaEnabled: false },
          },
        }),
      ),
    );

    await expect(api.get('/security/credential-status')).resolves.toEqual({
      mustChangePassword: true,
      mfaEnabled: false,
    });
  });

  it('unwraps a single envelope as before', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { success: true, data: { mustChangePassword: false } }),
      ),
    );
    await expect(api.get('/security/credential-status')).resolves.toEqual({
      mustChangePassword: false,
    });
  });

  it('leaves a bare payload untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { id: 7 })));
    await expect(api.get('/plain')).resolves.toEqual({ id: 7 });
  });

  it('unwraps an array payload rather than descending into it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: [1, 2] })),
    );
    await expect(api.get('/list')).resolves.toEqual([1, 2]);
  });

  it('refreshes once and retries a 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/protected')).resolves.toEqual({ ok: 1 });
    expect(refreshSession).toHaveBeenCalled();
  });
});
