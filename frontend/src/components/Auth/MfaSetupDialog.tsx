import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ShieldOff } from 'lucide-react';
import api, { getApiErrorDetails, setMfaAssertion } from '../../lib/apiClient';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { PasswordField } from './PasswordField';
import { OtpInput } from './OtpInput';

export type MfaDialogMode = 'enable' | 'disable';

/**
 * Whether an outside interaction is the browser restoring focus rather than the
 * user dismissing the dialog.
 *
 * Radix dismisses a dialog when focus lands outside it, and returning to a
 * backgrounded tab fires focusin on <body>, which the layer cannot tell from a
 * click on the backdrop -- so alt-tabbing mid-flow closed the dialog and
 * discarded the countdown.
 *
 * Decided from the originating event alone. An earlier version gated this on a
 * window blur flag, which was a race that lost whenever focus returned to
 * something other than the page itself, such as a docked DevTools, so the flag
 * read false by the time it was consulted.
 *
 * Suppressing every focusin cannot swallow a real dismissal: a backdrop click
 * arrives as pointerdown, Escape and the close button are not outside
 * interactions, and a modal dialog is focus-trapped so no other focusin can
 * originate outside it.
 */
export function isRefocusDismissal(event: unknown): boolean {
  const original = (event as { originalEvent?: { type?: unknown } } | null)?.originalEvent;
  return original?.type === 'focusin';
}

export const MFA_RESEND_COOLDOWN_MS = 60_000;
export const MFA_REQUEST_RATE_LIMIT_SECONDS = 60;

export const MFA_COPY = {
  enableTitle: 'Email MFA',
  disableTitle: 'Disable email MFA',
  destructiveConfirmation:
    'Disable email MFA: This removes the code check from future sign-ins. You can enable it again later.',
  keepEnabled: 'Keep email MFA enabled',
  continueToVerification: 'Continue to verification',
  enablePasswordExplanation: 'Enter your current password to continue',
  disablePasswordExplanation:
    'Enter your current password to continue disabling email MFA.',
  checkingPassword: 'Checking your current password',
  passwordInvalid: "We couldn't verify your current password. Check it and try again.",
  passwordInvalidWithAttempts: (remaining: number) =>
    `We couldn't verify your current password. Check it and try again — ${remaining} attempt${remaining === 1 ? '' : 's'} left before this is locked.`,
  passwordAttemptsExhausted:
    'Too many incorrect password attempts. Close this and sign in again before retrying.',
  enableDestinationExplanation: (maskedEmail: string) =>
    `We will send a six-digit code to ${maskedEmail}. Enter it to turn on two-step sign-in.`,
  disableDestinationExplanation: (maskedEmail: string) =>
    `We will send a six-digit code to ${maskedEmail} to confirm disabling email MFA.`,
  enableCodeSent: (maskedEmail: string) =>
    `A verification code was sent to ${maskedEmail}. Enter it to turn on two-step sign-in.`,
  disableCodeSent: (maskedEmail: string) =>
    `A verification code was sent to ${maskedEmail}. Enter it to disable email MFA.`,
  requestCode: 'Request code',
  retryIn: (seconds: number) => `Retry in ${seconds}s`,
  sendingCode: 'Sending code',
  requestFailed:
    "We couldn't send a verification code. Check your connection and try again.",
  requestRateLimited: (seconds: number) =>
    `Too many verification code requests. Wait ${seconds} seconds, then try again.`,
  verifyingCode: 'Verifying code',
  disabling: 'Disabling email MFA',
  invalidCode:
    'That code is invalid or expired. Check the six digits or request a new code when the timer ends.',
  tooManyAttempts:
    'Too many verification attempts. Request a new code before trying again.',
  requestNewCode: 'Request a new code',
  enabled: 'Email MFA is enabled',
  disabled: 'Email MFA is disabled',
  disableFailed: "We couldn't disable email MFA. Try again or keep MFA enabled.",
  tryDisablingAgain: 'Try disabling again',
  cancel: 'Cancel',
} as const;

const ERROR_CODES = {
  CURRENT_PASSWORD_INVALID: 'CURRENT_PASSWORD_INVALID',
  REAUTH_FAILED: 'MFA_REAUTH_FAILED',
  REAUTH_LOCKED: 'MFA_REAUTH_LOCKED',
  CHALLENGE_INVALID: 'MFA_CHALLENGE_INVALID',
  CHALLENGE_LOCKED: 'MFA_CHALLENGE_LOCKED',
  CHALLENGE_UNAVAILABLE: 'MFA_CHALLENGE_UNAVAILABLE',
  STATE_UPDATE_FAILED: 'MFA_STATE_UPDATE_FAILED',
  DISABLE_ROUTE_REQUIRED: 'MFA_DISABLE_ROUTE_REQUIRED',
} as const;

type MfaStep = 'confirm' | 'password' | 'code' | 'committing';
type MfaAlertKind =
  | 'requestFailed'
  | 'requestRateLimited'
  | 'invalidCode'
  | 'tooManyAttempts'
  | 'disableFailed';

interface MfaAlert {
  kind: MfaAlertKind;
  message: string;
}

interface MfaChallenge {
  challengeId: string;
  expiresAt: number | null;
  maskedEmail: string;
}

export interface MfaSetupDialogProps {
  open: boolean;
  mode: MfaDialogMode;
  maskedEmail: string | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: (outcome: 'enabled' | 'disabled') => void | Promise<void>;
  onCancelled?: () => void;
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

function readChallenge(raw: unknown): MfaChallenge {
  const payload = (raw ?? {}) as Record<string, unknown>;
  return {
    challengeId: typeof payload.challengeId === 'string' ? payload.challengeId : '',
    expiresAt: toEpoch(payload.expiresAt),
    maskedEmail: typeof payload.maskedEmail === 'string' ? payload.maskedEmail : '',
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
 * Attempts remaining before reauthentication locks, as reported by the server.
 *
 * Null when the server did not say, which is the case for the older error code
 * and for any transport failure. The caller falls back to copy with no count
 * rather than inventing a number.
 */
function attemptsRemaining(error: unknown): number | null {
  // Read off the error object rather than through getApiErrorDetails, which
  // surfaces only `code` and `failedRules` and would silently drop this field.
  const direct = (error as { attemptsRemaining?: unknown } | null)?.attemptsRemaining;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  // Fall back to the parsed response body, which is where a field the ApiError
  // constructor does not model actually lives.
  const body = (error as { response?: { data?: unknown } } | null)?.response?.data as
    | { attemptsRemaining?: unknown }
    | undefined;
  const nested = body?.attemptsRemaining;
  return typeof nested === 'number' && Number.isFinite(nested) ? nested : null;
}

export function MfaSetupDialog({
  open,
  mode,
  maskedEmail,
  onOpenChange,
  onCompleted,
  onCancelled,
}: MfaSetupDialogProps) {
  const [step, setStep] = useState<MfaStep>(mode === 'disable' ? 'confirm' : 'password');
  const [currentPassword, setCurrentPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [alert, setAlert] = useState<MfaAlert | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  // Set when the server refuses further reauthentication attempts. Distinct from
  // `locked`, which only means a code submission is in flight -- conflating the
  // two left a user with no way to tell "try again" from "stop trying".
  const [reauthLocked, setReauthLocked] = useState(false);
  // Ticks once a second so the retry button can count the cooldown down. The
  // timestamp alone is not enough: nothing re-rendered to read it, so the button
  // stayed enabled and every attempt drew another 429.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (resendAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const resendSeconds = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const resendCountingDown = resendSeconds > 0;
  const [requestPending, setRequestPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [outcome, setOutcome] = useState<'enabled' | 'disabled' | null>(null);

  const codeRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const locked = step === 'committing' || reauthLocked;
  const destination = challenge?.maskedEmail || maskedEmail || '';
  const verifyingLocked = alert?.kind === 'tooManyAttempts' || verifying;

  const clearSecrets = useCallback(() => {
    setCurrentPassword('');
    setCode('');
    setPasswordError(null);
    setCodeError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(mode === 'disable' ? 'confirm' : 'password');
    setChallenge(null);
    setAlert(null);
    setCodeError(null);
    setPasswordError(null);
    setResendAt(null);
    setOutcome(null);
    setVerifying(false);
    setRequestPending(false);
    setPasswordPending(false);
    // This component is always mounted and its state outlives a close, so a
    // lockout set in one session persisted into the next and every later open
    // looked locked. Reopening is a fresh attempt; the server decides.
    setReauthLocked(false);
  }, [open, mode]);

  const requestChallenge = useCallback(
    async (password: string): Promise<MfaChallenge> => {
      if (mode === 'disable') {
        const raw = await api.post('/security/mfa/disable', { currentPassword: password });
        return readChallenge(raw);
      }
      const raw = await api.post('/security/mfa/enable-challenge', {
        currentPassword: password,
      });
      return readChallenge(raw);
    },
    [mode],
  );

  const requestCode = useCallback(
    async (password: string) => {
      setRequestPending(true);
      try {
        const next = await requestChallenge(password);
        setChallenge(next);
        setCode('');
        setCodeError(null);
        setAlert(null);
        setResendAt(Date.now() + MFA_RESEND_COOLDOWN_MS);
        setStep('code');
      } catch (error) {
        const status = errorStatus(error);
        const code_ = errorCode(error);
        // The specific code is tested before the bare status. Testing status
        // first meant every 401 -- including a rejected password -- was reported
        // as a request limit and moved the user to the code step, where no code
        // would ever arrive.
        if (
          code_ === ERROR_CODES.CURRENT_PASSWORD_INVALID ||
          code_ === ERROR_CODES.REAUTH_FAILED ||
          // A 401 on this endpoint can only mean the password was rejected --
          // the request is already authenticated. Treating an unlabelled 401 as a
          // send failure told the user to check their connection when their
          // password was the problem.
          (status === 401 && !code_)
        ) {
          const remaining = attemptsRemaining(error);
          setPasswordError(
            remaining === null
              ? MFA_COPY.passwordInvalid
              : MFA_COPY.passwordInvalidWithAttempts(remaining),
          );
          // Back to the password field, not forward to a code that was never sent.
          setStep('password');
          setChallenge(null);
        } else if (code_ === ERROR_CODES.REAUTH_LOCKED) {
          setPasswordError(MFA_COPY.passwordAttemptsExhausted);
          setStep('password');
          setChallenge(null);
          setReauthLocked(true);
        } else if (status === 429 || code_ === ERROR_CODES.CHALLENGE_UNAVAILABLE) {
          setAlert({
            kind: 'requestRateLimited',
            message: MFA_COPY.requestRateLimited(MFA_REQUEST_RATE_LIMIT_SECONDS),
          });
          // The cooldown has to start here too. The message tells the user to
          // wait 60 seconds, but the countdown that gates the request button is
          // driven off resendAt, so leaving it null meant the button stayed
          // enabled and every further attempt drew another 429.
          setResendAt(Date.now() + MFA_RESEND_COOLDOWN_MS);
          setStep('code');
        } else {
          setAlert({ kind: 'requestFailed', message: MFA_COPY.requestFailed });
          setStep('code');
        }
      } finally {
        setRequestPending(false);
      }
    },
    [requestChallenge],
  );

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (passwordPending) return;
      setPasswordPending(true);
      setPasswordError(null);
      await requestCode(currentPassword);
      setPasswordPending(false);
    },
    [currentPassword, passwordPending, requestCode],
  );

  const handleVerify = useCallback(async () => {
    if (!challenge || verifyingLocked) return;
    setVerifying(true);
    setCodeError(null);
    setAlert(null);

    if (mode === 'disable') {
      setStep('committing');
      try {
        await api.post('/security/mfa/disable', {
          currentPassword,
          challengeId: challenge.challengeId,
          code,
        });
        setOutcome('disabled');
        await onCompleted('disabled');
        onOpenChange(false);
      } catch (error) {
        setStep('code');
        setAlert({ kind: 'disableFailed', message: MFA_COPY.disableFailed });
        setVerifying(false);
        setCode('');
        codeRef.current?.focus();
      }
      return;
    }

    try {
      const raw = (await api.post('/security/mfa/verify', {
        challengeId: challenge.challengeId,
        code,
      })) as Record<string, unknown> | null;
      if (typeof raw?.assertion === 'string' && raw.assertion) {
        setMfaAssertion(raw.assertion, { expiresAt: (raw.expiresAt as string) ?? null });
      }
      setOutcome('enabled');
      await onCompleted('enabled');
      onOpenChange(false);
    } catch (error) {
      const status = errorStatus(error);
      const code_ = errorCode(error);
      setCode('');
      if (status === 429 || code_ === ERROR_CODES.CHALLENGE_LOCKED) {
        setAlert({ kind: 'tooManyAttempts', message: MFA_COPY.tooManyAttempts });
      } else {
        setCodeError(MFA_COPY.invalidCode);
        window.requestAnimationFrame(() => codeRef.current?.focus());
      }
      setVerifying(false);
    }
  }, [challenge, code, currentPassword, mode, onCompleted, onOpenChange, verifyingLocked]);

  const handleResend = useCallback(() => {
    if (requestPending) return;
    setAlert(null);
    setCodeError(null);
    void requestCode(currentPassword);
  }, [currentPassword, requestPending, requestCode]);

  const cancel = useCallback(() => {
    clearSecrets();
    setChallenge(null);
    setAlert(null);
    setResendAt(null);
    onCancelled?.();
    onOpenChange(false);
  }, [clearSecrets, onCancelled, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    if (step === 'confirm') {
      window.requestAnimationFrame(() => headingRef.current?.focus());
      return;
    }
    if (step === 'password') {
      window.requestAnimationFrame(() => passwordRef.current?.querySelector('input')?.focus());
      return;
    }
    if (step === 'code') {
      window.requestAnimationFrame(() => codeRef.current?.focus());
    }
  }, [open, step]);

  const confirmationOpen = open && step === 'confirm';
  const dialogOpen = open && step !== 'confirm';

  const codeSentMessage =
    mode === 'disable'
      ? MFA_COPY.disableCodeSent(destination)
      : MFA_COPY.enableCodeSent(destination);

  const destinationExplanation =
    mode === 'disable'
      ? MFA_COPY.disableDestinationExplanation(destination)
      : MFA_COPY.enableDestinationExplanation(destination);

  const passwordExplanation =
    mode === 'disable' ? MFA_COPY.disablePasswordExplanation : MFA_COPY.enablePasswordExplanation;

  const alertKind = alert?.kind ?? null;

  return (
    <>
      <AlertDialog
        open={confirmationOpen}
        onOpenChange={(next) => {
          if (next) return;
          cancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle
              ref={headingRef}
              tabIndex={-1}
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              {MFA_COPY.disableTitle}
            </AlertDialogTitle>
            <AlertDialogDescription
              style={{ color: 'var(--text-secondary)' }}
              className="text-[16px] leading-[1.5]"
            >
              {MFA_COPY.destructiveConfirmation}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                clearSecrets();
                setPasswordError(null);
                setStep('password');
              }}
              className="h-11 rounded-[12px] px-4 text-[14px] font-semibold"
              style={{ background: 'var(--red)', color: '#ffffff' }}
            >
              {MFA_COPY.continueToVerification}
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={(event) => {
                event.preventDefault();
                cancel();
              }}
              className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-secondary)',
              }}
            >
              {MFA_COPY.keepEnabled}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (next) return;
          if (locked) return;
          cancel();
        }}
      >
        <DialogContent
          showClose={!locked}
          onEscapeKeyDown={(event) => {
            if (locked) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (locked) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (locked) event.preventDefault();
            // DismissableLayer dismisses unless the interaction is prevented, so
            // this is the one place the refocus case can be filtered out without
            // swallowing a real click.
            else if (isRefocusDismissal(event)) {
              event.preventDefault();
            }
          }}
          className="max-h-[90vh] overflow-y-auto p-4 sm:max-w-lg sm:p-8"
          style={{ background: 'var(--bg-elevated)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <DialogHeader>
            <DialogTitle
              className="text-[20px] font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              {mode === 'disable' ? MFA_COPY.disableTitle : MFA_COPY.enableTitle}
            </DialogTitle>
            <DialogDescription
              className="text-[16px] leading-[1.5]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {step === 'password' ? passwordExplanation : destinationExplanation}
            </DialogDescription>
          </DialogHeader>

          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div ref={passwordRef}>
                <PasswordField
                  id="mfa-reauth-password"
                  name="mfaReauthPassword"
                  label="Current password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  error={passwordError ?? undefined}
                  helperText="Used only to confirm this is you. It is never stored."
                  showRequirements={false}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={passwordPending}
                  className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
                  style={{
                    background: passwordPending ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                    color: '#0A0A0F',
                  }}
                >
                  {passwordPending ? MFA_COPY.checkingPassword : MFA_COPY.continueToVerification}
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {MFA_COPY.cancel}
                </button>
              </div>
            </form>
          )}

          {(step === 'code' || step === 'committing') && (
            <div className="space-y-4">
              {/*
                Only narrate a code that was actually sent. Falling back to
                destinationExplanation here repeated the dialog description
                verbatim underneath itself, so a rate-limited user saw the same
                sentence twice with no indication that no code had been sent.
                When nothing was sent, the alert below carries the reason.
              */}
              {challenge && (
                <p
                  role="status"
                  className="text-[14px] leading-[1.5]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {codeSentMessage}
                </p>
              )}

              {alert && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[14px]"
                  style={{
                    background: 'rgba(212,69,69,0.1)',
                    borderColor: 'rgba(212,69,69,0.2)',
                    color: 'var(--red)',
                  }}
                >
                  <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>{alert.message}</span>
                </div>
              )}

              {challenge && (
                <OtpInput
                  id="mfa-verification-code"
                  value={code}
                  onChange={setCode}
                  error={codeError}
                  inputRef={codeRef}
                  autoFocus
                  disabled={locked}
                  expiresAt={challenge.expiresAt}
                  onExpired={() => {
                    setCode('');
                    setCodeError(MFA_COPY.invalidCode);
                    window.requestAnimationFrame(() => codeRef.current?.focus());
                  }}
                  resendAt={verifyingLocked ? null : resendAt}
                  resendDisabled={requestPending || locked}
                  resendLabel={
                    verifyingLocked || alert || !resendAt ? MFA_COPY.requestNewCode : undefined
                  }
                  onResend={handleResend}
                  onVerify={handleVerify}
                  verifying={verifying}
                  verifyDisabled={verifyingLocked}
                  verifyLabel={MFA_COPY.verifyingCode}
                />
              )}

              {mode === 'disable' && alertKind === 'disableFailed' && !locked && (
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={verifying}
                  className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
                  style={{ background: 'var(--gold)', color: '#0A0A0F' }}
                >
                  {MFA_COPY.tryDisablingAgain}
                </button>
              )}

              {mode === 'disable' && (
                <div className="flex flex-wrap gap-3 pt-1">
                  {!challenge && (
                    <button
                      type="button"
                      onClick={handleResend}
                      // This button is separate from the OtpInput resend control
                      // and is the one shown when no challenge exists -- which is
                      // exactly the state after a rate-limited request. It was
                      // gated only on requestPending, so the 60-second cooldown
                      // never applied and every retry drew another 429.
                      disabled={requestPending || resendCountingDown}
                      className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
                      style={{
                        background:
                          requestPending || resendCountingDown
                            ? 'rgba(201,160,92,0.5)'
                            : 'var(--gold)',
                        color: '#0A0A0F',
                      }}
                    >
                      {requestPending
                        ? MFA_COPY.sendingCode
                        : resendCountingDown
                          ? MFA_COPY.retryIn(resendSeconds)
                          : MFA_COPY.requestCode}
                    </button>
                  )}
                  {!locked && (
                    <button
                      type="button"
                      onClick={cancel}
                      className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {MFA_COPY.keepEnabled}
                    </button>
                  )}
                </div>
              )}

              {mode === 'enable' && !locked && (
                <div className="flex flex-wrap gap-3 pt-1">
                  {/* Enable mode previously offered Cancel only, so a
                      rate-limited user was left with no way forward at all: the
                      OtpInput resend control is not rendered without a challenge,
                      and the standalone retry button was disable-mode only.
                      The same cooldown applies, so the same button belongs here. */}
                  {!challenge && (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={requestPending || resendCountingDown}
                      className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
                      style={{
                        background:
                          requestPending || resendCountingDown
                            ? 'rgba(201,160,92,0.5)'
                            : 'var(--gold)',
                        color: '#0A0A0F',
                      }}
                    >
                      {requestPending
                        ? MFA_COPY.sendingCode
                        : resendCountingDown
                          ? MFA_COPY.retryIn(resendSeconds)
                          : MFA_COPY.requestCode}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cancel}
                    className="h-11 rounded-[12px] px-4 text-[14px] font-medium"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {MFA_COPY.cancel}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'committing' && (
            <p
              role="status"
              className="flex items-center gap-2 text-[16px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ShieldOff size={16} aria-hidden="true" />
              {MFA_COPY.disabling}
            </p>
          )}

          {outcome && !locked && (
            <p
              role="status"
              className="flex items-center gap-2 text-[16px]"
              style={{ color: 'var(--green)' }}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              {outcome === 'enabled' ? MFA_COPY.enabled : MFA_COPY.disabled}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MfaSetupDialog;
