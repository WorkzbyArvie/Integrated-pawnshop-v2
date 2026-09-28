import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Lock,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import {
  CREDENTIAL_COPY,
  fetchCredentialStatus,
  fetchSecurityActivity,
  formatSecurityTimestamp,
  maskAccountEmail,
  describeActivityEvent,
  activitySeverity,
  submitPasswordChange,
  type CredentialActivityEvent,
  type CredentialStatus,
} from '../lib/accountSecurity';
import { clearMfaAssertion, getApiErrorDetails } from '../lib/apiClient';
import { getPasswordRuleFailures, PASSWORD_RULE_COPY } from '../components/Auth/PasswordRequirements';
import {
  PasswordConfirmField,
  PasswordErrorSummary,
  PasswordField,
} from '../components/Auth/PasswordField';
import { MfaSetupDialog, type MfaDialogMode } from '../components/Auth/MfaSetupDialog';

export const ACCOUNT_SECURITY_COPY = {
  heading: 'Account security',
  explanation: 'Review your own password and security activity for this account.',
  passwordHeading: 'Password',
  changePassword: 'Change password',
  updatePassword: 'Update password',
  updatingPassword: 'Updating password',
  mfaHeading: 'Email MFA',
  mfaExplanation:
    'When enabled, each new sign-in requires a six-digit code sent to this address.',
  mfaNotEnabled: 'Not enabled',
  mfaEnabled: 'Enabled',
  mfaSetupPending: 'Setup pending',
  enableMfa: 'Enable email MFA',
  disableMfa: 'Disable email MFA',
  statusCurrent: 'Current',
  statusChangeRequired: 'Change required',
  statusUnavailable: 'Unavailable',
  activityHeading: 'Recent security activity',
  lastChanged: 'Last changed',
  neverChanged: 'No recorded change yet',
} as const;

export interface AccountSecurityPageProps {
  displayName?: string | null;
  accountEmail?: string | null;
  tenantName?: string | null;
  role?: string;
  onSignOut?: () => void;
}

export function AccountSecurityPage({
  displayName,
  accountEmail,
  tenantName,
  role,
  onSignOut,
}: AccountSecurityPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passwordSectionRef = useRef<HTMLHeadingElement>(null);
  const changeTriggerRef = useRef<HTMLButtonElement>(null);
  const mfaTriggerRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [activity, setActivity] = useState<CredentialActivityEvent[] | null>(null);
  const [activityFailed, setActivityFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [changed, setChanged] = useState(false);
  const [mfaDialogMode, setMfaDialogMode] = useState<MfaDialogMode | null>(null);
  const [mfaEnrollmentPending, setMfaEnrollmentPending] = useState(false);

  const maskedEmail = maskAccountEmail(accountEmail);

  const loadStatus = useCallback(async () => {
    try {
      const next = await fetchCredentialStatus();
      setStatus(next);
      setStatusFailed(!next);
    } catch {
      setStatus(null);
      setStatusFailed(true);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const events = await fetchSecurityActivity();
      setActivity(events);
      setActivityFailed(false);
    } catch {
      setActivity(null);
      setActivityFailed(true);
    }
  }, []);

  useEffect(() => {
    if (editing || !changed) return;
    changeTriggerRef.current?.focus();
  }, [editing, changed]);

  useEffect(() => {
    headingRef.current?.focus();
    void loadStatus();
    void loadActivity();
  }, [loadStatus, loadActivity]);

  const clearSecrets = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const closeEditor = (returnFocus = false) => {
    clearSecrets();
    setEditing(false);
    setSummaryMessage(null);
    setFieldError(null);
    setCurrentPasswordError(null);
    if (returnFocus) {
      window.requestAnimationFrame(() => changeTriggerRef.current?.focus());
      passwordSectionRef.current?.focus();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSummaryMessage(null);
    setFieldError(null);
    setCurrentPasswordError(null);

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
      clearSecrets();
      setEditing(false);
      setChanged(true);
      await Promise.all([loadStatus(), loadActivity()]);
    } catch (error) {
      const code = getApiErrorDetails(error).code;
      if (code === 'CURRENT_PASSWORD_INVALID') {
        setCurrentPasswordError(CREDENTIAL_COPY.currentPasswordInvalid);
        setSummaryMessage(CREDENTIAL_COPY.currentPasswordInvalid);
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

  const openMfaDialog = (mode: MfaDialogMode) => {
    if (statusFailed || !status) return;
    setMfaEnrollmentPending(mode === 'enable');
    setMfaDialogMode(mode);
  };

  const closeMfaDialog = (returnFocus = false) => {
    setMfaDialogMode(null);
    setMfaEnrollmentPending(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => mfaTriggerRef.current?.focus());
    }
  };

  const handleMfaCompleted = async () => {
    await Promise.all([loadStatus(), loadActivity()]);
    closeMfaDialog(true);
  };

  const handleSignOut = () => {
    clearMfaAssertion();
    onSignOut?.();
  };

  const passwordStatusLabel = statusFailed
    ? ACCOUNT_SECURITY_COPY.statusUnavailable
    : status?.mustChangePassword
      ? ACCOUNT_SECURITY_COPY.statusChangeRequired
      : ACCOUNT_SECURITY_COPY.statusCurrent;

  const mfaStatusLabel = statusFailed
    ? ACCOUNT_SECURITY_COPY.statusUnavailable
    : status?.mfaEnabled
      ? ACCOUNT_SECURITY_COPY.mfaEnabled
      : mfaEnrollmentPending
        ? ACCOUNT_SECURITY_COPY.mfaSetupPending
        : ACCOUNT_SECURITY_COPY.mfaNotEnabled;

  return (
    <div
      className="mx-auto w-full max-w-[1600px] space-y-8 px-6 lg:px-8"
      style={{ color: 'var(--text-primary)' }}
    >
      <header className="space-y-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[28px] font-semibold leading-[1.15] outline-none"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {ACCOUNT_SECURITY_COPY.heading}
        </h1>
        <p className="text-[16px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
          {ACCOUNT_SECURITY_COPY.explanation}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[14px]">
          {displayName ? (
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {displayName}
            </span>
          ) : null}
          {maskedEmail ? <span style={{ color: 'var(--text-secondary)' }}>{maskedEmail}</span> : null}
          {tenantName ? (
            <span style={{ color: 'var(--text-muted)' }}>Pawnshop: {tenantName}</span>
          ) : null}
          {role ? <span style={{ color: 'var(--text-muted)' }}>{role}</span> : null}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section
          className="space-y-4 rounded-[16px] border p-6"
          style={{ background: 'var(--bg-surface)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              ref={passwordSectionRef}
              tabIndex={-1}
              className="text-[20px] font-semibold outline-none"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {ACCOUNT_SECURITY_COPY.passwordHeading}
            </h2>
            <span
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold"
              style={{ borderColor: 'rgba(201,160,92,0.25)', color: 'var(--text-secondary)' }}
            >
              {statusFailed ? (
                <ShieldX size={14} aria-hidden="true" style={{ color: 'var(--red)' }} />
              ) : status?.mustChangePassword ? (
                <ShieldX size={14} aria-hidden="true" style={{ color: 'var(--gold)' }} />
              ) : (
                <CheckCircle2 size={14} aria-hidden="true" style={{ color: 'var(--green)' }} />
              )}
              {passwordStatusLabel}
            </span>
          </div>

          {statusFailed ? (
            <div className="space-y-3">
              <p
                role="alert"
                className="flex items-start gap-2 text-[14px]"
                style={{ color: 'var(--red)' }}
              >
                <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{CREDENTIAL_COPY.statusUnavailable}</span>
              </p>
              <button
                type="button"
                onClick={() => void loadStatus()}
                className="h-11 rounded-[12px] px-4 text-[14px] font-semibold"
                style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.25)', color: 'var(--gold)' }}
              >
                {CREDENTIAL_COPY.retry}
              </button>
            </div>
          ) : (
            <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
              {ACCOUNT_SECURITY_COPY.lastChanged}:{' '}
              {status?.passwordUpdatedAt
                ? formatSecurityTimestamp(status.passwordUpdatedAt)
                : ACCOUNT_SECURITY_COPY.neverChanged}
            </p>
          )}

          {changed && (
            <p
              role="status"
              className="flex items-start gap-2 text-[14px]"
              style={{ color: 'var(--green)' }}
            >
              <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{CREDENTIAL_COPY.passwordChanged}</span>
            </p>
          )}

          {!editing ? (
            <button
              ref={changeTriggerRef}
              type="button"
              onClick={() => {
                setChanged(false);
                setEditing(true);
              }}
              disabled={statusFailed}
              className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--gold)', color: '#0A0A0F' }}
            >
              {ACCOUNT_SECURITY_COPY.changePassword}
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordField
                id="accountCurrentPassword"
                name="accountCurrentPassword"
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                error={currentPasswordError ?? undefined}
                errorSummaryId="account-password-error-summary"
                helperText="The password currently on this account."
                showRequirements={false}
                autoComplete="current-password"
                required
              />
              <PasswordField
                id="accountNewPassword"
                name="accountNewPassword"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                helperText="Use a private password you do not use elsewhere."
                error={fieldError === PASSWORD_RULE_COPY.mismatch ? undefined : fieldError ?? undefined}
                errorSummaryId="account-password-error-summary"
                autoComplete="new-password"
                required
              />
              <PasswordConfirmField
                id="accountConfirmPassword"
                name="accountConfirmPassword"
                value={confirmPassword}
                onChange={setConfirmPassword}
                error={fieldError === PASSWORD_RULE_COPY.mismatch ? fieldError : undefined}
                errorSummaryId="account-password-error-summary"
                required
              />

              {summaryMessage && (
                <PasswordErrorSummary
                  id="account-password-error-summary"
                  message={summaryMessage}
                  fieldId={
                    currentPasswordError
                      ? 'accountCurrentPassword'
                      : fieldError === PASSWORD_RULE_COPY.mismatch
                        ? 'accountConfirmPassword'
                        : 'accountNewPassword'
                  }
                />
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
                  style={{ background: submitting ? 'rgba(201,160,92,0.5)' : 'var(--gold)', color: '#0A0A0F' }}
                >
                  {submitting && (
                    <Loader2 size={16} aria-hidden="true" className="mr-2 inline animate-spin" />
                  )}
                  {submitting
                    ? ACCOUNT_SECURITY_COPY.updatingPassword
                    : ACCOUNT_SECURITY_COPY.updatePassword}
                </button>
                <button
                  type="button"
                  onClick={() => closeEditor(true)}
                  className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>

        <section
          className="space-y-4 rounded-[16px] border p-6"
          style={{ background: 'var(--bg-surface)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[20px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              {ACCOUNT_SECURITY_COPY.mfaHeading}
            </h2>
            <span
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold"
              style={{ borderColor: 'rgba(201,160,92,0.25)', color: 'var(--text-secondary)' }}
            >
              {status?.mfaEnabled ? (
                <ShieldCheck size={14} aria-hidden="true" style={{ color: 'var(--green)' }} />
              ) : (
                <Circle size={14} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
              )}
              {mfaStatusLabel}
            </span>
          </div>
          {status?.mfaEmailMasked ? (
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              Codes go to {status.mfaEmailMasked}
            </p>
          ) : null}
          <p className="text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            {ACCOUNT_SECURITY_COPY.mfaExplanation}
          </p>
          {status && !statusFailed ? (
            <button
              ref={mfaTriggerRef}
              type="button"
              onClick={() => openMfaDialog(status.mfaEnabled ? 'disable' : 'enable')}
              className="h-11 rounded-[12px] px-4 text-[14px] font-semibold"
              style={
                status.mfaEnabled
                  ? {
                      background: 'rgba(212,69,69,0.12)',
                      border: '1px solid rgba(212,69,69,0.35)',
                      color: 'var(--red)',
                    }
                  : { background: 'var(--gold)', color: '#0A0A0F' }
              }
            >
              {status.mfaEnabled
                ? ACCOUNT_SECURITY_COPY.disableMfa
                : ACCOUNT_SECURITY_COPY.enableMfa}
            </button>
          ) : null}
        </section>
      </div>

      <section
        className="space-y-4 rounded-[16px] border p-6"
        style={{ background: 'var(--bg-surface)', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <h2 className="text-[20px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
          {ACCOUNT_SECURITY_COPY.activityHeading}
        </h2>

        {activityFailed ? (
          <div className="space-y-3">
            <p
              role="alert"
              className="flex items-start gap-2 text-[14px]"
              style={{ color: 'var(--red)' }}
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{CREDENTIAL_COPY.activityLoadError}</span>
            </p>
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="h-11 rounded-[12px] px-4 text-[14px] font-semibold"
              style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.25)', color: 'var(--gold)' }}
            >
              {CREDENTIAL_COPY.retry}
            </button>
          </div>
        ) : activity === null ? (
          <p className="flex items-center gap-2 text-[14px]" style={{ color: 'var(--text-muted)' }} role="status">
            <Loader2 size={16} aria-hidden="true" className="animate-spin" />
            {CREDENTIAL_COPY.statusChecking}
          </p>
        ) : activity.length === 0 ? (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              <Lock size={14} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
              {CREDENTIAL_COPY.activityEmptyHeading}
            </p>
            <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
              {CREDENTIAL_COPY.activityEmptyBody}
            </p>
          </div>
        ) : (
          <ol className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {activity.map((event) => {
              // Severity is spelled out in words as well as carried by the icon
              // and colour, so the distinction survives a screen reader and a
              // monochrome display. Colour alone would not.
              const severity = activitySeverity(event);
              const tone =
                severity === 'critical'
                  ? { color: 'var(--red)', label: 'Needs attention' }
                  : severity === 'notable'
                    ? { color: 'var(--gold, #C9A05C)', label: 'Security change' }
                    : { color: 'var(--green)', label: 'Routine' };

              return (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-2"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  <span className="flex items-center gap-2 text-[14px]" style={{ color: 'var(--text-primary)' }}>
                    {event.success && severity === 'routine' ? (
                      <CheckCircle2 size={14} aria-hidden="true" style={{ color: tone.color }} />
                    ) : (
                      <AlertTriangle size={14} aria-hidden="true" style={{ color: tone.color }} />
                    )}
                    {describeActivityEvent(event)}
                    {!event.success && (
                      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--red)' }}>
                        Did not complete
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: tone.color }}
                    >
                      {tone.label}
                    </span>
                    <time
                      dateTime={event.createdAt}
                      className="text-[14px]"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}
                    >
                      {formatSecurityTimestamp(event.createdAt)}
                    </time>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {onSignOut && (
        <div>
          <button
            type="button"
            onClick={handleSignOut}
            className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
          >
            Sign out
          </button>
        </div>
      )}

      <MfaSetupDialog
        open={mfaDialogMode !== null}
        mode={mfaDialogMode ?? 'enable'}
        maskedEmail={status?.mfaEmailMasked ?? maskedEmail}
        onOpenChange={(next) => {
          if (next) return;
          closeMfaDialog(true);
        }}
        onCompleted={handleMfaCompleted}
        onCancelled={() => closeMfaDialog(true)}
      />
    </div>
  );
}

export default AccountSecurityPage;
