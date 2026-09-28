import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MfaChallenge,
  resolveMfaChallengeRequirement,
} from '../Auth/MfaChallenge';

const apiPost = vi.fn();
const setMfaAssertion = vi.fn();
const clearMfaAssertion = vi.fn();

vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    failedRules: string[];
    constructor(message: string, status: number, body?: unknown) {
      super(message);
      this.status = status;
      this.code = (body as { error?: string } | undefined)?.error;
      this.failedRules = (body as { data?: { failed?: string[] } } | undefined)?.data?.failed ?? [];
    }
  },
  getApiErrorDetails: (error: unknown) => ({
    code: (error as { code?: string } | null)?.code,
    failedRules: (error as { failedRules?: string[] } | null)?.failedRules ?? [],
  }),
  setMfaAssertion: (assertion: string, options?: unknown) =>
    setMfaAssertion(assertion, options),
  clearMfaAssertion: () => clearMfaAssertion(),
  default: {
    post: (...args: unknown[]) => apiPost(...args),
    get: vi.fn(),
  },
}));

const EMAIL = 'ariel@example.com';
const MASKED = 'a••••@example.com';
const CODE = '246813';
const ASSERTION = 'assertion-login-1';
const EXPIRES_AT = new Date(Date.now() + 10 * 60 * 1000).toISOString();

const CHALLENGE = {
  challengeId: 'challenge-login-1',
  maskedEmail: MASKED,
  expiresAt: EXPIRES_AT,
};

function apiFailure(status: number, code?: string) {
  return Object.assign(new Error('request failed'), { status, code });
}

function renderChallenge(
  overrides: Partial<React.ComponentProps<typeof MfaChallenge>> = {},
) {
  const onVerified = vi.fn();
  const onSignOut = vi.fn();
  const utils = render(
    <MfaChallenge
      email={EMAIL}
      userId="profile-1"
      onVerified={onVerified}
      onSignOut={onSignOut}
      {...overrides}
    />,
  );
  return { ...utils, onVerified, onSignOut };
}

/** Flush the mount-time challenge request and Radix autofocus effects. */
async function renderChallengeAsync(
  overrides: Partial<React.ComponentProps<typeof MfaChallenge>> = {},
) {
  const utils = renderChallenge(overrides);
  await act(async () => {});
  return utils;
}

async function requestCode() {
  return screen.findByLabelText('Six-digit email verification code');
}

async function submitCode(code = CODE) {
  const input = await requestCode();
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
}

describe('MfaChallenge', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiPost.mockReset();
    setMfaAssertion.mockReset();
    clearMfaAssertion.mockReset();
    apiPost.mockImplementation((path: string) => {
      if (path === '/security/mfa/login-challenge') return Promise.resolve(CHALLENGE);
      if (path === '/security/mfa/verify') {
        return Promise.resolve({ assertion: ASSERTION, expiresAt: EXPIRES_AT });
      }
      return Promise.resolve(null);
    });
  });

  it('holds the user in a server-backed challenge that cannot be dismissed', async () => {
    await renderChallengeAsync();

    expect(
      await screen.findByRole('heading', { name: 'Verify your sign-in' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Enter the six-digit code sent to ${MASKED}. Codes expire after 10 minutes.`,
      ),
    ).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await requestCode();
    expect(screen.getByRole('button', { name: 'Verify code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend code/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    // No close control, no skip path, and no operational content behind the challenge.
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull();
    expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Pending Access')).toBeNull();
    expect(screen.queryByText('Subscription Required')).toBeNull();
    expect(screen.queryByText('Account security')).toBeNull();

    // Escape and an outside pointer press must not close the challenge.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Verify your sign-in' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('moves focus to the challenge heading on mount and to the code once it is sent', async () => {
    // Hold the challenge request open so the mount-time focus target is observable
    // before the emailed code is delivered.
    apiPost.mockImplementation(
      (path: string) =>
        path === '/security/mfa/login-challenge'
          ? new Promise(() => {})
          : Promise.resolve({ assertion: ASSERTION, expiresAt: EXPIRES_AT }),
    );
    renderChallenge();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Verify your sign-in' })).toHaveFocus(),
    );
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it('requests a new code through the public login-challenge route', async () => {
    await renderChallengeAsync();

    await requestCode();
    expect(apiPost).toHaveBeenCalledWith('/security/mfa/login-challenge', { email: EMAIL });
    // The resend control honours the 60-second cooldown after a successful request.
    expect(screen.getByRole('button', { name: /Resend code in \d+/ })).toBeDisabled();
  });

  it('never auto-submits the code and keeps it out of copy and storage', async () => {
    await renderChallengeAsync();

    const input = await requestCode();
    fireEvent.change(input, { target: { value: CODE } });

    expect(
      apiPost.mock.calls.filter((call) => call[0] === '/security/mfa/verify'),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain(CODE);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('clears and refocuses the code with a retryable message on an invalid code', async () => {
    apiPost.mockImplementation((path: string) => {
      if (path === '/security/mfa/login-challenge') return Promise.resolve(CHALLENGE);
      return Promise.reject(apiFailure(400, 'MFA_CHALLENGE_INVALID'));
    });
    await renderChallengeAsync();

    await submitCode();

    expect(
      await screen.findByText(
        'That code is invalid or expired. Check the six digits or request a new code when the timer ends.',
      ),
    ).toBeInTheDocument();
    const input = await requestCode();
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Verify code' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Resend code/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CODE);
  });

  it('locks verification after too many attempts and still exposes resend and sign out', async () => {
    apiPost.mockImplementation((path: string) => {
      if (path === '/security/mfa/login-challenge') return Promise.resolve(CHALLENGE);
      return Promise.reject(apiFailure(429, 'MFA_CHALLENGE_LOCKED'));
    });
    await renderChallengeAsync();

    await submitCode();

    expect(
      await screen.findByText(
        'Too many verification attempts. Request a new code before trying again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify code' })).toBeDisabled();
    // A locked challenge still offers a fresh request and a sign-out path.
    expect(screen.getByRole('button', { name: 'Request a new code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('keeps sign out and a new-code request available when the code could not be sent', async () => {
    apiPost.mockImplementation((path: string) => {
      if (path === '/security/mfa/login-challenge') {
        return Promise.reject(apiFailure(503, 'MFA_CHALLENGE_UNAVAILABLE'));
      }
      return Promise.resolve({ assertion: ASSERTION, expiresAt: EXPIRES_AT });
    });
    await renderChallengeAsync();

    expect(
      await screen.findByText(
        "We couldn't send a verification code. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a new code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Six-digit email verification code')).toBeNull();
  });

  it('hands the server assertion to module memory and never renders or stores it', async () => {
    const { onVerified } = await renderChallengeAsync();

    await submitCode();

    await waitFor(() =>
      expect(setMfaAssertion).toHaveBeenCalledWith(ASSERTION, {
        expiresAt: EXPIRES_AT,
        userId: 'profile-1',
      }),
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/security/mfa/verify', {
      challengeId: CHALLENGE.challengeId,
      code: CODE,
    });
    expect(document.body.textContent).not.toContain(ASSERTION);
    expect(document.body.textContent).not.toContain(CODE);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('clears client security memory and calls sign out on the always-reachable escape path', async () => {
    const { onSignOut } = await renderChallengeAsync();

    await requestCode();
    fireEvent.change(screen.getByLabelText('Six-digit email verification code'), {
      target: { value: CODE },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(clearMfaAssertion).toHaveBeenCalled();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(CODE);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  describe('credential preflight precedence', () => {
    it('never challenges while the server-owned credential state is unknown', () => {
      expect(
        resolveMfaChallengeRequirement({
          credentialState: 'loading',
          mfaEnabled: true,
          assertionHeld: false,
          verifiedUserId: null,
          userId: 'profile-1',
        }),
      ).toBe('not-required');
      expect(
        resolveMfaChallengeRequirement({
          credentialState: 'unavailable',
          mfaEnabled: true,
          assertionHeld: false,
          verifiedUserId: null,
          userId: 'profile-1',
        }),
      ).toBe('not-required');
    });

    it('challenges a password-authenticated MFA user with no held assertion', () => {
      expect(
        resolveMfaChallengeRequirement({
          credentialState: 'ready',
          mfaEnabled: true,
          assertionHeld: false,
          verifiedUserId: null,
          userId: 'profile-1',
        }),
      ).toBe('required');
    });

    it('leaves no challenge for MFA-free, signed-out, or already-verified sessions', () => {
      const base = {
        credentialState: 'ready' as const,
        mfaEnabled: true,
        assertionHeld: false,
        verifiedUserId: null,
        userId: 'profile-1',
      };
      expect(resolveMfaChallengeRequirement({ ...base, mfaEnabled: false })).toBe('not-required');
      expect(resolveMfaChallengeRequirement({ ...base, userId: null })).toBe('not-required');
      expect(resolveMfaChallengeRequirement({ ...base, assertionHeld: true })).toBe('not-required');
      expect(
        resolveMfaChallengeRequirement({ ...base, verifiedUserId: 'profile-1' }),
      ).toBe('not-required');
      // A verification recorded for a different account never satisfies this one.
      expect(
        resolveMfaChallengeRequirement({ ...base, verifiedUserId: 'profile-2' }),
      ).toBe('required');
    });
  });
});
