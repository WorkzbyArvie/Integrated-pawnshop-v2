import type { RefObject } from 'react';

export const OTP_LENGTH = 6;
export const OTP_LABEL = 'Six-digit email verification code';
export const OTP_HELPER = 'Paste the six digits or type them one by one.';
export const OTP_VERIFY_LABEL = 'Verify code';
export const OTP_RESEND_LABEL = 'Resend code';
export const otpResendCountdownLabel = (seconds: number) =>
  `Resend code in ${seconds}`;

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
  verifyLabel?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function OtpInput(_props: OtpInputProps) {
  return null;
}
