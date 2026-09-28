import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { completeRecovery, fetchCredentialStatus } from '../../lib/accountSecurity';
import { ApiError, getApiErrorDetails } from '../../lib/apiClient';
import {
  PasswordConfirmField,
  PasswordErrorSummary,
  PasswordField,
} from './PasswordField';
import { getPasswordRuleFailures, PASSWORD_RULE_COPY } from './PasswordRequirements';

const RESEND_COOLDOWN_SECONDS = 60;

const RECOVERY_COPY = {
  heading: 'Reset password',
  requestReady: 'Enter your email to receive a password reset link.',
  requestSending: 'Sending reset email',
  requestSent: 'Password reset email sent. Check your inbox for the next step.',
  requestInvalidEmail: 'Enter a valid email address to continue.',
  requestFailed: "We couldn't send the reset email. Check your connection and try again.",
  requestRateLimited: 'Too many reset email requests. Wait {seconds} seconds, then try again.',
  requestAnother: 'Request another reset email',
  requestTryAgainIn: 'Try again in {seconds}',
  sendResetEmail: 'Send reset email',
  editEmailAddress: 'Edit email address',
  returnToSignIn: 'Return to sign in',
  linkValidating: 'Validating your reset link',
  linkValidationFailed:
    "We couldn't validate this reset link. Check your connection and try again.",
  linkReady: 'Create a new password',
  linkInvalid: 'This reset link is invalid. Request a new link to continue.',
  linkExpired: 'This reset link has expired. Request a new link to continue.',
  linkIncomplete: 'This reset link is incomplete. Request a new link to continue.',
  tryAgain: 'Try again',
  requestNewLink: 'Request a new link',
  updatePassword: 'Update password',
  updatingPassword: 'Updating password',
  updateRejected:
    "We couldn't update your password. Check the fields below and try again.",
  updateSuccess: 'Password updated successfully',
  needsSignIn: 'Password updated successfully',
  needsSignInBody:
    'Your sign-in session ended when the password changed. Sign in again with your new password.',
  unverifiable:
    "We couldn't confirm your account security status. Your password may have changed — sign in to continue.",
  continueToSignIn: 'Continue to sign in',
} as const;

type LinkState = 'validating' | 'ready' | 'invalid' | 'expired' | 'incomplete' | 'failed';
type RequestState = 'idle' | 'sending' | 'sent' | 'invalid-email' | 'failed' | 'rate-limited';
type UpdateState =
  | 'idle'
  | 'submitting'
  | 'rejected'
  | 'not-cleared'
  | 'unverifiable'
  | 'needs-sign-in'
  | 'success';

function parseHashParams(): URLSearchParams {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash);
}

function isRateLimited(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : '';
  return /rate limit|too many/i.test(message);
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [surface, setSurface] = useState<'request' | 'link'>('request');
  const [linkState, setLinkState] = useState<LinkState>('validating');
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [cooldown, setCooldown] = useState(0);
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  const recoveryIntent = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = parseHashParams();
    return {
      code: search.get('code') || hash.get('code'),
      tokenHash: search.get('token_hash') || hash.get('token_hash'),
      type: search.get('type') || hash.get('type'),
      accessToken: search.get('access_token') || hash.get('access_token'),
      refreshToken: search.get('refresh_token') || hash.get('refresh_token'),
    };
  }, []);

  const hasLinkIntent = Boolean(
    recoveryIntent.code ||
      recoveryIntent.tokenHash ||
      recoveryIntent.accessToken ||
      recoveryIntent.type === 'recovery',
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (surface !== 'request') return;
    if (requestState === 'invalid-email') emailRef.current?.focus();
  }, [surface, requestState]);

  const validateLink = useCallback(async () => {
    setSurface('link');
    setLinkState('validating');
    setUpdateState('idle');
    setFieldError(null);
    setSummaryMessage(null);

    try {
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();
      if (existingSession?.access_token) {
        setLinkState('ready');
        return;
      }

      if (recoveryIntent.code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(recoveryIntent.code);
        if (exchangeError) {
          setLinkState(/expired/i.test(exchangeError.message) ? 'expired' : 'invalid');
          return;
        }
        setLinkState('ready');
        return;
      }

      if (recoveryIntent.tokenHash && recoveryIntent.type === 'recovery') {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: recoveryIntent.tokenHash,
          type: 'recovery',
        });
        if (verifyError) {
          setLinkState(/expired/i.test(verifyError.message) ? 'expired' : 'invalid');
          return;
        }
        setLinkState('ready');
        return;
      }

      if (recoveryIntent.accessToken && recoveryIntent.refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: recoveryIntent.accessToken,
          refresh_token: recoveryIntent.refreshToken,
        });
        if (sessionError) {
          setLinkState('failed');
          return;
        }
        setLinkState('ready');
        return;
      }

      if (recoveryIntent.accessToken) {
        const {
          data: { session: refreshedSession },
        } = await supabase.auth.getSession();
        if (refreshedSession?.access_token) {
          setLinkState('ready');
          return;
        }
        setLinkState('incomplete');
        return;
      }

      setLinkState('invalid');
    } catch {
      setLinkState('failed');
    }
  }, [recoveryIntent]);

  useEffect(() => {
    void validateLink();
  }, [validateLink]);

  useEffect(() => {
    if (!hasLinkIntent) return;
    void validateLink();
  }, [hasLinkIntent, validateLink]);

  useEffect(() => {
    if (linkState === 'ready') newPasswordRef.current?.querySelector('input')?.focus();
  }, [linkState]);

  useEffect(() => {
    if (updateState === 'success') successRef.current?.focus();
  }, [updateState]);

  const openRequestSurface = useCallback(() => {
    setSurface('request');
    setRequestState('idle');
    setUpdateState('idle');
    setLinkState('validating');
    setNewPassword('');
    setConfirmPassword('');
    setFieldError(null);
    setSummaryMessage(null);
  }, []);

  const handleRequestSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSummaryMessage(null);

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setRequestState('invalid-email');
      return;
    }

    setRequestState('sending');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        setRequestState(isRateLimited(error) ? 'rate-limited' : 'failed');
        return;
      }
      setEmail(trimmed);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setRequestState('sent');
    } catch {
      setRequestState('failed');
    }
  };

  const handleUpdateSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setSummaryMessage(null);

    if (newPassword.length === 0 || confirmPassword.length === 0) {
      setFieldError('Enter a new password and confirm it.');
      setSummaryMessage('Enter a new password and confirm it.');
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

    setUpdateState('submitting');
    try {
      // Transport only: the browser session update can never report success on its own.
      const { error: transportError } = await supabase.auth.updateUser({ password: newPassword });
      if (transportError) {
        setUpdateState('rejected');
        setSummaryMessage(RECOVERY_COPY.updateRejected);
        return;
      }

      await completeRecovery({ newPassword, confirmPassword });

      setNewPassword('');
      setConfirmPassword('');

      let status: Awaited<ReturnType<typeof fetchCredentialStatus>> = null;
      try {
        status = await fetchCredentialStatus();
      } catch (error) {
        // A revoked session is expected here: changing a password invalidates
        // outstanding refresh tokens, so the status re-check can be
        // unauthorized even though the change succeeded.
        if (error instanceof ApiError && error.status === 401) {
          setUpdateState('needs-sign-in');
          return;
        }
        setUpdateState('unverifiable');
        return;
      }

      if (!status) {
        setUpdateState('unverifiable');
        return;
      }

      if (status.mustChangePassword) {
        setUpdateState('not-cleared');
        return;
      }

      setUpdateState('success');
    } catch (error) {
      const code = getApiErrorDetails(error).code;
      if (code === 'PASSWORD_CONFIRMATION_MISMATCH') {
        setFieldError(PASSWORD_RULE_COPY.mismatch);
        setSummaryMessage(RECOVERY_COPY.updateRejected);
      }
      setUpdateState('rejected');
      setSummaryMessage(RECOVERY_COPY.updateRejected);
    }
  };

  const linkErrorCopy: Record<Exclude<LinkState, 'ready' | 'validating'>, string> = {
    invalid: RECOVERY_COPY.linkInvalid,
    expired: RECOVERY_COPY.linkExpired,
    incomplete: RECOVERY_COPY.linkIncomplete,
    failed: RECOVERY_COPY.linkValidationFailed,
  };

  const surfaceClass = 'min-h-screen flex items-center justify-center p-4';
  const panelClass = 'w-full max-w-lg space-y-6';
  const fieldWrapperClass = 'space-y-2';

  return (
    <div
      className={surfaceClass}
      style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
    >
      <div className={panelClass}>
        <header className="flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.2)' }}
          >
            <Lock size={22} aria-hidden="true" style={{ color: 'var(--gold)' }} />
          </div>
          <h1
            className="text-[28px] font-semibold leading-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {RECOVERY_COPY.heading}
          </h1>
        </header>

        {surface === 'request' && (
          <form onSubmit={handleRequestSubmit} className="space-y-4">
            <p className="text-[14px] leading-[1.5] text-center" style={{ color: 'var(--text-secondary)' }}>
              {RECOVERY_COPY.requestReady}
            </p>

            <div className={fieldWrapperClass}>
              <label
                htmlFor="recoveryEmail"
                className="block text-[14px] font-semibold"
                style={{ color: 'var(--text-secondary)' }}
              >
                Email address
              </label>
              <input
                ref={emailRef}
                id="recoveryEmail"
                name="recoveryEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={requestState === 'invalid-email'}
                aria-describedby={requestState === 'invalid-email' ? 'recoveryEmail-error' : undefined}
                className="h-11 w-full rounded-[12px] border px-3.5 text-[14px] outline-none focus-visible:ring-2"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderColor:
                    requestState === 'invalid-email'
                      ? 'rgba(212,69,69,0.6)'
                      : 'rgba(201,160,92,0.3)',
                  color: 'var(--text-primary)',
                }}
              />
              {requestState === 'invalid-email' && (
                <p
                  id="recoveryEmail-error"
                  className="text-[14px]"
                  style={{ color: 'var(--red)' }}
                >
                  {RECOVERY_COPY.requestInvalidEmail}
                </p>
              )}
            </div>

            {requestState === 'invalid-email' && (
              <button
                type="button"
                onClick={() => {
                  setRequestState('idle');
                  emailRef.current?.focus();
                }}
                className="h-11 w-full rounded-[12px] text-[14px] font-medium"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
              >
                {RECOVERY_COPY.editEmailAddress}
              </button>
            )}

            {(requestState === 'failed' || requestState === 'rate-limited') && (
              <p
                role="alert"
                className="rounded-[12px] border px-3 py-2 text-[14px]"
                style={{ background: 'rgba(212,69,69,0.1)', borderColor: 'rgba(212,69,69,0.2)', color: 'var(--red)' }}
              >
                {requestState === 'failed'
                  ? RECOVERY_COPY.requestFailed
                  : RECOVERY_COPY.requestRateLimited.replace('{seconds}', String(cooldown || RESEND_COOLDOWN_SECONDS))}
              </p>
            )}

            {requestState === 'sent' && (
              <div className="space-y-3">
                <p
                  role="status"
                  className="flex items-start gap-2 rounded-[12px] border px-3 py-2 text-[14px]"
                  style={{ background: 'rgba(61,168,108,0.1)', borderColor: 'rgba(61,168,108,0.2)', color: 'var(--green)' }}
                >
                  <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>{RECOVERY_COPY.requestSent}</span>
                </p>
                <p className="text-center text-[12px]" style={{ color: 'var(--text-muted)' }} aria-live="polite">
                  {cooldown > 0
                    ? RECOVERY_COPY.requestTryAgainIn.replace('{seconds}', String(cooldown))
                    : ''}
                </p>
                <button
                  type="submit"
                  disabled={cooldown > 0}
                  className="h-11 w-full rounded-[12px] text-[14px] font-medium disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
                >
                  {RECOVERY_COPY.requestAnother}
                </button>
              </div>
            )}

            {!['sent', 'invalid-email'].includes(requestState) && (
              <button
                type="submit"
                disabled={requestState === 'sending'}
                className="h-11 w-full rounded-[12px] text-[14px] font-semibold disabled:opacity-50"
                style={{
                  background: requestState === 'sending' ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                  color: '#0A0A0F',
                }}
              >
                {requestState === 'sending' && (
                  <Loader2 size={16} aria-hidden="true" className="mr-2 inline animate-spin" />
                )}
                {requestState === 'sending' ? RECOVERY_COPY.requestSending : RECOVERY_COPY.sendResetEmail}
              </button>
            )}

            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="h-11 w-full rounded-[12px] text-[14px] font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
            >
              {RECOVERY_COPY.returnToSignIn}
            </button>
          </form>
        )}

        {surface === 'link' && linkState === 'validating' && (
          <div className="space-y-4" role="status">
            <p className="flex items-center justify-center gap-2 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={16} aria-hidden="true" className="animate-spin" />
              {RECOVERY_COPY.linkValidating}
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="h-11 w-full rounded-[12px] text-[14px] font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
            >
              {RECOVERY_COPY.returnToSignIn}
            </button>
          </div>
        )}

        {surface === 'link' && linkState !== 'ready' && linkState !== 'validating' && (
          <div className="space-y-4">
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border px-3 py-2 text-[14px]"
              style={{ background: 'rgba(212,69,69,0.1)', borderColor: 'rgba(212,69,69,0.2)', color: 'var(--red)' }}
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{linkErrorCopy[linkState]}</span>
            </p>
            {linkState === 'failed' && (
              <button
                type="button"
                onClick={() => void validateLink()}
                className="h-11 w-full rounded-[12px] text-[14px] font-semibold"
                style={{ background: 'var(--gold)', color: '#0A0A0F' }}
              >
                {RECOVERY_COPY.tryAgain}
              </button>
            )}
            <button
              type="button"
              onClick={openRequestSurface}
              className="h-11 w-full rounded-[12px] text-[14px] font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
            >
              {RECOVERY_COPY.requestNewLink}
            </button>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="h-11 w-full rounded-[12px] text-[14px] font-medium"
              style={{ background: 'transparent', color: 'var(--text-muted)' }}
            >
              {RECOVERY_COPY.returnToSignIn}
            </button>
          </div>
        )}

        {surface === 'link' && linkState === 'ready' && (
          <form onSubmit={handleUpdateSubmit} className="space-y-4">
            <p
              className="text-[20px] font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {RECOVERY_COPY.linkReady}
            </p>

            <div ref={newPasswordRef} className={fieldWrapperClass}>
              <PasswordField
                id="recoveryNewPassword"
                name="recoveryNewPassword"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                helperText="Use a private password you do not use elsewhere."
                error={fieldError === PASSWORD_RULE_COPY.mismatch ? undefined : fieldError ?? undefined}
                errorSummaryId="recovery-password-error-summary"
                autoComplete="new-password"
                required
              />
              <PasswordConfirmField
                id="recoveryConfirmPassword"
                name="recoveryConfirmPassword"
                value={confirmPassword}
                onChange={setConfirmPassword}
                error={fieldError === PASSWORD_RULE_COPY.mismatch ? fieldError : undefined}
                errorSummaryId="recovery-password-error-summary"
                required
              />
            </div>

            {summaryMessage && (
              <PasswordErrorSummary
                id="recovery-password-error-summary"
                message={summaryMessage}
                fieldId={
                  fieldError === PASSWORD_RULE_COPY.mismatch
                    ? 'recoveryConfirmPassword'
                    : 'recoveryNewPassword'
                }
              />
            )}

            {updateState === 'not-cleared' && (
              <p
                role="alert"
                className="rounded-[12px] border px-3 py-2 text-[14px]"
                style={{ background: 'rgba(212,69,69,0.1)', borderColor: 'rgba(212,69,69,0.2)', color: 'var(--red)' }}
              >
                Your password change has not cleared yet. Try again.
              </p>
            )}

            {updateState === 'unverifiable' && (
              <p
                role="status"
                className="rounded-[12px] border px-3 py-2 text-[14px]"
                style={{ background: 'rgba(201,160,92,0.1)', borderColor: 'rgba(201,160,92,0.2)', color: 'var(--text-secondary)' }}
              >
                {RECOVERY_COPY.unverifiable}
              </p>
            )}

            {updateState === 'needs-sign-in' && (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-[12px] border px-3 py-3 text-[14px]"
                style={{ background: 'rgba(61,168,108,0.1)', borderColor: 'rgba(61,168,108,0.2)' }}
              >
                <span className="flex items-start gap-2" style={{ color: 'var(--green)' }}>
                  <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>{RECOVERY_COPY.needsSignIn}</span>
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {RECOVERY_COPY.needsSignInBody}
                </span>
              </div>
            )}

            {updateState === 'success' && (
              <p
                ref={successRef}
                role="status"
                tabIndex={-1}
                className="flex items-start gap-2 rounded-[12px] border px-3 py-2 text-[14px]"
                style={{ background: 'rgba(61,168,108,0.1)', borderColor: 'rgba(61,168,108,0.2)', color: 'var(--green)' }}
              >
                <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{RECOVERY_COPY.updateSuccess}</span>
              </p>
            )}

            {updateState === 'success' || updateState === 'needs-sign-in' || updateState === 'unverifiable' ? (
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                className="h-11 w-full rounded-[12px] text-[14px] font-semibold"
                style={{ background: 'var(--gold)', color: '#0A0A0F' }}
              >
                {RECOVERY_COPY.continueToSignIn}
              </button>
            ) : (
              <button
                type="submit"
                disabled={updateState === 'submitting'}
                className="h-11 w-full rounded-[12px] text-[14px] font-semibold disabled:opacity-50"
                style={{
                  background: updateState === 'submitting' ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                  color: '#0A0A0F',
                }}
              >
                {updateState === 'submitting' && (
                  <Loader2 size={16} aria-hidden="true" className="mr-2 inline animate-spin" />
                )}
                {updateState === 'submitting' ? RECOVERY_COPY.updatingPassword : RECOVERY_COPY.updatePassword}
              </button>
            )}

            <button
              type="button"
              onClick={openRequestSurface}
              className="h-11 w-full rounded-[12px] text-[14px] font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
            >
              {RECOVERY_COPY.requestNewLink}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
