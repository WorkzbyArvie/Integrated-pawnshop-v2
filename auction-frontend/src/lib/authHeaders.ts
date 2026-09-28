/**
 * The single header builder for protected auction requests.
 *
 * Authorization, Accept, Content-Type, and the session-bound MFA assertion are
 * constructed here once, so a protected call cannot silently omit the assertion
 * the backend requires before auction content (D-09).
 *
 * The assertion is held in module memory only. It is never written to
 * localStorage, sessionStorage, a URL, or a log, and it is bound to the subject
 * that is currently authenticated so a previous session's assertion can never be
 * replayed (D-02).
 */

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
 * Hold the server-issued MFA assertion. An empty value clears the held
 * assertion rather than storing a blank one.
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
 * Drop a held assertion as soon as the authenticated subject changes. A held
 * assertion is never carried into a new login or a different account, and
 * sign-out leaves nothing behind to replay.
 */
export function bindAssertionToSession(
  userId: string | null,
  authenticated: boolean,
): void {
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

export interface AuthHeaderOptions {
  /** Adds `Content-Type: application/json` for body-bearing requests. */
  json?: boolean;
  /** Subject currently authenticated, used to bind the held assertion. */
  userId?: string | null;
}

/**
 * Build headers for a protected auction request.
 *
 * This is the only supported way to reach an authenticated backend route from
 * the auction client. Public listing reads deliberately bypass this helper and
 * stay unauthenticated.
 */
export function authHeaders(
  accessToken: string | null | undefined,
  options: AuthHeaderOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.json) headers['Content-Type'] = 'application/json';

  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) {
    bindAssertionToSession(null, false);
    return headers;
  }

  bindAssertionToSession(options.userId ?? null, true);
  headers.Authorization = `Bearer ${token}`;

  const assertion = getMfaAssertion();
  if (assertion) {
    headers[MFA_ASSERTION_HEADER] = assertion;
  }

  return headers;
}
