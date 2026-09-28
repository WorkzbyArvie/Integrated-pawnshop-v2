import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import api, {
  clearMfaAssertion,
  getApiErrorDetails,
  setMfaAssertion,
} from '../../lib/apiClient';
import { maskAccountEmail } from '../../lib/accountSecurity';
import { OtpInput } from './OtpInput';

export const MFA_LOGIN_RESEND_COOLDOWN_MS = 60_000;

const MFA_ERROR_CODES = {
  CHALLENGE_INVALID: 'MFA_CHALLENGE_INVALID',
  CHALLENGE_LOCKED: 'MFA_CHALLENGE_LOCKED',
  CHALLENGE_UNAVAILABLE: 'MFA_CHALLENGE_UNAVAILABLE',
} as const;

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
  verifying: 'Verifying code',
  signOut: 'Sign out',
} as const;

export type MfaChallengeRequirement = 'required' | 'not-required';

/**
 * Credential preflight precedence, in one place: the server-owned status must be
 * `ready` before an MFA challenge is considered, an unauthenticated visitor is
 * never challenged, and only a server-issued assertion (or a verification
 * recorded for this exact account) can clear the challenge.
 */
export function resolveMfaChallengeRequirement(input: {
  credentialState: 'loading' | 'ready' | 'unavailable';
  mfaEnabled: boolean;
  assertionHeld: boolean;
  verifiedUserId: string | null;
  userId: string | null;
}): MfaChallengeRequirement {
  if (input.credentialState !== 'ready') return 'not-required';
  if (!input.userId) return 'not-required';
  if (!input.mfaEnabled) return 'not-required';
  if (input.verifiedUserId && input.verifiedUserId === input.userId) return 'not-required';
  if (input.assertionHeld) return 'not-required';
  return 'required';
}

export interface LoginChallengeView {
  challengeId: string;
  expiresAt: number | null;
  maskedEmail: string;
}

type ChallengeAlert = { message: string } | null;

export interface MfaChallengeProps {
  email: string;
  userId?: string | null;
  maskedEmail?: string | null;
  onVerified: () => void | Promise<void>;
  onSignOut: () => void;
}

function toEpoch(value: unknown): number | null {
  if (typeof value === 'string' && value) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readLoginChallenge(raw: unknown, fallbackEmail: string | null): LoginChallengeView {
  const payload = (raw ?? {}) as Record<string, unknown>;
  const serverMasked = typeof payload.maskedEmail === 'string' ? payload.maskedEmail : '';
  return {
    challengeId: typeof payload.challengeId === 'string' ? payload.challengeId : '',
    expiresAt: toEpoch(payload.expiresAt),
    maskedEmail: serverMasked || fallbackEmail || '',
  };
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}

function errorCode(error: unknown): string | undefined {
  return getApiErrorDetails(error).code;
}

/**
 * Non-dismissible post-password MFA challenge (SEC-05 / D-08 / D-09 / D-13).
 *
 * It is a full-viewport Radix composition built from the shared `DialogContent`
 * primitive in its real non-dismissible mode: no close control is rendered, the
 * controlled `open` state has no close transition, and Escape, outside pointer
 * press, and outside interaction are all prevented. The code, challenge id, and
 * the server-issued assertion stay in component or module memory only.
 */
export function MfaChallenge({
  email,
  userId = null,
  maskedEmail = null,
  onVerified,
  onSignOut,
}: MfaChallengeProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const [challenge, setChallenge] = useState<LoginChallengeView | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [alert, setAlert] = useState<ChallengeAlert>(null);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);

  const destination = challenge?.maskedEmail || maskedEmail || maskAccountEmail(email) || '';
  const verificationLocked = verifying || alert?.message === MFA_LOGIN_CHALLENGE_COPY.tooManyAttempts;

  const focusCode = useCallback(() => {
    window.requestAnimationFrame(() => {
      codeRef.current?.focus();
      codeRef.current?.setSelectionRange(0, 0);
    });
  }, []);

  const requestChallenge = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    setCodeError(null);
    setAlert(null);
    try {
      const raw = await api.post('/security/mfa/login-challenge', { email });
      setChallenge(readLoginChallenge(raw, maskedEmail || maskAccountEmail(email)));
      setCode('');
      setResendAt(Date.now() + MFA_LOGIN_RESEND_COOLDOWN_MS);
    } catch (error) {
      setChallenge(null);
      setCode('');
      setResendAt(null);
      setAlert({ message: MFA_LOGIN_CHALLENGE_COPY.requestFailed });
    } finally {
      setRequesting(false);
    }
  }, [email, maskedEmail, requesting]);

  useEffect(() => {
    headingRef.current?.focus();
    void requestChallenge();
  }, [email]);

  useEffect(() => {
    if (!challenge) return;
    focusCode();
  }, [challenge, focusCode]);

  const handleVerify = useCallback(async () => {
    if (!challenge || !challenge.challengeId || verificationLocked) return;
    setVerifying(true);
    setCodeError(null);
    setAlert(null);
    try {
      const raw = (await api.post('/security/mfa/verify', {
        challengeId: challenge.challengeId,
        code,
      })) as Record<string, unknown> | null;
      const assertion = typeof raw?.assertion === 'string' ? raw.assertion.trim() : '';
      if (!assertion) {
        throw Object.assign(new Error('assertion missing'), {
          status: 500,
          code: MFA_ERROR_CODES.CHALLENGE_INVALID,
        });
      }
      setMfaAssertion(assertion, {
        expiresAt: (raw?.expiresAt as string | null) ?? null,
        userId,
      });
      setCode('');
      setVerifying(false);
      await onVerified();
    } catch (error) {
      setCode('');
      if (errorStatus(error) === 429 || errorCode(error) === MFA_ERROR_CODES.CHALLENGE_LOCKED) {
        setAlert({ message: MFA_LOGIN_CHALLENGE_COPY.tooManyAttempts });
      } else {
        setCodeError(MFA_LOGIN_CHALLENGE_COPY.invalidCode);
      }
      setVerifying(false);
      focusCode();
    }
  }, [challenge, code, focusCode, onVerified, userId, verificationLocked]);

  const handleResend = useCallback(() => {
    void requestChallenge();
  }, [requestChallenge]);

  const handleSignOut = useCallback(() => {
    setCode('');
    setCodeError(null);
    setChallenge(null);
    setAlert(null);
    setResendAt(null);
    clearMfaAssertion();
    onSignOut();
  }, [onSignOut]);

  const resendLabel =
    alert || resendAt === null ? MFA_LOGIN_CHALLENGE_COPY.requestNewCode : undefined;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        showClose={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        data-mfa-challenge="required"
        aria-modal="true"
        className="top-0 left-0 h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 p-4 sm:p-6"
        style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col items-start justify-center gap-6 py-8">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.2)' }}
          >
            <ShieldCheck size={22} aria-hidden="true" style={{ color: 'var(--gold)' }} />
          </div>

          <DialogHeader className="gap-3 text-left">
            <DialogTitle
              ref={headingRef}
              tabIndex={-1}
              className="text-[28px] font-semibold leading-[1.15] outline-none"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              {MFA_LOGIN_CHALLENGE_COPY.heading}
            </DialogTitle>
            <DialogDescription
              className="text-[16px] leading-[1.5]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {destination
                ? MFA_LOGIN_CHALLENGE_COPY.explanation(destination)
                : 'Enter the six-digit code sent to your account email. Codes expire after 10 minutes.'}
            </DialogDescription>
          </DialogHeader>

          {challenge && (
            <p role="status" className="text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
              {MFA_LOGIN_CHALLENGE_COPY.codeSent(destination)}
            </p>
          )}

          {requesting && (
            <p role="status" className="flex items-center gap-2 text-[16px]" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={16} aria-hidden="true" className="animate-spin" />
              {MFA_LOGIN_CHALLENGE_COPY.sendingCode}
            </p>
          )}

          {alert && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border px-3 py-2 text-[16px]"
              style={{ background: 'rgba(212,69,69,0.1)', borderColor: 'rgba(212,69,69,0.2)', color: 'var(--red)' }}
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-1 shrink-0" />
              <span>{alert.message}</span>
            </p>
          )}

          {challenge && (
            <OtpInput
              id="mfa-login-code"
              name="mfaLoginCode"
              value={code}
              onChange={setCode}
              error={codeError}
              inputRef={codeRef}
              disabled={verifying}
              autoFocus
              expiresAt={challenge.expiresAt}
              onExpired={() => {
                setCode('');
                setCodeError(MFA_LOGIN_CHALLENGE_COPY.invalidCode);
                focusCode();
              }}
              resendAt={verificationLocked ? null : resendAt}
              resendDisabled={requesting}
              resendLabel={resendLabel}
              onResend={handleResend}
              onVerify={handleVerify}
              verifying={verifying}
              verifyDisabled={verificationLocked}
              verifyLabel={MFA_LOGIN_CHALLENGE_COPY.verifying}
            />
          )}

          {!challenge && (
            <button
              type="button"
              onClick={handleResend}
              disabled={requesting}
              className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
              style={{
                background: requesting ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                color: '#0A0A0F',
              }}
            >
              {MFA_LOGIN_CHALLENGE_COPY.requestNewCode}
            </button>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
          >
            {MFA_LOGIN_CHALLENGE_COPY.signOut}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MfaChallenge;
