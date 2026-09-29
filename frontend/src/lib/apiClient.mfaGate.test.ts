import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  clearMfaAssertion,
  isMfaAssertionPending,
  markMfaAssertionPending,
  MFA_ASSERTION_HEADER,
  setMfaAssertion,
} from './apiClient';

/**
 * While a session is waiting on an MFA assertion the server answers every
 * protected route with the same 403. These tests pin the client-side decision to
 * stop asking, because the alternative - firing anyway - is what produced the
 * 403 storm on first paint and, with a retrying caller, the verify throttle.
 */

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
});

const session = {
  access_token: 'token-1',
  user: { id: 'u-1' },
};

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      // A real session is required for any auth header to be attached at all -
      // `getHeaders` only carries the assertion on the authenticated branch, so
      // a null session here would silently pass a test that asserts on headers.
      getSession: () => Promise.resolve({ data: { session } }),
      refreshSession: () => Promise.resolve({ data: { session } }),
    },
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
  },
}));

const { api } = await import('./apiClient');

function ok(body: unknown = { success: true, data: {} }): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function mfaDenial(): Response {
  return {
    ok: false,
    status: 403,
    json: () =>
      Promise.resolve({
        success: false,
        error: 'MFA_VERIFICATION_REQUIRED',
        reason: 'assertion',
        message: 'Multi-factor verification is required for this account.',
      }),
  } as unknown as Response;
}

describe('MFA-gated request short-circuit', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearMfaAssertion();
  });

  it('does not reach the network for a protected route while MFA is pending', async () => {
    markMfaAssertionPending(true);
    mockFetch.mockResolvedValue(ok());

    await expect(api.get('/analytics/branch-activity')).rejects.toBeInstanceOf(ApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports the same error code the server would, so callers can branch', async () => {
    markMfaAssertionPending(true);

    await expect(api.get('/profile/session-context')).rejects.toMatchObject({
      status: 403,
      code: 'MFA_VERIFICATION_REQUIRED',
    });
  });

  it('still reaches the server for the MFA recovery routes', async () => {
    markMfaAssertionPending(true);
    mockFetch.mockResolvedValue(ok({ challengeId: 'c-1' }));

    // Without this the user could never get in: the challenge and the status
    // read that reports `mfaEnabled` are the two calls that have to work while
    // the assertion is still missing.
    await expect(api.post('/security/mfa/login-challenge', { email: 'a@b.test' })).resolves.toBeDefined();
    await expect(api.get('/security/credential-status')).resolves.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends the assertion again once verification succeeds', async () => {
    markMfaAssertionPending(true);
    setMfaAssertion('assertion-abc', { userId: 'u-1' });
    mockFetch.mockResolvedValue(ok());

    await expect(api.get('/analytics/branch-activity')).resolves.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers[MFA_ASSERTION_HEADER]).toBe('assertion-abc');
  });

  it('clears the pending state when the assertion is discarded', () => {
    markMfaAssertionPending(true);
    expect(isMfaAssertionPending()).toBe(true);

    clearMfaAssertion();
    expect(isMfaAssertionPending()).toBe(false);
  });

  it('latches pending from a real 403 even when nothing declared it up front', async () => {
    mockFetch.mockResolvedValue(mfaDenial());

    await expect(api.get('/tenant-governance/branding')).rejects.toBeInstanceOf(ApiError);
    // Second call is refused locally, which is the whole point.
    mockFetch.mockClear();
    await expect(api.get('/tenant-governance/branding')).rejects.toBeInstanceOf(ApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not latch on a 403 that is not an MFA denial', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          success: false,
          error: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must set a new password before continuing.',
        }),
    } as unknown as Response);

    await expect(api.get('/profile/session-context')).rejects.toBeInstanceOf(ApiError);
    expect(isMfaAssertionPending()).toBe(false);
  });

  it('stays clear for a session whose account has MFA off', () => {
    markMfaAssertionPending(false);
    expect(isMfaAssertionPending()).toBe(false);
  });
});
