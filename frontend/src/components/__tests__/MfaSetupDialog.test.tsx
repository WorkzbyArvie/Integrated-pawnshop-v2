import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaSetupDialog } from '../Auth/MfaSetupDialog';

const apiPost = vi.fn();
const setMfaAssertion = vi.fn();
const clearMfaAssertion = vi.fn();

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  getApiErrorDetails: (error: unknown) => ({
    code: (error as { code?: string })?.code,
    failedRules: [] as string[],
  }),
  setMfaAssertion: (assertion: string, expiresAt?: unknown) =>
    setMfaAssertion(assertion, expiresAt),
  clearMfaAssertion: () => clearMfaAssertion(),
  default: {
    post: (...args: unknown[]) => apiPost(...args),
    get: vi.fn(),
  },
}));

const CURRENT_PASSWORD = 'Pawn!Current2026';
const CODE = '246813';

const CHALLENGE = {
  challengeId: 'challenge-enable-1',
  maskedEmail: 'a••••@example.com',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
};

function challengeError(code: string, status: number, message = 'failed') {
  const error = new Error(message) as Error & { code?: string; status: number };
  error.code = code;
  error.status = status;
  return error;
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof MfaSetupDialog>> = {},
) {
  const onCompleted = vi.fn();
  const onCancelled = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <MfaSetupDialog
      open
      mode="enable"
      maskedEmail="a••••@example.com"
      onOpenChange={onOpenChange}
      onCompleted={onCompleted}
      onCancelled={onCancelled}
      {...overrides}
    />,
  );
  return { ...utils, onCompleted, onCancelled, onOpenChange };
}

async function submitPassword(password = CURRENT_PASSWORD) {
  fireEvent.change(await screen.findByLabelText('Current password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));
}

async function submitCode(code = CODE) {
  fireEvent.change(await screen.findByLabelText('Six-digit email verification code'), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
}

describe('MfaSetupDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiPost.mockReset();
    setMfaAssertion.mockReset();
    clearMfaAssertion.mockReset();
    apiPost.mockImplementation((path: string) => {
      if (path === '/security/mfa/enable-challenge') return Promise.resolve(CHALLENGE);
      if (path === '/security/mfa/verify') {
        return Promise.resolve({ assertion: 'assertion-token', expiresAt: CHALLENGE.expiresAt });
      }
      if (path === '/security/mfa/disable') return Promise.resolve(CHALLENGE);
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enrollment', () => {
    it('requires current-password reauthentication before any code is requested', async () => {
      renderDialog();

      fireEvent.change(await screen.findByLabelText('Current password'), {
        target: { value: '' },
      });
      expect(apiPost).not.toHaveBeenCalled();
      expect(
        screen.queryByLabelText('Six-digit email verification code'),
      ).not.toBeInTheDocument();

      await submitPassword();

      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith('/security/mfa/enable-challenge', {
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(
        await screen.findByText(
          'We will send a six-digit code to a••••@example.com. Enter it to turn on two-step sign-in.',
        ),
      ).toBeInTheDocument();
    });

    it('shows the server-masked destination and a polite sent status for the code step', async () => {
      renderDialog();
      await submitPassword();

      expect(
        await screen.findByText(
          'A verification code was sent to a••••@example.com. Enter it to turn on two-step sign-in.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('a••••@example.com@example.com'),
      ).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain('ariel@example.com');
    });

    it('enables MFA only after the server verifies the emailed code and holds the assertion in memory', async () => {
      const { onCompleted, onOpenChange } = renderDialog();
      await submitPassword();
      await screen.findByLabelText('Six-digit email verification code');

      expect(onCompleted).not.toHaveBeenCalled();

      await submitCode();

      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith('/security/mfa/verify', {
          challengeId: CHALLENGE.challengeId,
          code: CODE,
        }),
      );
      await waitFor(() => expect(onCompleted).toHaveBeenCalledWith('enabled'));
      expect(setMfaAssertion).toHaveBeenCalledWith('assertion-token', CHALLENGE.expiresAt);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('reports a wrong current password without requesting a code', async () => {
      apiPost.mockRejectedValueOnce(challengeError('CURRENT_PASSWORD_INVALID', 400));

      renderDialog();
      await submitPassword('wrong-password');

      expect(
        await screen.findByText(
          "We couldn't verify your current password. Check it and try again.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByLabelText('Six-digit email verification code'),
      ).not.toBeInTheDocument();
    });

    it('clears the value, refocuses the field, and recovers from an invalid code', async () => {
      renderDialog();
      await submitPassword();
      const field = await screen.findByLabelText('Six-digit email verification code');

      apiPost.mockRejectedValueOnce(challengeError('MFA_CHALLENGE_INVALID', 400));
      await submitCode('111111');

      expect(
        await screen.findByText(
          'That code is invalid or expired. Check the six digits or request a new code when the timer ends.',
        ),
      ).toBeInTheDocument();
      await waitFor(() => expect(field).toHaveValue(''));
      await waitFor(() => expect(field).toHaveFocus());
      expect(field).toHaveAttribute('aria-invalid', 'true');
    });

    it('locks verification and demands a new code after repeated attempts', async () => {
      renderDialog();
      await submitPassword();
      await screen.findByLabelText('Six-digit email verification code');

      apiPost.mockRejectedValueOnce(challengeError('MFA_CHALLENGE_LOCKED', 429));
      await submitCode();

      expect(
        await screen.findByText(
          'Too many verification attempts. Request a new code before trying again.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Verify code' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Request a new code' })).toBeInTheDocument();
    });

    it('clears the pending code and focus target when the dialog is dismissed mid-flow', async () => {
      const { onCancelled, onOpenChange } = renderDialog();
      await submitPassword();
      await screen.findByLabelText('Six-digit email verification code');

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onCancelled).toHaveBeenCalled();
      expect(setMfaAssertion).not.toHaveBeenCalled();
    });
  });

  describe('disablement', () => {
    it('treats the destructive confirmation as only the first step', async () => {
      const { onCompleted } = renderDialog({ mode: 'disable' });

      expect(
        await screen.findByText(
          'Disable email MFA: This removes the code check from future sign-ins. You can enable it again later.',
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));

      expect(
        await screen.findByText(
          'Enter your current password to continue disabling email MFA.',
        ),
      ).toBeInTheDocument();
      expect(apiPost).not.toHaveBeenCalled();
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it('cancels safely from the confirmation without touching the server', async () => {
      const { onCancelled, onOpenChange } = renderDialog({ mode: 'disable' });

      fireEvent.click(
        await screen.findByRole('button', { name: 'Keep email MFA enabled' }),
      );

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onCancelled).toHaveBeenCalled();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it('requests the disable code only after the current password is accepted', async () => {
      renderDialog({ mode: 'disable' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }));
      await submitPassword();

      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith('/security/mfa/disable', {
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(
        await screen.findByText(
          'A verification code was sent to a••••@example.com. Enter it to disable email MFA.',
        ),
      ).toBeInTheDocument();
    });

    it('never requests a code when the current password is rejected', async () => {
      apiPost.mockRejectedValueOnce(challengeError('CURRENT_PASSWORD_INVALID', 400));

      renderDialog({ mode: 'disable' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }));
      await submitPassword('wrong-password');

      expect(
        await screen.findByText(
          "We couldn't verify your current password. Check it and try again.",
        ),
      ).toBeInTheDocument();
      expect(apiPost).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByLabelText('Six-digit email verification code'),
      ).not.toBeInTheDocument();
    });

    it('disables MFA only after a verified emailed code and reports the server result', async () => {
      const { onCompleted } = renderDialog({ mode: 'disable' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }));
      await submitPassword();
      await screen.findByLabelText('Six-digit email verification code');

      expect(onCompleted).not.toHaveBeenCalled();
      apiPost.mockImplementation((path: string) => {
        if (path === '/security/mfa/disable') {
          const body = apiPost.mock.calls.at(-1)?.[1] as
            | { challengeId?: string; code?: string }
            | undefined;
          return body?.challengeId
            ? Promise.resolve({ disabled: true })
            : Promise.resolve(CHALLENGE);
        }
        return Promise.resolve(null);
      });

      await submitCode();

      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith('/security/mfa/disable', {
          currentPassword: CURRENT_PASSWORD,
          challengeId: CHALLENGE.challengeId,
          code: CODE,
        }),
      );
      await waitFor(() => expect(onCompleted).toHaveBeenCalledWith('disabled'));
    });

    it('blocks dismissal and cancellation while the final mutation is in flight', async () => {
      let release: (value: unknown) => void = () => {};
      const pending = new Promise((resolve) => {
        release = resolve;
      });

      renderDialog({ mode: 'disable' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }));
      await submitPassword();
      await screen.findByLabelText('Six-digit email verification code');

      apiPost.mockReturnValueOnce(pending);
      await submitCode();

      await waitFor(() =>
        expect(screen.getByText('Disabling email MFA')).toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Keep email MFA enabled' })).not.toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.getByLabelText('Six-digit email verification code'),
      ).toBeInTheDocument();

      await act(async () => {
        release({ disabled: true });
        await pending;
      });
    });

    it('keeps the enabled state observable when the server rejects the mutation', async () => {
      const { onCompleted, onCancelled } = renderDialog({ mode: 'disable' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }));
      await submitPassword();
      await screen.findByLabelText('Six-digit email verification code');

      apiPost.mockRejectedValueOnce(challengeError('MFA_STATE_UPDATE_FAILED', 503));
      await submitCode();

      expect(
        await screen.findByText(
          "We couldn't disable email MFA. Try again or keep MFA enabled.",
        ),
      ).toBeInTheDocument();
      expect(onCompleted).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Try disabling again' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep email MFA enabled' })).toBeInTheDocument();
      expect(onCancelled).not.toHaveBeenCalled();
    });

    it('reports a rate-limited code request with a retry path', async () => {
      renderDialog({ mode: 'disable' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue to verification' }));
      await submitPassword();

      apiPost.mockRejectedValueOnce(challengeError('MFA_CHALLENGE_UNAVAILABLE', 429));
      fireEvent.click(screen.getByRole('button', { name: 'Request code' }));

      expect(
        await screen.findByText(
          'Too many verification code requests. Wait 60 seconds, then try again.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Request code' })).toBeInTheDocument();
    });
  });
});
