import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, WarningCircle, SpinnerGap } from '@phosphor-icons/react';
import {
  clearMfaAssertion,
  errorCode,
  errorStatus,
  maskAccountEmail,
  MFA_ERROR_CODES,
  startLoginChallenge,
  verifyLoginChallenge,
} from '../../lib/credentialApi';

export const MFA_LOGIN_RESEND_COOLDOWN_MS = 60_000;

export const MFA_LOGIN_CHALLENGE_COPY = {
  heading: 'Verify your sign-in',
  explanation: (maskedEmail: string) =>
    `Enter the six-digit code sent to ${maskedEmail}. Codes expire after 10 minutes.`,
  codeSent: (maskedEmail: string) =>
    `A verification code was sent to ${maskedEmail}. Enter it to finish signing in.`,
  sendingCode: 'Sending code',
  requestFailed:
    "We couldn't send a verification code. Check your connection and try again.",
  invalidCode:
    'That code is invalid or expired. Check the six digits or request a new code when the timer ends.',
  tooManyAttempts:
    'Too many verification attempts. Request a new code before trying again.',
  requestNewCode: 'Request a new code',
  verifyCode: 'Verify code',
  verifying: 'Verifying code',
  signOut: 'Sign out',
  codeLabel: 'Six-digit email verification code',
} as const;

type ChallengeAlert = { message: string } | null;

export interface MfaChallengeProps {
  email: string;
  accessToken: string;
  userId?: string | null;
  maskedEmail?: string | null;
  onVerified: () => void | Promise<void>;
  onSignOut: () => void;
}

/**
 * Non-dismissible post-password MFA challenge (SEC-05 / D-08 / D-09 / D-13).
 *
 * It is a full-viewport overlay with no close control, no Escape handling, and
 * no outside-pointer dismissal, so a bidder cannot reach auction content behind
 * it. The code, challenge id, and the server-issued assertion stay in component
 * or module memory only and are never persisted (D-02).
 */
export function MfaChallenge({
  email,
  accessToken,
  userId = null,
  maskedEmail = null,
  onVerified,
  onSignOut,
}: MfaChallengeProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [serverMaskedEmail, setServerMaskedEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [alert, setAlert] = useState<ChallengeAlert>(null);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);

  const destination =
    serverMaskedEmail || maskedEmail || maskAccountEmail(email) || '';
  const verificationLocked =
    verifying || alert?.message === MFA_LOGIN_CHALLENGE_COPY.tooManyAttempts;

  const focusCode = useCallback(() => {
    window.requestAnimationFrame(() => {
      codeRef.current?.focus();
      codeRef.current?.setSelectionRange?.(0, 0);
    });
  }, []);

  const requestChallenge = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    setCodeError(null);
    setAlert(null);
    try {
      const result = await startLoginChallenge(email);
      setChallengeId(result.challenge.challengeId);
      setServerMaskedEmail(result.challenge.maskedEmail || null);
      setCode('');
      setResendAt(Date.now() + MFA_LOGIN_RESEND_COOLDOWN_MS);
    } catch {
      setChallengeId('');
      setCode('');
      setResendAt(null);
      setAlert({ message: MFA_LOGIN_CHALLENGE_COPY.requestFailed });
    } finally {
      setRequesting(false);
    }
  }, [email, requesting]);

  useEffect(() => {
    headingRef.current?.focus();
    void requestChallenge();
    // Restart the challenge only when the account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  useEffect(() => {
    if (!challengeId) return;
    focusCode();
  }, [challengeId, focusCode]);

  const handleVerify = useCallback(async () => {
    if (!challengeId || verificationLocked) return;
    setVerifying(true);
    setCodeError(null);
    setAlert(null);
    try {
      await verifyLoginChallenge({ accessToken, userId, challengeId, code });
      setCode('');
      setVerifying(false);
      await onVerified();
    } catch (error) {
      setCode('');
      setVerifying(false);
      if (
        errorStatus(error) === 429 ||
        errorCode(error) === MFA_ERROR_CODES.CHALLENGE_LOCKED
      ) {
        setAlert({ message: MFA_LOGIN_CHALLENGE_COPY.tooManyAttempts });
      } else {
        setCodeError(MFA_LOGIN_CHALLENGE_COPY.invalidCode);
      }
      focusCode();
    }
  }, [accessToken, challengeId, code, focusCode, onVerified, userId, verificationLocked]);

  const handleSignOut = useCallback(() => {
    setCode('');
    setCodeError(null);
    setChallengeId('');
    setAlert(null);
    setResendAt(null);
    clearMfaAssertion();
    onSignOut();
  }, [onSignOut]);

  const resendSeconds =
    resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
  const showResend = resendSeconds <= 0 && !verifying;

  return (
    <div
      data-mfa-challenge="required"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-login-challenge-heading"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col items-start justify-center gap-6 py-8">
        <div
          className="flex h-14 w-14 items-center justify-center"
          style={{
            background: 'rgba(201,160,92,0.1)',
            border: '1px solid rgba(201,160,92,0.2)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <ShieldCheck size={22} aria-hidden="true" style={{ color: 'var(--gold)' }} />
        </div>

        <div className="flex flex-col gap-3 text-left">
          <h1
            id="mfa-login-challenge-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-[28px] font-semibold leading-[1.15] outline-none"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            {MFA_LOGIN_CHALLENGE_COPY.heading}
          </h1>
          <p className="text-[16px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            {destination
              ? MFA_LOGIN_CHALLENGE_COPY.explanation(destination)
              : 'Enter the six-digit code sent to your account email. Codes expire after 10 minutes.'}
          </p>
        </div>

        {challengeId && (
          <p role="status" className="text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            {MFA_LOGIN_CHALLENGE_COPY.codeSent(destination)}
          </p>
        )}

        {requesting && (
          <p role="status" className="flex items-center gap-2 text-[16px]" style={{ color: 'var(--text-secondary)' }}>
            <SpinnerGap size={16} aria-hidden="true" className="animate-spin" />
            {MFA_LOGIN_CHALLENGE_COPY.sendingCode}
          </p>
        )}

        {alert && (
          <p
            role="alert"
            className="flex items-start gap-2 px-3 py-2 text-[16px]"
            style={{
              background: 'rgba(212,69,69,0.1)',
              border: '1px solid rgba(212,69,69,0.2)',
              borderRadius: 'var(--radius)',
              color: 'var(--red)',
            }}
          >
            <WarningCircle size={16} aria-hidden="true" className="mt-1 shrink-0" />
            <span>{alert.message}</span>
          </p>
        )}

        {challengeId && (
          <div className="flex w-full flex-col gap-3">
            <label
              htmlFor="mfa-login-code"
              className="text-[13px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {MFA_LOGIN_CHALLENGE_COPY.codeLabel}
            </label>
            <input
              id="mfa-login-code"
              name="mfaLoginCode"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={verifying}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? 'mfa-login-code-error' : undefined}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                if (codeError) setCodeError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleVerify();
                }
              }}
              className="h-14 w-full px-4 text-center text-[24px] tracking-[0.4em]"
              style={{
                background: 'var(--bg-surface)',
                border: `1px solid ${codeError ? 'rgba(212,69,69,0.5)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                color: 'var(--text-primary)',
              }}
            />
            {codeError && (
              <p
                id="mfa-login-code-error"
                role="alert"
                className="text-[14px]"
                style={{ color: 'var(--red)' }}
              >
                {codeError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying || verificationLocked || code.length !== 6}
                className="h-11 px-4 text-[14px] font-semibold disabled:opacity-60"
                style={{
                  background: verifying ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                  color: '#0A0A0F',
                  borderRadius: 'var(--radius)',
                }}
              >
                {verifying ? MFA_LOGIN_CHALLENGE_COPY.verifying : MFA_LOGIN_CHALLENGE_COPY.verifyCode}
              </button>
              {showResend && (
                <button
                  type="button"
                  onClick={() => void requestChallenge()}
                  disabled={requesting}
                  className="h-11 px-4 text-[14px] font-medium disabled:opacity-60"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {MFA_LOGIN_CHALLENGE_COPY.requestNewCode}
                </button>
              )}
            </div>
          </div>
        )}

        {!challengeId && !requesting && (
          <button
            type="button"
            onClick={() => void requestChallenge()}
            disabled={requesting}
            className="h-11 px-4 text-[14px] font-semibold disabled:opacity-60"
            style={{
              background: 'var(--gold)',
              color: '#0A0A0F',
              borderRadius: 'var(--radius)',
            }}
          >
            {MFA_LOGIN_CHALLENGE_COPY.requestNewCode}
          </button>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          className="h-11 px-4 text-[14px] font-medium"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)',
            color: 'var(--text-secondary)',
          }}
        >
          {MFA_LOGIN_CHALLENGE_COPY.signOut}
        </button>
      </div>
    </div>
  );
}

export default MfaChallenge;
