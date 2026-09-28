import { useCallback, useRef, useState } from 'react';
import { Warning, SpinnerGap } from '@phosphor-icons/react';
import { PasswordRequirements } from './PasswordRequirements';
import { isPasswordCompliant } from '../../lib/passwordPolicy';
import {
  CREDENTIAL_ERROR_CODES,
  errorCode,
  submitPasswordChange,
} from '../../lib/credentialApi';

export const FORCED_GATE_COPY = {
  heading: 'Update your password to continue',
  badge: 'Action required: password change',
  explanation:
    'This account was created before the PawnGold security update. Choose a new password to restore access.',
  submit: 'Update password and continue',
  submitting: 'Updating password',
  signOut: 'Sign out',
  currentPasswordLabel: 'Current password',
  newPasswordLabel: 'New password',
  confirmPasswordLabel: 'Confirm new password',
  mismatch: 'Passwords do not match',
  currentPasswordInvalid: 'Your current password is incorrect. Check it and try again.',
  formError:
    "We couldn't update your password. Check the fields below and try again.",
  notCleared: 'Your password change has not cleared yet. Try again.',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
} as const;

export interface ForcedPasswordChangeGateProps {
  accessToken: string;
  userId?: string | null;
  onChanged: () => void | Promise<void>;
  onSignOut: () => void;
}

/**
 * Blocking forced-password-change gate (SEC-03).
 *
 * Full viewport, non-dismissible, and the only thing mounted while the server
 * reports `mustChangePassword`. There is no close control and no path to auction
 * content until the server clears the flag (D-05).
 */
export function ForcedPasswordChangeGate({
  accessToken,
  userId = null,
  onChanged,
  onSignOut,
}: ForcedPasswordChangeGateProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    !submitting &&
    !mismatch &&
    currentPassword.length > 0 &&
    isPasswordCompliant(newPassword) &&
    confirmPassword === newPassword;

  const focusErrors = useCallback(() => {
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setFormError(null);
      try {
        await submitPasswordChange({
          accessToken,
          userId,
          currentPassword,
          newPassword,
          confirmPassword,
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setSubmitting(false);
        await onChanged();
      } catch (error) {
        setSubmitting(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setFormError(
          errorCode(error) === CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID
            ? FORCED_GATE_COPY.currentPasswordInvalid
            : FORCED_GATE_COPY.formError,
        );
        focusErrors();
      }
    },
    [accessToken, canSubmit, confirmPassword, currentPassword, focusErrors, newPassword, onChanged, userId],
  );

  const fieldStyle = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
  } as const;

  return (
    <div
      data-forced-gate="required"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-gate-heading"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col items-start gap-6 py-8">
        <p
          className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em]"
          style={{
            background: 'rgba(201,160,92,0.1)',
            border: '1px solid rgba(201,160,92,0.2)',
            borderRadius: 999,
            color: 'var(--gold)',
          }}
        >
          <Warning size={14} aria-hidden="true" />
          {FORCED_GATE_COPY.badge}
        </p>

        <div className="flex flex-col gap-3">
          <h1
            id="forced-gate-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-[28px] font-semibold leading-[1.15] outline-none"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {FORCED_GATE_COPY.heading}
          </h1>
          <p className="text-[16px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            {FORCED_GATE_COPY.explanation}
          </p>
        </div>

        {formError && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="w-full px-3 py-2 text-[15px] outline-none"
            style={{
              background: 'rgba(212,69,69,0.1)',
              border: '1px solid rgba(212,69,69,0.2)',
              borderRadius: 'var(--radius)',
              color: 'var(--red)',
            }}
          >
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5" noValidate>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="forced-current-password"
              className="text-[13px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {FORCED_GATE_COPY.currentPasswordLabel}
            </label>
            <input
              id="forced-current-password"
              name="currentPassword"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="h-12 w-full px-4 text-[15px]"
              style={fieldStyle}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="forced-new-password"
              className="text-[13px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {FORCED_GATE_COPY.newPasswordLabel}
            </label>
            <input
              id="forced-new-password"
              name="newPassword"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              aria-describedby="forced-password-requirements"
              aria-invalid={mismatch ? true : undefined}
              onChange={(event) => setNewPassword(event.target.value)}
              className="h-12 w-full px-4 text-[15px]"
              style={fieldStyle}
            />
            <PasswordRequirements value={newPassword} id="forced-password-requirements" />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="forced-confirm-password"
              className="text-[13px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {FORCED_GATE_COPY.confirmPasswordLabel}
            </label>
            <input
              id="forced-confirm-password"
              name="confirmPassword"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              aria-invalid={mismatch ? true : undefined}
              aria-describedby={mismatch ? 'forced-confirm-error' : undefined}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="h-12 w-full px-4 text-[15px]"
              style={{
                ...fieldStyle,
                border: mismatch ? '1px solid rgba(212,69,69,0.5)' : fieldStyle.border,
              }}
            />
            {mismatch && (
              <p id="forced-confirm-error" role="alert" className="text-[13px]" style={{ color: 'var(--red)' }}>
                {FORCED_GATE_COPY.mismatch}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-11 px-5 text-[14px] font-semibold disabled:opacity-60"
              style={{
                background: submitting ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                color: '#0A0A0F',
                borderRadius: 'var(--radius)',
              }}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <SpinnerGap size={16} aria-hidden="true" className="animate-spin" />
                  {FORCED_GATE_COPY.submitting}
                </span>
              ) : (
                FORCED_GATE_COPY.submit
              )}
            </button>
            <button
              type="button"
              onClick={() => setReveal((previous) => !previous)}
              aria-pressed={reveal}
              className="h-11 px-4 text-[14px] font-medium"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)',
                color: 'var(--text-secondary)',
              }}
            >
              {reveal ? FORCED_GATE_COPY.hidePassword : FORCED_GATE_COPY.showPassword}
            </button>
          </div>
        </form>

        <button
          type="button"
          onClick={onSignOut}
          className="h-11 px-4 text-[14px] font-medium"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)',
            color: 'var(--text-secondary)',
          }}
        >
          {FORCED_GATE_COPY.signOut}
        </button>
      </div>
    </div>
  );
}

export default ForcedPasswordChangeGate;
