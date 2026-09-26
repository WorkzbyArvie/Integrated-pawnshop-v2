export type MfaDialogMode = 'enable' | 'disable';

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

export interface MfaSetupDialogProps {
  open: boolean;
  mode: MfaDialogMode;
  maskedEmail: string | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: (outcome: 'enabled' | 'disabled') => void | Promise<void>;
  onCancelled?: () => void;
}

export function MfaSetupDialog(_props: MfaSetupDialogProps) {
  return null;
}
