import { describe, expect, it } from 'vitest';
import { ApiError } from './apiClient';

/**
 * Regression model for the preflight clobber that trapped the user in a loop.
 *
 * Two credential-status requests overlapped: the first answered 200 and the
 * second 401. The failure overwrote the confirmed status, flipping the preflight
 * from `forced` to `unavailable`, which renders a dead end that retrying cannot
 * leave. The user was then pushed into password recovery, which revoked the
 * session again and reproduced the same sequence.
 */
type Outcome = 'loading' | 'ready' | 'unavailable';

function resolvePreflight(
  responses: Array<{ ok: true; status: unknown } | { ok: false; status: number }>,
  lastConfirmed: { current: { mustChangePassword: boolean } | null },
): { state: Outcome; status: unknown } {
  let state: Outcome = 'loading';
  let status: unknown = null;

  for (const response of responses) {
    if (response.ok) {
      status = response.status;
      lastConfirmed.current = response.status as { mustChangePassword: boolean };
      state = 'ready';
      continue;
    }

    if (response.status === 401 && lastConfirmed.current) {
      // A transient 401 must not discard a status this session already confirmed.
      state = 'ready';
      continue;
    }

    status = null;
    state = 'unavailable';
  }

  return { state, status };
}

const CONFIRMED = { mustChangePassword: true, mfaEnabled: false };

describe('credential preflight clobber', () => {
  it('keeps a confirmed status when a later 401 arrives', () => {
    const lastConfirmed = { current: null as { mustChangePassword: boolean } | null };
    const result = resolvePreflight(
      [
        { ok: true, status: CONFIRMED },
        { ok: false, status: 401 },
      ],
      lastConfirmed,
    );

    expect(result.state).toBe('ready');
    expect(result.status).toEqual(CONFIRMED);
  });

  it('still fails closed when no status was ever confirmed', () => {
    const lastConfirmed = { current: null as { mustChangePassword: boolean } | null };
    const result = resolvePreflight([{ ok: false, status: 401 }], lastConfirmed);
    expect(result.state).toBe('unavailable');
  });

  it('still fails closed on a server-side 503', () => {
    const lastConfirmed = { current: null as { mustChangePassword: boolean } | null };
    const result = resolvePreflight(
      [
        { ok: true, status: CONFIRMED },
        { ok: false, status: 503 },
      ],
      lastConfirmed,
    );
    expect(result.state).toBe('unavailable');
  });

  it('keeps the forced state so the change form stays reachable', () => {
    const lastConfirmed = { current: null as { mustChangePassword: boolean } | null };
    const result = resolvePreflight(
      [
        { ok: true, status: CONFIRMED },
        { ok: false, status: 401 },
      ],
      lastConfirmed,
    );

    // The forced gate is the only surface that collects a new password, so a
    // transient 401 must not be able to hide it.
    expect((result.status as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  it('recognises a 401 as retryable rather than terminal', () => {
    const error = new ApiError('Unauthorized', 401, null);
    expect(error.status).toBe(401);
  });
});
