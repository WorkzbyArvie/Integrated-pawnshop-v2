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

export const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_CHANGED_VIA_RECOVERY: 'Password changed',
  EMAIL_MFA_ENABLED: 'Email MFA enabled',
  EMAIL_MFA_DISABLED: 'Email MFA disabled',
  SIGN_IN_VERIFIED: 'Sign-in verified',
  SIGN_IN_CODE_FAILED: 'Failed sign-in code',
  RECOVERY_REQUESTED: 'Password reset requested',
};

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

export function describeActivityEvent(event: CredentialActivityEvent): string {
  return ACTIVITY_EVENT_LABELS[event.action] ?? 'Account security event';
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
