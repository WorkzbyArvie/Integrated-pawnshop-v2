/**
 * Credential-security calls for the auction client.
 *
 * Every request here goes through `authHeaders`, so a protected credential call
 * cannot omit the session-bound MFA assertion the backend requires (D-09). The
 * server owns the password policy and the credential state; this module only
 * projects that state and forwards user input (D-01).
 */

import { getBackendUrl } from './backendUrl';
import { authHeaders, clearMfaAssertion, setMfaAssertion } from './authHeaders';

const backendUrl = getBackendUrl();

export interface CredentialStatus {
  mustChangePassword: boolean;
  reason: string | null;
  markedAt: string | null;
  mfaEnabled: boolean;
  mfaEmailMasked: string | null;
  passwordUpdatedAt: string | null;
}

export interface CredentialActivityEvent {
  id: string;
  action: string;
  success: boolean;
  createdAt: string;
}

export const CREDENTIAL_ERROR_CODES = {
  STATE_UNAVAILABLE: 'CREDENTIAL_STATE_UNAVAILABLE',
  CURRENT_PASSWORD_INVALID: 'CURRENT_PASSWORD_INVALID',
  CONFIRMATION_MISMATCH: 'PASSWORD_CONFIRMATION_MISMATCH',
  UPDATE_FAILED: 'PASSWORD_UPDATE_FAILED',
  VERIFICATION_UNAVAILABLE: 'CREDENTIAL_VERIFICATION_UNAVAILABLE',
} as const;

export const MFA_ERROR_CODES = {
  CHALLENGE_INVALID: 'MFA_CHALLENGE_INVALID',
  CHALLENGE_LOCKED: 'MFA_CHALLENGE_LOCKED',
  CHALLENGE_UNAVAILABLE: 'MFA_CHALLENGE_UNAVAILABLE',
} as const;

export class CredentialApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'CredentialApiError';
    this.status = status;
    this.code = code;
  }
}

function readErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const payload = body as Record<string, unknown>;
  return typeof payload.error === 'string' ? payload.error : undefined;
}

function readMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const payload = body as Record<string, unknown>;
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const candidate = payload.message ?? payload.error ?? data?.message;
  return typeof candidate === 'string' && candidate ? candidate : fallback;
}

/** Unwrap the backend's `{ success, data }` response envelope. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'success' in (body as object) && 'data' in (body as object)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

async function request<T>(
  method: string,
  path: string,
  options: { accessToken?: string | null; userId?: string | null; body?: unknown; authenticated?: boolean } = {},
): Promise<T> {
  const authenticated = options.authenticated !== false;
  const headers = authHeaders(authenticated ? options.accessToken : null, {
    json: options.body !== undefined,
    userId: options.userId ?? null,
  });

  const response = await fetch(`${backendUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new CredentialApiError(
      readMessage(payload, `Request failed with status ${response.status}`),
      response.status,
      readErrorCode(payload),
    );
  }

  return unwrap(payload) as T;
}

export function isCredentialStateUnavailable(error: unknown): boolean {
  return (
    error instanceof CredentialApiError &&
    error.code === CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE
  );
}

export function errorStatus(error: unknown): number {
  if (error instanceof CredentialApiError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof CredentialApiError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function maskAccountEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  return `${local.charAt(0)}${'•'.repeat(Math.max(local.length - 1, 1))}${value.slice(at)}`;
}

export function normalizeCredentialStatus(raw: unknown): CredentialStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.mustChangePassword !== 'boolean') return null;
  return {
    mustChangePassword: value.mustChangePassword,
    reason: typeof value.reason === 'string' ? value.reason : null,
    markedAt: typeof value.markedAt === 'string' ? value.markedAt : null,
    mfaEnabled: value.mfaEnabled === true,
    mfaEmailMasked: typeof value.mfaEmailMasked === 'string' ? value.mfaEmailMasked : null,
    passwordUpdatedAt: typeof value.passwordUpdatedAt === 'string' ? value.passwordUpdatedAt : null,
  };
}

export function fetchCredentialStatus(input: {
  accessToken: string;
  userId?: string | null;
}): Promise<CredentialStatus | null> {
  return request<unknown>('GET', '/security/credential-status', {
    accessToken: input.accessToken,
    userId: input.userId ?? null,
  }).then((raw) => normalizeCredentialStatus(raw));
}

export interface LoginChallenge {
  challengeId: string;
  expiresAt: string | null;
  maskedEmail: string;
}

export interface StartLoginChallengeResult {
  challenge: LoginChallenge;
  assertion: string;
  expiresAt: string | null;
  userId: string | null;
}

function toIsoString(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

/**
 * Start (or restart) the post-password email-MFA challenge.
 *
 * The challenge endpoint is public by design: the bidder has a valid Supabase
 * session but has not yet proven the second factor, so it carries no assertion.
 */
export function startLoginChallenge(email: string): Promise<StartLoginChallengeResult> {
  return request<Record<string, unknown>>(
    'POST',
    '/security/mfa/login-challenge',
    { body: { email }, authenticated: false },
  ).then((raw) => {
    const challengeId = typeof raw?.challengeId === 'string' ? raw.challengeId : '';
    const maskedEmail = typeof raw?.maskedEmail === 'string' ? raw.maskedEmail : '';
    return {
      challenge: { challengeId, expiresAt: toIsoString(raw?.expiresAt), maskedEmail },
      assertion: '',
      expiresAt: null,
      userId: null,
    };
  });
}

/**
 * Verify the emailed code and hold the server-issued assertion for this session.
 * The assertion never leaves module memory (D-02).
 */
export function verifyLoginChallenge(input: {
  accessToken: string;
  userId: string | null;
  challengeId: string;
  code: string;
}): Promise<void> {
  return request<Record<string, unknown>>('POST', '/security/mfa/verify', {
    accessToken: input.accessToken,
    userId: input.userId,
    body: { challengeId: input.challengeId, code: input.code },
  }).then((raw) => {
    const assertion = typeof raw?.assertion === 'string' ? raw.assertion.trim() : '';
    if (!assertion) {
      throw new CredentialApiError('Verification did not return an assertion', 500);
    }
    setMfaAssertion(assertion, {
      expiresAt: toIsoString(raw?.expiresAt),
      userId: input.userId,
    });
  });
}

export function fetchSecurityActivity(input: {
  accessToken: string;
  userId?: string | null;
}): Promise<CredentialActivityEvent[]> {
  return request<unknown>('GET', '/security/activity', {
    accessToken: input.accessToken,
    userId: input.userId ?? null,
  }).then((raw) => {
    const payload = raw as { events?: unknown } | null;
    const events = Array.isArray(payload?.events) ? payload.events : Array.isArray(raw) ? (raw as unknown[]) : [];
    return events
      .filter(
        (event): event is CredentialActivityEvent =>
          Boolean(event) &&
          typeof event === 'object' &&
          typeof (event as CredentialActivityEvent).id === 'string' &&
          typeof (event as CredentialActivityEvent).action === 'string',
      )
      .map((event) => ({
        id: event.id,
        action: event.action,
        success: event.success !== false,
        createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
      }));
  });
}

export function submitPasswordChange(input: {
  accessToken: string;
  userId?: string | null;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  return request<unknown>('POST', '/security/change-password', {
    accessToken: input.accessToken,
    userId: input.userId ?? null,
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      confirmPassword: input.confirmPassword,
    },
  }).then(() => undefined);
}

/**
 * Start MFA enrollment. The user reauthenticates with their current password
 * before any code is issued, so enabling MFA always requires the account
 * password as well as the emailed code (SEC-05).
 */
export function startMfaEnrollment(input: {
  accessToken: string;
  userId?: string | null;
  currentPassword: string;
}): Promise<LoginChallenge> {
  return request<Record<string, unknown>>('POST', '/security/mfa/enable-challenge', {
    accessToken: input.accessToken,
    userId: input.userId ?? null,
    body: { currentPassword: input.currentPassword },
  }).then((raw) => ({
    challengeId: typeof raw?.challengeId === 'string' ? raw.challengeId : '',
    expiresAt: toIsoString(raw?.expiresAt),
    maskedEmail: typeof raw?.maskedEmail === 'string' ? raw.maskedEmail : '',
  }));
}

/** Complete MFA enrollment. On success the server turns MFA on. */
export function completeMfaEnrollment(input: {
  accessToken: string;
  userId?: string | null;
  challengeId: string;
  code: string;
}): Promise<void> {
  return request<Record<string, unknown>>('POST', '/security/mfa/verify', {
    accessToken: input.accessToken,
    userId: input.userId ?? null,
    body: { challengeId: input.challengeId, code: input.code },
  }).then((raw) => {
    // Enrollment also returns an assertion; hold it so the current session is
    // not immediately challenged by the MFA it just enabled.
    const assertion = typeof raw?.assertion === 'string' ? raw.assertion.trim() : '';
    if (assertion) {
      setMfaAssertion(assertion, { expiresAt: toIsoString(raw?.expiresAt), userId: input.userId ?? null });
    }
  });
}

/**
 * Disable MFA. Requires the current password and the emailed code together, so
 * the action cannot be completed by a stolen session alone.
 */
export function disableMfa(input: {
  accessToken: string;
  userId?: string | null;
  currentPassword: string;
  challengeId?: string;
  code?: string;
}): Promise<void> {
  return request<unknown>('POST', '/security/mfa/disable', {
    accessToken: input.accessToken,
    userId: input.userId ?? null,
    body: {
      currentPassword: input.currentPassword,
      ...(input.challengeId ? { challengeId: input.challengeId } : {}),
      ...(input.code ? { code: input.code } : {}),
    },
  }).then(() => undefined);
}

export { clearMfaAssertion };
