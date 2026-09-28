import api, { getApiErrorDetails } from './apiClient';

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

export const CREDENTIAL_COPY = {
  statusUnavailable:
    "We couldn't confirm your account security status. Try again before continuing.",
  statusChecking: 'Checking account security',
  passwordFormError:
    "We couldn't update your password. Check the fields below and try again.",
  passwordChanged: 'Password updated successfully',
  activityLoadError: "We couldn't load your security activity. Try again.",
  activityEmptyHeading: 'No security activity yet',
  activityEmptyBody: 'Password and MFA events for your account will appear here.',
  retry: 'Try again',
  currentPasswordInvalid: 'Your current password is incorrect. Check it and try again.',
  changeNotCleared: 'Your password change has not cleared yet. Try again.',
} as const;

/**
 * The nine action strings the backend actually writes.
 *
 * This table was previously keyed on a naming scheme that was never implemented
 * on the server -- EMAIL_MFA_ENABLED, SIGN_IN_VERIFIED, RECOVERY_REQUESTED and
 * the rest appear nowhere in the backend. Every one of those keys was dead, and
 * seven of the nine real actions had no entry, so the whole list fell through to
 * the generic fallback and read "Account security event" for every row.
 *
 * Keys are asserted against SECURITY_LOG_ACTIONS in
 * security-log-actions.single-source.spec.ts, which fails if the server adds or
 * renames an action without this map following it.
 */
export const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_CHANGED_VIA_RECOVERY: 'Password changed via recovery link',
  ADMIN_PASSWORD_RESET: 'Password reset by an administrator',
  MFA_ENROLLMENT_STARTED: 'MFA setup started',
  MFA_ENABLED: 'Email MFA enabled',
  MFA_VERIFICATION_FAILED: 'Failed MFA code',
  MFA_LOGIN_VERIFIED: 'Sign-in verified',
  MFA_DISABLED: 'Email MFA disabled',
  MFA_LOCKED: 'Account locked after too many failed codes',
};

/**
 * Which outcome an action represents.
 *
 * `success` on the event only says whether the underlying call resolved, so a
 * refused MFA code and a completed sign-in both arrive with it set. Severity is
 * derived from the action instead, which is what decides whether the row reads
 * as routine or as something the owner needs to look at.
 */
export type ActivitySeverity = 'routine' | 'notable' | 'critical';

export const ACTIVITY_SEVERITY: Record<string, ActivitySeverity> = {
  PASSWORD_CHANGED: 'routine',
  PASSWORD_CHANGED_VIA_RECOVERY: 'notable',
  ADMIN_PASSWORD_RESET: 'critical',
  MFA_ENROLLMENT_STARTED: 'routine',
  MFA_ENABLED: 'notable',
  MFA_VERIFICATION_FAILED: 'critical',
  MFA_LOGIN_VERIFIED: 'routine',
  MFA_DISABLED: 'notable',
  MFA_LOCKED: 'critical',
};

/**
 * Human-readable fallback for an action with no label yet.
 *
 * Echoing the raw action is deliberate. "Account security event" is a claim
 * that something happened without saying what, which in a security log is worse
 * than useless -- it looks like evidence while carrying no information. The raw
 * code at least lets whoever reads it look it up.
 */
export function describeActivityEvent(event: CredentialActivityEvent): string {
  const label = ACTIVITY_EVENT_LABELS[event.action];
  if (label) return label;
  const code = event.action.replace(/_/g, ' ').toLowerCase().trim();
  return `Unrecognised event (${code || 'no action recorded'})`;
}

const SEVERITY_RANK: Record<ActivitySeverity, number> = {
  routine: 0,
  notable: 1,
  critical: 2,
};

/**
 * An action that did not complete is never routine, whatever the action itself
 * normally is. A refused password change and a verified sign-in share the
 * routine classification by action, and only the outcome distinguishes them, so
 * the failure is escalated rather than letting the table's value win outright.
 */
export function activitySeverity(event: CredentialActivityEvent): ActivitySeverity {
  const byAction = ACTIVITY_SEVERITY[event.action] ?? 'routine';
  const byOutcome: ActivitySeverity = event.success === false ? 'notable' : 'routine';
  return SEVERITY_RANK[byAction] >= SEVERITY_RANK[byOutcome] ? byAction : byOutcome;
}

export type CredentialAccess =
  | 'loading'
  | 'unavailable'
  | 'forced'
  | 'clear';

export function resolveCredentialAccess(input: {
  state: 'loading' | 'ready' | 'unavailable';
  status: CredentialStatus | null;
}): CredentialAccess {
  if (input.state === 'loading') return 'loading';
  if (input.state === 'unavailable' || !input.status) return 'unavailable';
  return input.status.mustChangePassword ? 'forced' : 'clear';
}

export function isCredentialStateUnavailable(error: unknown): boolean {
  return getApiErrorDetails(error).code === CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE;
}

export function maskAccountEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  return `${local.charAt(0)}${'•'.repeat(Math.max(local.length - 1, 1))}${value.slice(at)}`;
}

export function formatSecurityTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  return parsed.toLocaleString();
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
    passwordUpdatedAt:
      typeof value.passwordUpdatedAt === 'string' ? value.passwordUpdatedAt : null,
  };
}

export async function fetchCredentialStatus(): Promise<CredentialStatus | null> {
  const raw = await api.get<unknown>('/security/credential-status');
  return normalizeCredentialStatus(raw);
}

export async function fetchSecurityActivity(): Promise<CredentialActivityEvent[]> {
  const raw = await api.get<unknown>('/security/activity');
  const payload = raw as any;
  const events: unknown[] = Array.isArray(payload?.events)
    ? payload.events
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
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
      createdAt:
        typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
    }));
}

export async function submitPasswordChange(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  await api.post('/security/change-password', input);
}

export async function completeRecovery(input: {
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  await api.post('/security/recovery/complete', input);
}
