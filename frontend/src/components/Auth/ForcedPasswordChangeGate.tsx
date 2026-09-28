import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Loader2, Lock, ShieldAlert } from 'lucide-react';
import {
  CREDENTIAL_COPY,
  maskAccountEmail,
  submitPasswordChange,
  type CredentialStatus,
} from '../../lib/accountSecurity';
import { getApiErrorDetails } from '../../lib/apiClient';
import { getPasswordRuleFailures, PASSWORD_RULE_COPY } from './PasswordRequirements';
import {
  PasswordConfirmField,
  PasswordErrorSummary,
  PasswordField,
} from './PasswordField';

export const GATE_COPY = {
  status: 'Action required: password change',
  heading: 'Update your password to continue',
  explanation:
    'This account was created before the PawnGold security update. Choose a new password to restore access.',
  primary: 'Update password and continue',
  submitting: 'Updating password',
  recovery: 'Use password recovery',
  signOut: 'Sign out',
  platformAccount: 'Platform account',
  noTenant: 'No pawnshop assigned',
  checking: 'Checking account security',
  unavailable: CREDENTIAL_COPY.statusUnavailable,
  retry: 'Try again',
} as const;

export interface CredentialStatusScreenProps {
  onSignOut?: () => void;
  onUseRecovery?: () => void;
  onRetry?: () => void;
}

function StatusFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen w-full overflow-y-auto px-4 py-12 lg:px-6"
      style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-start gap-6">{children}</div>
    </div>
  );
}

export function CredentialStatusLoading({ onSignOut }: CredentialStatusScreenProps) {
  return (
    <StatusFrame>
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.2)' }}
      >
        <Lock size={22} aria-hidden="true" style={{ color: 'var(--gold)' }} />
      </div>
      <p role="status" className="flex items-center gap-2 text-[16px]" style={{ color: 'var(--text-secondary)' }}>
        <Loader2 size={16} aria-hidden="true" className="animate-spin" />
        {GATE_COPY.checking}
      </p>
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
        >
          {GATE_COPY.signOut}
        </button>
      )}
    </StatusFrame>
  );
}

export function CredentialStatusUnavailable({
  onRetry,
  onSignOut,
}: CredentialStatusScreenProps) {
  return (
    <StatusFrame>
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(212,69,69,0.1)', border: '1px solid rgba(212,69,69,0.2)' }}
      >
        <ShieldAlert size={22} aria-hidden="true" style={{ color: 'var(--red)' }} />
      </div>
      <p
        role="alert"
        className="flex items-start gap-2 text-[16px] leading-[1.5]"
        style={{ color: 'var(--red)' }}
      >
        <AlertTriangle size={16} aria-hidden="true" className="mt-1 shrink-0" />
        <span>{GATE_COPY.unavailable}</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="h-11 rounded-[12px] px-4 text-[14px] font-semibold"
            style={{ background: 'var(--gold)', color: '#0A0A0F' }}
          >
            {GATE_COPY.retry}
          </button>
        )}
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
          >
            {GATE_COPY.signOut}
          </button>
        )}
      </div>
    </StatusFrame>
  );
}

export interface ForcedPasswordChangeGateProps {
  status: CredentialStatus;
  displayName?: string | null;
  accountEmail?: string | null;
  tenantName?: string | null;
  isPlatformAccount?: boolean;
  onStatusChanged: () => Promise<CredentialStatus | null>;
  onSignOut: () => void;
  onUseRecovery?: () => void;
}

export function ForcedPasswordChangeGate({
  status,
  displayName,
  accountEmail,
  tenantName,
  isPlatformAccount = false,
  onStatusChanged,
  onSignOut,
  onUseRecovery,
}: ForcedPasswordChangeGateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentPasswordRef = useRef<HTMLDivElement>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notCleared, setNotCleared] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const maskedEmail = maskAccountEmail(accountEmail);
  const tenantContext = isPlatformAccount
    ? GATE_COPY.platformAccount
    : tenantName
      ? `Pawnshop: ${tenantName}`
      : GATE_COPY.noTenant;

  const clearSecrets = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setCurrentPasswordError(null);
    setSummaryMessage(null);
    setNotCleared(false);

    if (currentPassword.length === 0) {
      setCurrentPasswordError('Enter your current password.');
      setSummaryMessage('Enter your current password.');
      return;
    }

    if (getPasswordRuleFailures(newPassword).length > 0) {
      setFieldError('Password requirements are not met.');
      setSummaryMessage('Password requirements are not met.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFieldError(PASSWORD_RULE_COPY.mismatch);
      setSummaryMessage(PASSWORD_RULE_COPY.mismatch);
      return;
    }

    setSubmitting(true);
    try {
      await submitPasswordChange({ currentPassword, newPassword, confirmPassword });
      const refreshed = await onStatusChanged().catch(() => null);

      if (!refreshed || refreshed.mustChangePassword) {
        setNotCleared(true);
        setSummaryMessage(null);
        return;
      }

      clearSecrets();
    } catch (error) {
      const code = getApiErrorDetails(error).code;
      if (code === 'CURRENT_PASSWORD_INVALID') {
        setCurrentPasswordError(CREDENTIAL_COPY.currentPasswordInvalid);
        setSummaryMessage(CREDENTIAL_COPY.currentPasswordInvalid);
        currentPasswordRef.current?.querySelector('input')?.focus();
        return;
      }
      if (code === 'PASSWORD_CONFIRMATION_MISMATCH') {
        setFieldError(PASSWORD_RULE_COPY.mismatch);
        setSummaryMessage(CREDENTIAL_COPY.passwordFormError);
        return;
      }
      setSummaryMessage(CREDENTIAL_COPY.passwordFormError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = () => {
    clearSecrets();
    onSignOut();
  };

  return (
    <div
      className="min-h-screen w-full overflow-y-auto px-4 py-12 lg:px-6"
      data-credential-forced={status.mustChangePassword ? 'required' : 'cleared'}
      style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
    >
      <div className="mx-auto w-full max-w-[720px] space-y-6">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.2)' }}
        >
          <Lock size={22} aria-hidden="true" style={{ color: 'var(--gold)' }} />
        </div>

        <p
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold"
          style={{ background: 'rgba(201,160,92,0.1)', borderColor: 'rgba(201,160,92,0.25)', color: 'var(--gold)' }}
        >
          <ShieldAlert size={14} aria-hidden="true" />
          {GATE_COPY.status}
        </p>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[28px] font-semibold leading-[1.15] outline-none"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {GATE_COPY.heading}
        </h1>

        <p className="text-[16px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
          {GATE_COPY.explanation}
        </p>

        <div
          className="space-y-1 rounded-[12px] border px-4 py-3"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          {displayName ? (
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {displayName}
            </p>
          ) : null}
          {maskedEmail ? (
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              {maskedEmail}
            </p>
          ) : null}
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            {tenantContext}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div ref={currentPasswordRef} className="space-y-2">
            <PasswordField
              id="gateCurrentPassword"
              name="gateCurrentPassword"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              error={currentPasswordError ?? undefined}
              errorSummaryId="gate-password-error-summary"
              helperText="The password on this legacy account."
              showRequirements={false}
              autoComplete="current-password"
              required
            />
            <PasswordField
              id="gateNewPassword"
              name="gateNewPassword"
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              helperText="Use a private password you do not use elsewhere."
              error={fieldError === PASSWORD_RULE_COPY.mismatch ? undefined : fieldError ?? undefined}
              errorSummaryId="gate-password-error-summary"
              autoComplete="new-password"
              required
            />
            <PasswordConfirmField
              id="gateConfirmPassword"
              name="gateConfirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
              error={fieldError === PASSWORD_RULE_COPY.mismatch ? fieldError : undefined}
              errorSummaryId="gate-password-error-summary"
              required
            />
          </div>

          {summaryMessage && (
            <PasswordErrorSummary
              id="gate-password-error-summary"
              message={summaryMessage}
              fieldId={
                currentPasswordError
                  ? 'gateCurrentPassword'
                  : fieldError === PASSWORD_RULE_COPY.mismatch
                    ? 'gateConfirmPassword'
                    : 'gateNewPassword'
              }
            />
          )}

          {notCleared && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border px-3 py-2 text-[16px]"
              style={{ background: 'rgba(212,69,69,0.1)', borderColor: 'rgba(212,69,69,0.2)', color: 'var(--red)' }}
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-1 shrink-0" />
              <span>{CREDENTIAL_COPY.changeNotCleared}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-[12px] text-[14px] font-semibold disabled:opacity-60"
            style={{ background: submitting ? 'rgba(201,160,92,0.5)' : 'var(--gold)', color: '#0A0A0F' }}
          >
            {submitting && <Loader2 size={16} aria-hidden="true" className="mr-2 inline animate-spin" />}
            {submitting ? GATE_COPY.submitting : GATE_COPY.primary}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/reset-password"
            onClick={(event) => {
              if (!onUseRecovery) return;
              event.preventDefault();
              clearSecrets();
              onUseRecovery();
            }}
            className="inline-flex h-11 items-center rounded-[12px] px-1 text-[14px] font-semibold underline"
            style={{ color: 'var(--gold)' }}
          >
            {GATE_COPY.recovery}
          </a>
          <button
            type="button"
            onClick={handleSignOut}
            className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
          >
            {GATE_COPY.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}
