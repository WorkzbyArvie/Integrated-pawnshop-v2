import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export const OTP_LENGTH = 6;
export const OTP_LABEL = 'Six-digit email verification code';
export const OTP_HELPER = 'Paste the six digits or type them one by one.';
export const OTP_VERIFY_LABEL = 'Verify code';
export const OTP_VERIFYING_LABEL = 'Verifying code';
export const OTP_RESEND_LABEL = 'Resend code';
export const otpResendCountdownLabel = (seconds: number) =>
  `Resend code in ${seconds}`;

export function sanitizeOtpDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export interface OtpInputProps {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  resendAt?: number | null;
  resendDisabled?: boolean;
  resendLabel?: string;
  onResend?: () => void;
  expiresAt?: number | null;
  onExpired?: () => void;
  onVerify?: () => void;
  verifying?: boolean;
  verifyDisabled?: boolean;
  verifyLabel?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function OtpInput({
  id,
  name,
  value,
  onChange,
  label = OTP_LABEL,
  helperText = OTP_HELPER,
  error,
  disabled = false,
  autoFocus = false,
  resendAt = null,
  resendDisabled = false,
  resendLabel,
  onResend,
  expiresAt = null,
  onExpired,
  onVerify,
  verifying = false,
  verifyDisabled = false,
  verifyLabel = OTP_VERIFYING_LABEL,
  inputRef,
}: OtpInputProps) {
  const [now, setNow] = useState(() => Date.now());
  const localRef = useRef<HTMLInputElement | null>(null);
  const inputElement = inputRef ?? localRef;
  const expirySignalled = useRef(false);
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  const timed = resendAt !== null || expiresAt !== null;

  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timed, resendAt, expiresAt]);

  useEffect(() => {
    if (expiresAt === null || expirySignalled.current) return;
    if (Date.now() < expiresAt) return;
    expirySignalled.current = true;
    onExpired?.();
  }, [expiresAt, now, onExpired]);

  const resendSeconds =
    resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const resendCountingDown = resendSeconds > 0;
  const resendText = resendCountingDown
    ? otpResendCountdownLabel(resendSeconds)
    : (resendLabel ?? OTP_RESEND_LABEL);

  const handleChange = (event: { target: { value: string } }) => {
    onChange(sanitizeOtpDigits(event.target.value));
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const pasted = sanitizeOtpDigits(event.clipboardData?.getData('text') ?? '');
    if (pasted.length !== OTP_LENGTH) return;
    onChange(pasted);
    window.requestAnimationFrame(() => {
      const element = inputElement.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(OTP_LENGTH, OTP_LENGTH);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const element = event.currentTarget;
    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? value.length;

    if (event.key === 'Home') {
      event.preventDefault();
      element.setSelectionRange(0, 0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      element.setSelectionRange(value.length, value.length);
      return;
    }
    if (event.key === 'Enter' && onVerify) {
      event.preventDefault();
      onVerify();
      return;
    }
    if (start === 0 && end === 0 && event.key === 'Backspace' && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (start === value.length && event.key === 'Delete' && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-[14px] font-semibold"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </label>
      <input
        ref={inputElement}
        id={id}
        name={name ?? id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoFocus={autoFocus}
        maxLength={OTP_LENGTH}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        aria-invalid={Boolean(error)}
        aria-describedby={`${helperId}${error ? ` ${errorId}` : ''}`}
        className="h-11 w-full rounded-[12px] border px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-[#C9A05C]"
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderColor: error ? 'rgba(212,69,69,0.5)' : 'rgba(201,160,92,0.3)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.4em',
        }}
      />
      {helperText && (
        <p id={helperId} className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
          {helperText}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-2 text-[14px]"
          style={{ color: 'var(--red)' }}
        >
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {(onResend || onVerify) && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {onVerify && (
            <button
              type="button"
              onClick={onVerify}
              disabled={verifying || verifyDisabled || disabled}
              className="h-11 rounded-[12px] px-4 text-[14px] font-semibold disabled:opacity-60"
              style={{ background: 'var(--gold)', color: '#0A0A0F' }}
            >
              {verifying ? verifyLabel : OTP_VERIFY_LABEL}
            </button>
          )}
          {onResend && (
            <button
              type="button"
              onClick={onResend}
              disabled={resendCountingDown || resendDisabled || disabled}
              aria-live="off"
              className="inline-flex h-11 items-center gap-2 rounded-[12px] px-4 text-[14px] font-medium disabled:opacity-60"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-secondary)',
              }}
            >
              <RotateCw size={16} aria-hidden="true" />
              {resendText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default OtpInput;
