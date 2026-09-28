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
  enableDestinationExplanation: (maskedEmail: string) =>
    `We will send a six-digit code to ${maskedEmail}. Enter it to turn on two-step sign-in.`,
  disableDestinationExplanation: (maskedEmail: string) =>
    `We will send a six-digit code to ${maskedEmail} to confirm disabling email MFA.`,
  enableCodeSent: (maskedEmail: string) =>
    `A verification code was sent to ${maskedEmail}. Enter it to turn on two-step sign-in.`,
  disableCodeSent: (maskedEmail: string) =>
    `A verification code was sent to ${maskedEmail}. Enter it to disable email MFA.`,
  requestCode: 'Request code',
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
  const [requestPending, setRequestPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [outcome, setOutcome] = useState<'enabled' | 'disabled' | null>(null);

  const codeRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const locked = step === 'committing';
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
        if (code_ === ERROR_CODES.CURRENT_PASSWORD_INVALID) {
          setPasswordError(MFA_COPY.passwordInvalid);
          setStep('password');
        } else if (status === 429 || code_ === ERROR_CODES.CHALLENGE_UNAVAILABLE) {
          setAlert({
            kind: 'requestRateLimited',
            message: MFA_COPY.requestRateLimited(MFA_REQUEST_RATE_LIMIT_SECONDS),
          });
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
              <p
                role="status"
                className="text-[14px] leading-[1.5]"
                style={{ color: 'var(--text-secondary)' }}
              >
                {challenge ? codeSentMessage : destinationExplanation}
              </p>

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
                      disabled={requestPending}
                      className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
                      style={{
                        background: requestPending ? 'rgba(201,160,92,0.5)' : 'var(--gold)',
                        color: '#0A0A0F',
                      }}
                    >
                      {requestPending ? MFA_COPY.sendingCode : MFA_COPY.requestCode}
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
