import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, SpinnerGap, WarningCircle, XCircle } from '@phosphor-icons/react';
import { PasswordRequirements } from './Auth/PasswordRequirements';
import { isPasswordCompliant } from '../lib/passwordPolicy';
import {
  CREDENTIAL_ERROR_CODES,
  completeMfaEnrollment,
  disableMfa,
  errorCode,
  fetchCredentialStatus,
  fetchSecurityActivity,
  startMfaEnrollment,
  submitPasswordChange,
  type CredentialActivityEvent,
  type CredentialStatus,
} from '../lib/credentialApi';

export const ACCOUNT_SECURITY_COPY = {
  heading: 'Account security',
  current: 'Current',
  changeRequired: 'Change required',
  unavailable: 'Unavailable',
  notEnabled: 'Not enabled',
  setupPending: 'Setup pending',
  enabled: 'Enabled',
  passwordHeading: 'Password',
  changePassword: 'Change password',
  updatePassword: 'Update password',
  updatingPassword: 'Updating password',
  passwordUpdated: 'Password updated successfully',
  passwordFormError:
    "We couldn't update your password. Check the fields below and try again.",
  currentPasswordInvalid: 'Your current password is incorrect. Check it and try again.',
  mfaHeading: 'Email MFA',
  codesGoTo: (masked: string) => `Codes go to ${masked}`,
  mfaExplanation:
    'When enabled, each new sign-in requires a six-digit code sent to this address.',
  enableMfa: 'Enable email MFA',
  disableMfa: 'Disable email MFA',
  mfaEnabled: 'Email MFA is enabled',
  mfaDisabled: 'Email MFA is disabled',
  mfaUnchanged: 'MFA remains enabled. No changes were made.',
  mfaFailed: "We couldn't enable email MFA. Try again.",
  activityHeading: 'Recent security activity',
  activityEmptyHeading: 'No security activity yet',
  activityEmptyBody: 'Password and MFA events for your account will appear here.',
  activityLoadError: "We couldn't load your security activity. Try again.",
  retry: 'Try again',
  keepEnabled: 'Keep email MFA enabled',
  continueLabel: 'Continue',
  currentPasswordPrompt: 'Enter your current password to continue',
  codePrompt: (masked: string) =>
    `We will send a six-digit code to ${masked}. Enter it to turn on two-step sign-in.`,
  disableConfirm:
    'Disable email MFA: This removes the code check from future sign-ins. You can enable it again later.',
  disablePasswordPrompt: 'Enter your current password to continue disabling email MFA.',
  disableCodePrompt: (masked: string) =>
    `We will send a six-digit code to ${masked} to confirm disabling email MFA.`,
  requestCode: 'Request code',
  verifyCode: 'Verify code',
  confirming: 'Confirming',
  codeSent: (masked: string) =>
    `A verification code was sent to ${masked}. Enter it to disable email MFA.`,
  cancel: 'Cancel',
  mismatch: 'Passwords do not match',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  codeLabel: 'Six-digit email verification code',
  currentPasswordLabel: 'Current password',
  newPasswordLabel: 'New password',
  confirmPasswordLabel: 'Confirm new password',
} as const;

const ACTIVITY_LABELS: Record<string, string> = {
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_CHANGED_VIA_RECOVERY: 'Password changed',
  EMAIL_MFA_ENABLED: 'Email MFA enabled',
  EMAIL_MFA_DISABLED: 'Email MFA disabled',
  SIGN_IN_VERIFIED: 'Sign-in verified',
  SIGN_IN_CODE_FAILED: 'Failed sign-in code',
  RECOVERY_REQUESTED: 'Password reset requested',
};

type PasswordStage = 'idle' | 'editing';
type MfaStage =
  | 'idle'
  | 'enable-password'
  | 'enable-code'
  | 'disable-confirm'
  | 'disable-password'
  | 'disable-code';

export interface AccountSecuritySectionProps {
  accessToken: string;
  userId?: string | null;
  email?: string | null;
  onStatusChange?: (status: CredentialStatus | null) => void;
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'muted' }) {
  const color =
    tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--gold)' : 'var(--text-muted)';
  const Icon = tone === 'ok' ? CheckCircle : tone === 'warn' ? WarningCircle : XCircle;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[0.75rem] font-semibold"
      style={{ color }}
    >
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

export function AccountSecuritySection({
  accessToken,
  userId = null,
  email = null,
  onStatusChange,
}: AccountSecuritySectionProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [statusState, setStatusState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [activity, setActivity] = useState<CredentialActivityEvent[]>([]);
  const [activityState, setActivityState] = useState<'loading' | 'ready' | 'error'>('loading');

  const [passwordStage, setPasswordStage] = useState<PasswordStage>('idle');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [mfaStage, setMfaStage] = useState<MfaStage>('idle');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSuccess, setMfaSuccess] = useState<string | null>(null);

  const applyStatus = useCallback(
    (next: CredentialStatus | null) => {
      setStatus(next);
      setStatusState(next ? 'ready' : 'unavailable');
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const loadStatus = useCallback(async () => {
    try {
      applyStatus(await fetchCredentialStatus({ accessToken, userId }));
    } catch {
      applyStatus(null);
    }
  }, [accessToken, applyStatus, userId]);

  const loadActivity = useCallback(async () => {
    setActivityState('loading');
    try {
      setActivity(await fetchSecurityActivity({ accessToken, userId }));
      setActivityState('ready');
    } catch {
      setActivityState('error');
    }
  }, [accessToken, userId]);

  useEffect(() => {
    headingRef.current?.focus();
    void loadStatus();
    void loadActivity();
  }, [loadActivity, loadStatus]);

  const masked = status?.mfaEmailMasked ?? email ?? '';
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSavePassword =
    !savingPassword &&
    !mismatch &&
    currentPassword.length > 0 &&
    isPasswordCompliant(newPassword) &&
    confirmPassword === newPassword;

  const resetMfa = () => {
    setMfaStage('idle');
    setMfaPassword('');
    setMfaCode('');
    setMfaChallengeId('');
    setMfaError(null);
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSavePassword) return;
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(false);
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
      setPasswordSuccess(true);
      setPasswordStage('idle');
      await Promise.all([loadStatus(), loadActivity()]);
    } catch (error) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(
        errorCode(error) === CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID
          ? ACCOUNT_SECURITY_COPY.currentPasswordInvalid
          : ACCOUNT_SECURITY_COPY.passwordFormError,
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const beginEnable = async () => {
    setMfaError(null);
    setMfaPassword('');
    setMfaCode('');
    setMfaStage('enable-password');
  };

  const requestEnableCode = async () => {
    setMfaError(null);
    setMfaBusy(true);
    try {
      const challenge = await startMfaEnrollment({ accessToken, userId, currentPassword: mfaPassword });
      setMfaChallengeId(challenge.challengeId);
      setMfaCode('');
      setMfaStage('enable-code');
    } catch (error) {
      setMfaError(
        errorCode(error) === CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID
          ? ACCOUNT_SECURITY_COPY.currentPasswordInvalid
          : ACCOUNT_SECURITY_COPY.mfaFailed,
      );
      setMfaStage('enable-password');
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmEnable = async () => {
    setMfaError(null);
    setMfaBusy(true);
    try {
      await completeMfaEnrollment({ accessToken, userId, challengeId: mfaChallengeId, code: mfaCode });
      setMfaCode('');
      setMfaPassword('');
      setMfaStage('idle');
      setMfaSuccess(ACCOUNT_SECURITY_COPY.mfaEnabled);
      await Promise.all([loadStatus(), loadActivity()]);
    } catch {
      setMfaCode('');
      setMfaError(ACCOUNT_SECURITY_COPY.mfaFailed);
      setMfaStage('enable-code');
    } finally {
      setMfaBusy(false);
    }
  };

  const requestDisableCode = async () => {
    setMfaError(null);
    setMfaBusy(true);
    try {
      const challenge = await startMfaEnrollment({ accessToken, userId, currentPassword: mfaPassword });
      setMfaChallengeId(challenge.challengeId);
      setMfaCode('');
      setMfaStage('disable-code');
    } catch (error) {
      setMfaError(
        errorCode(error) === CREDENTIAL_ERROR_CODES.CURRENT_PASSWORD_INVALID
          ? ACCOUNT_SECURITY_COPY.currentPasswordInvalid
          : ACCOUNT_SECURITY_COPY.mfaUnchanged,
      );
      setMfaStage('disable-password');
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmDisable = async () => {
    setMfaError(null);
    setMfaBusy(true);
    try {
      await disableMfa({
        accessToken,
        userId,
        currentPassword: mfaPassword,
        challengeId: mfaChallengeId,
        code: mfaCode,
      });
      resetMfa();
      setMfaSuccess(ACCOUNT_SECURITY_COPY.mfaDisabled);
      await Promise.all([loadStatus(), loadActivity()]);
    } catch {
      setMfaCode('');
      setMfaError(ACCOUNT_SECURITY_COPY.mfaUnchanged);
      setMfaStage('disable-code');
    } finally {
      setMfaBusy(false);
    }
  };

  const inputStyle = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
  } as const;

  const primaryStyle = (busy: boolean, disabled = false) => ({
    background: busy || disabled ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
    color: '#0A0A0F',
    borderRadius: 'var(--radius)',
  });

  const secondaryStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-secondary)',
  } as const;

  return (
    <section
      aria-labelledby="account-security-heading"
      data-testid="account-security"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '1.5rem',
        display: 'grid',
        gap: '1.5rem',
      }}
    >
      <h2
        id="account-security-heading"
        ref={headingRef}
        tabIndex={-1}
        className="outline-none"
        style={{ margin: 0, fontSize: '1rem' }}
      >
        {ACCOUNT_SECURITY_COPY.heading}
      </h2>

      {statusState === 'unavailable' && (
        <p role="status" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-muted)' }}>
          {ACCOUNT_SECURITY_COPY.unavailable}
        </p>
      )}

      {passwordSuccess && (
        <p role="status" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--green)' }}>
          {ACCOUNT_SECURITY_COPY.passwordUpdated}
        </p>
      )}

      {mfaSuccess && (
        <p role="status" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--green)' }}>
          {mfaSuccess}
        </p>
      )}

      {/* Password */}
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{ACCOUNT_SECURITY_COPY.passwordHeading}</h3>
          {status ? (
            status.mustChangePassword ? (
              <StatusPill label={ACCOUNT_SECURITY_COPY.changeRequired} tone="warn" />
            ) : (
              <StatusPill label={ACCOUNT_SECURITY_COPY.current} tone="ok" />
            )
          ) : null}
        </div>

        {passwordStage === 'idle' ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setPasswordError(null);
              setPasswordSuccess(false);
              setPasswordStage('editing');
            }}
            style={{ padding: '0.6rem 1rem', fontSize: '0.85rem' }}
          >
            {ACCOUNT_SECURITY_COPY.changePassword}
          </button>
        ) : (
          <form onSubmit={handlePasswordSubmit} style={{ display: 'grid', gap: '0.85rem' }} noValidate>
            {passwordError && (
              <p role="alert" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--red)' }}>
                {passwordError}
              </p>
            )}

            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <label
                htmlFor="as-current-password"
                className="text-[0.75rem] font-semibold uppercase tracking-[0.12em]"
                style={{ color: 'var(--text-muted)' }}
              >
                {ACCOUNT_SECURITY_COPY.currentPasswordLabel}
              </label>
              <input
                id="as-current-password"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                style={{ ...inputStyle, height: '2.75rem', padding: '0 0.85rem', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <label
                htmlFor="as-new-password"
                className="text-[0.75rem] font-semibold uppercase tracking-[0.12em]"
                style={{ color: 'var(--text-muted)' }}
              >
                {ACCOUNT_SECURITY_COPY.newPasswordLabel}
              </label>
              <input
                id="as-new-password"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                aria-describedby="as-password-requirements"
                onChange={(event) => setNewPassword(event.target.value)}
                style={{ ...inputStyle, height: '2.75rem', padding: '0 0.85rem', fontSize: '0.9rem' }}
              />
              <PasswordRequirements value={newPassword} id="as-password-requirements" />
            </div>

            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <label
                htmlFor="as-confirm-password"
                className="text-[0.75rem] font-semibold uppercase tracking-[0.12em]"
                style={{ color: 'var(--text-muted)' }}
              >
                {ACCOUNT_SECURITY_COPY.confirmPasswordLabel}
              </label>
              <input
                id="as-confirm-password"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                aria-invalid={mismatch ? true : undefined}
                aria-describedby={mismatch ? 'as-confirm-error' : undefined}
                onChange={(event) => setConfirmPassword(event.target.value)}
                style={{
                  ...inputStyle,
                  height: '2.75rem',
                  padding: '0 0.85rem',
                  fontSize: '0.9rem',
                  border: mismatch ? '1px solid rgba(212,69,69,0.5)' : inputStyle.border,
                }}
              />
              {mismatch && (
                <p
                  id="as-confirm-error"
                  role="alert"
                  className="text-[0.8rem]"
                  style={{ margin: 0, color: 'var(--red)' }}
                >
                  {ACCOUNT_SECURITY_COPY.mismatch}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              <button
                type="submit"
                disabled={!canSavePassword}
                className="primary-button disabled:opacity-60"
                style={{ ...primaryStyle(savingPassword, !canSavePassword), fontSize: '0.85rem' }}
              >
                {savingPassword ? (
                  <span className="flex items-center gap-2">
                    <SpinnerGap size={14} aria-hidden="true" className="animate-spin" />
                    {ACCOUNT_SECURITY_COPY.updatingPassword}
                  </span>
                ) : (
                  ACCOUNT_SECURITY_COPY.updatePassword
                )}
              </button>
              <button
                type="button"
                onClick={() => setReveal((previous) => !previous)}
                aria-pressed={reveal}
                className="ghost-button"
                style={{ ...secondaryStyle, fontSize: '0.85rem' }}
              >
                {reveal ? ACCOUNT_SECURITY_COPY.hidePassword : ACCOUNT_SECURITY_COPY.showPassword}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordStage('idle');
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordError(null);
                }}
                className="ghost-button"
                style={{ ...secondaryStyle, fontSize: '0.85rem' }}
              >
                {ACCOUNT_SECURITY_COPY.cancel}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Email MFA */}
      <div style={{ display: 'grid', gap: '0.75rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{ACCOUNT_SECURITY_COPY.mfaHeading}</h3>
          {status ? (
            status.mfaEnabled ? (
              <StatusPill label={ACCOUNT_SECURITY_COPY.enabled} tone="ok" />
            ) : (
              <StatusPill label={ACCOUNT_SECURITY_COPY.notEnabled} tone="muted" />
            )
          ) : null}
        </div>

        {status && !status.mfaEnabled && masked && (
          <p className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {ACCOUNT_SECURITY_COPY.codesGoTo(masked)}
          </p>
        )}
        <p className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          {ACCOUNT_SECURITY_COPY.mfaExplanation}
        </p>

        {mfaError && (
          <p role="alert" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--red)' }}>
            {mfaError}
          </p>
        )}

        {mfaStage === 'idle' && (
          <div>
            {status?.mfaEnabled ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setMfaError(null);
                  setMfaSuccess(null);
                  setMfaPassword('');
                  setMfaCode('');
                  setMfaStage('disable-confirm');
                }}
                style={{
                  padding: '0.6rem 1rem',
                  fontSize: '0.85rem',
                  color: 'var(--red)',
                  border: '1px solid rgba(212,69,69,0.2)',
                }}
              >
                {ACCOUNT_SECURITY_COPY.disableMfa}
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={() => void beginEnable()}
                style={{ ...primaryStyle(false), fontSize: '0.85rem' }}
              >
                {ACCOUNT_SECURITY_COPY.enableMfa}
              </button>
            )}
          </div>
        )}

        {mfaStage === 'disable-confirm' && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <p className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {ACCOUNT_SECURITY_COPY.disableConfirm}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={() => setMfaStage('disable-password')}
                className="primary-button"
                style={{ ...primaryStyle(false), fontSize: '0.85rem' }}
              >
                {ACCOUNT_SECURITY_COPY.continueLabel}
              </button>
              <button
                type="button"
                onClick={resetMfa}
                className="ghost-button"
                style={{ ...secondaryStyle, fontSize: '0.85rem' }}
              >
                {ACCOUNT_SECURITY_COPY.keepEnabled}
              </button>
            </div>
          </div>
        )}

        {(mfaStage === 'enable-password' || mfaStage === 'disable-password') && (
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <label
              htmlFor="as-mfa-password"
              className="text-[0.75rem] font-semibold uppercase tracking-[0.12em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {mfaStage === 'enable-password'
                ? ACCOUNT_SECURITY_COPY.currentPasswordPrompt
                : ACCOUNT_SECURITY_COPY.disablePasswordPrompt}
            </label>
            <input
              id="as-mfa-password"
              type="password"
              autoComplete="current-password"
              value={mfaPassword}
              onChange={(event) => setMfaPassword(event.target.value)}
              style={{ ...inputStyle, height: '2.75rem', padding: '0 0.85rem', fontSize: '0.9rem' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              <button
                type="button"
                disabled={mfaPassword.length === 0 || mfaBusy}
                onClick={() =>
                  mfaStage === 'enable-password' ? void requestEnableCode() : void requestDisableCode()
                }
                className="primary-button disabled:opacity-60"
                style={{ ...primaryStyle(mfaBusy, mfaPassword.length === 0), fontSize: '0.85rem' }}
              >
                {mfaBusy ? (
                  <span className="flex items-center gap-2">
                    <SpinnerGap size={14} aria-hidden="true" className="animate-spin" />
                    {ACCOUNT_SECURITY_COPY.confirming}
                  </span>
                ) : (
                  ACCOUNT_SECURITY_COPY.requestCode
                )}
              </button>
              <button
                type="button"
                onClick={resetMfa}
                className="ghost-button"
                style={{ ...secondaryStyle, fontSize: '0.85rem' }}
              >
                {ACCOUNT_SECURITY_COPY.cancel}
              </button>
            </div>
          </div>
        )}

        {(mfaStage === 'enable-code' || mfaStage === 'disable-code') && (
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <p className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {mfaStage === 'enable-code'
                ? ACCOUNT_SECURITY_COPY.codePrompt(masked)
                : ACCOUNT_SECURITY_COPY.disableCodePrompt(masked)}
            </p>
            {masked && (
              <p role="status" className="text-[0.8rem]" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {mfaStage === 'enable-code'
                  ? `A verification code was sent to ${masked}. Enter it to turn on two-step sign-in.`
                  : ACCOUNT_SECURITY_COPY.codeSent(masked)}
              </p>
            )}
            <label
              htmlFor="as-mfa-code"
              className="text-[0.75rem] font-semibold uppercase tracking-[0.12em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {ACCOUNT_SECURITY_COPY.codeLabel}
            </label>
            <input
              id="as-mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{
                ...inputStyle,
                height: '2.75rem',
                padding: '0 0.85rem',
                fontSize: '1.1rem',
                letterSpacing: '0.35em',
                textAlign: 'center',
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              <button
                type="button"
                disabled={mfaCode.length !== 6 || mfaBusy}
                onClick={() => (mfaStage === 'enable-code' ? void confirmEnable() : void confirmDisable())}
                className="primary-button disabled:opacity-60"
                style={{ ...primaryStyle(mfaBusy, mfaCode.length !== 6), fontSize: '0.85rem' }}
              >
                {mfaBusy ? (
                  <span className="flex items-center gap-2">
                    <SpinnerGap size={14} aria-hidden="true" className="animate-spin" />
                    {ACCOUNT_SECURITY_COPY.confirming}
                  </span>
                ) : (
                  ACCOUNT_SECURITY_COPY.verifyCode
                )}
              </button>
              <button
                type="button"
                onClick={resetMfa}
                className="ghost-button"
                style={{ ...secondaryStyle, fontSize: '0.85rem' }}
              >
                {ACCOUNT_SECURITY_COPY.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Activity */}
      <div
        style={{ display: 'grid', gap: '0.6rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}
      >
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{ACCOUNT_SECURITY_COPY.activityHeading}</h3>
        {activityState === 'loading' && (
          <p role="status" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-muted)' }}>
            Loading...
          </p>
        )}
        {activityState === 'error' && (
          <>
            <p role="alert" className="text-[0.85rem]" style={{ margin: 0, color: 'var(--red)' }}>
              {ACCOUNT_SECURITY_COPY.activityLoadError}
            </p>
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="ghost-button"
              style={{ ...secondaryStyle, justifySelf: 'start', fontSize: '0.85rem' }}
            >
              {ACCOUNT_SECURITY_COPY.retry}
            </button>
          </>
        )}
        {activityState === 'ready' && activity.length === 0 && (
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <p className="text-[0.85rem]" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {ACCOUNT_SECURITY_COPY.activityEmptyHeading}
            </p>
            <p className="text-[0.8rem]" style={{ margin: 0, color: 'var(--text-muted)' }}>
              {ACCOUNT_SECURITY_COPY.activityEmptyBody}
            </p>
          </div>
        )}
        {activityState === 'ready' && activity.length > 0 && (
          <ul style={{ display: 'grid', gap: '0.5rem', margin: 0, padding: 0, listStyle: 'none' }}>
            {activity.map((event) => (
              <li
                key={event.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>{ACTIVITY_LABELS[event.action] ?? 'Account security event'}</span>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default AccountSecuritySection;
