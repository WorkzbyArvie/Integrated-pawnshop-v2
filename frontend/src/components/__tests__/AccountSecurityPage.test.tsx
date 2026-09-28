import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSecurityPage } from '../../pages/AccountSecurityPage';

const apiGet = vi.fn();
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
      this.code = (body as any)?.error;
      this.failedRules = (body as any)?.data?.failed ?? [];
    }
  },
  getApiErrorDetails: (error: unknown) => ({
    code: (error as any)?.code,
    failedRules: (error as any)?.failedRules ?? [],
  }),
  setMfaAssertion: (assertion: string, options?: unknown) =>
    setMfaAssertion(assertion, options),
  clearMfaAssertion: () => clearMfaAssertion(),
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const COMPLIANT = 'S9!riverstone';

const currentStatus = {
  mustChangePassword: false,
  reason: null,
  markedAt: null,
  mfaEnabled: false,
  mfaEmailMasked: 'a••••@example.com',
  passwordUpdatedAt: '2026-08-20T09:30:00.000Z',
};

function renderPage(overrides: Partial<React.ComponentProps<typeof AccountSecurityPage>> = {}) {
  return render(
    <AccountSecurityPage
      displayName="Ariel Auditor"
      accountEmail="ariel@example.com"
      tenantName="Dasmariñas Pawnshop"
      role="Auditor"
      {...overrides}
    />,
  );
}

describe('AccountSecurityPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation((path: string) => {
      if (path === '/security/credential-status') return Promise.resolve(currentStatus);
      if (path === '/security/activity') {
        return Promise.resolve({
          events: [
            {
              id: 'evt-1',
              action: 'PASSWORD_CHANGED',
              success: true,
              createdAt: '2026-08-20T09:30:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve(null);
    });
    apiPost.mockResolvedValue({ changed: true, mustChangePassword: false });
  });

  it('serves an arbitrary non-owner role its own scoped status, change form, and activity', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Current')).toBeInTheDocument());
    expect(
      screen.getByRole('heading', { name: 'Account security' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Not enabled')).toBeInTheDocument();
    expect(screen.getByText('Codes go to a••••@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByText('Password changed')).toBeInTheDocument();

    // Own-profile scope: only the current account is described.
    expect(screen.getByText('Ariel Auditor')).toBeInTheDocument();
    expect(screen.getByText('a••••@example.com')).toBeInTheDocument();
    expect(screen.queryByText('ariel@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();
  });

  it('composes the documented empty activity state instead of a blank region', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/security/credential-status') return Promise.resolve(currentStatus);
      if (path === '/security/activity') return Promise.resolve({ events: [] });
      return Promise.resolve(null);
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('No security activity yet')).toBeInTheDocument());
    expect(
      screen.getByText('Password and MFA events for your account will appear here.'),
    ).toBeInTheDocument();
  });

  it('keeps known status usable when only the activity region fails', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/security/credential-status') return Promise.resolve(currentStatus);
      if (path === '/security/activity') return Promise.reject(new Error('activity offline'));
      return Promise.resolve(null);
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("We couldn't load your security activity. Try again.")).toBeInTheDocument(),
    );
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reports the status region as unavailable instead of guessing either state', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/security/credential-status'
        ? Promise.reject(new Error('status offline'))
        : Promise.resolve({ events: [] }),
    );
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0));
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(screen.queryByText('Change required')).not.toBeInTheDocument();
    expect(
      screen.getByText("We couldn't confirm your account security status. Try again before continuing."),
    ).toBeInTheDocument();
  });

  it('completes a password change through the backend and returns focus to the trigger', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Current')).toBeInTheDocument());
    const trigger = screen.getByRole('button', { name: 'Change password' });
    fireEvent.click(trigger);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Pawn!Current2026' },
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: COMPLIANT } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(screen.getByText('Password updated successfully')).toBeInTheDocument(),
    );
    expect(apiPost).toHaveBeenCalledWith('/security/change-password', {
      currentPassword: 'Pawn!Current2026',
      newPassword: COMPLIANT,
      confirmPassword: COMPLIANT,
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change password' })).toHaveFocus(),
    );
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(screen.queryByText(COMPLIANT)).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/security/credential-status');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('blocks the approved mismatch copy before any server change is attempted', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Current')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Pawn!Current2026' },
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'S9!riverston3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(screen.getAllByText('Passwords do not match').length).toBeGreaterThan(0),
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  describe('email MFA lifecycle', () => {
    const REAUTH_PASSWORD = 'Pawn!Current2026';
    const CODE = '246813';
    const CHALLENGE = {
      challengeId: 'challenge-account-1',
      maskedEmail: 'a••••@example.com',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    let statusState: typeof currentStatus;

    function statusGetCount() {
      return apiGet.mock.calls.filter((call) => call[0] === '/security/credential-status').length;
    }

    function activityGetCount() {
      return apiGet.mock.calls.filter((call) => call[0] === '/security/activity').length;
    }

    beforeEach(() => {
      statusState = { ...currentStatus, mfaEnabled: false, mfaEmailMasked: 'a••••@example.com' };
      setMfaAssertion.mockReset();
      clearMfaAssertion.mockReset();

      apiGet.mockImplementation((path: string) => {
        if (path === '/security/credential-status') return Promise.resolve(statusState);
        if (path === '/security/activity') {
          return Promise.resolve({
            events: [
              {
                id: 'evt-1',
                action: 'PASSWORD_CHANGED',
                success: true,
                createdAt: '2026-08-20T09:30:00.000Z',
              },
            ],
          });
        }
        return Promise.resolve(null);
      });

      apiPost.mockImplementation((path: string, body?: unknown) => {
        if (path === '/security/mfa/enable-challenge') return Promise.resolve(CHALLENGE);
        if (path === '/security/mfa/verify') {
          statusState = { ...statusState, mfaEnabled: true };
          return Promise.resolve({ assertion: 'assertion-token', expiresAt: CHALLENGE.expiresAt });
        }
        if (path === '/security/mfa/disable') {
          const payload = body as { challengeId?: string } | undefined;
          if (!payload?.challengeId) return Promise.resolve(CHALLENGE);
          statusState = { ...statusState, mfaEnabled: false };
          return Promise.resolve({ disabled: true });
        }
        return Promise.resolve({ changed: true, mustChangePassword: false });
      });
    });

    async function openDialog() {
      await waitFor(() => expect(screen.getByText('Current')).toBeInTheDocument());
    }

    async function runEnrollment() {
      fireEvent.click(screen.getByRole('button', { name: 'Enable email MFA' }));
      fireEvent.change(await screen.findByLabelText('Current password'), {
        target: { value: REAUTH_PASSWORD },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));
      fireEvent.change(await screen.findByLabelText('Six-digit email verification code'), {
        target: { value: CODE },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    }

    it('offers an explicit enrollment action and never a bare toggle', async () => {
      renderPage();
      await openDialog();

      expect(screen.getByText('Not enabled')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enable email MFA' })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it('keeps the badge in a pending progress state and never optimistic while enrolling', async () => {
      renderPage();
      await openDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Enable email MFA' }));

      expect(screen.getByText('Setup pending')).toBeInTheDocument();
      expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
      expect(statusGetCount()).toBe(1);
    });

    it('reaches Enabled only after the server confirms and then refreshes status and activity', async () => {
      renderPage();
      await openDialog();

      const statusBefore = statusGetCount();
      const activityBefore = activityGetCount();
      await runEnrollment();

      expect(apiPost).toHaveBeenCalledWith('/security/mfa/enable-challenge', {
        currentPassword: REAUTH_PASSWORD,
      });
      expect(apiPost).toHaveBeenCalledWith('/security/mfa/verify', {
        challengeId: CHALLENGE.challengeId,
        code: CODE,
      });
      expect(await screen.findByText('Enabled')).toBeInTheDocument();
      await waitFor(() => expect(statusGetCount()).toBeGreaterThan(statusBefore));
      await waitFor(() => expect(activityGetCount()).toBeGreaterThan(activityBefore));
      expect(screen.getByRole('button', { name: 'Disable email MFA' })).toBeInTheDocument();
    });

    it('hands the assertion to the module-memory holder and never renders or stores it', async () => {
      renderPage();
      await openDialog();
      await runEnrollment();

      await waitFor(() =>
        expect(setMfaAssertion).toHaveBeenCalledWith('assertion-token', {
          expiresAt: CHALLENGE.expiresAt,
        }),
      );
      expect(document.body.textContent).not.toContain('assertion-token');
      expect(document.body.textContent).not.toContain(CODE);
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('clears the held assertion on sign out', async () => {
      renderPage({ onSignOut: vi.fn() });
      await openDialog();
      await runEnrollment();
      await waitFor(() => expect(setMfaAssertion).toHaveBeenCalled());

      clearMfaAssertion.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

      expect(clearMfaAssertion).toHaveBeenCalled();
    });

    it('exposes a destructive disable that only completes after the server confirms', async () => {
      statusState = { ...statusState, mfaEnabled: true };
      renderPage();
      await openDialog();

      expect(screen.getByText('Enabled')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Disable email MFA' }));
      expect(
        await screen.findByText(
          'Disable email MFA: This removes the code check from future sign-ins. You can enable it again later.',
        ),
      ).toBeInTheDocument();
      expect(apiPost).not.toHaveBeenCalled();

      const activityBefore = activityGetCount();
      fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));

      expect(
        await screen.findByText(
          'Enter your current password to continue disabling email MFA.',
        ),
      ).toBeInTheDocument();
      expect(apiPost).not.toHaveBeenCalled();

      fireEvent.change(await screen.findByLabelText('Current password'), {
        target: { value: REAUTH_PASSWORD },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));
      fireEvent.change(await screen.findByLabelText('Six-digit email verification code'), {
        target: { value: CODE },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

      expect(apiPost).toHaveBeenCalledWith(
        '/security/mfa/disable',
        expect.objectContaining({ challengeId: CHALLENGE.challengeId, code: CODE }),
      );
      expect(await screen.findByText('Not enabled')).toBeInTheDocument();
      await waitFor(() => expect(activityGetCount()).toBeGreaterThan(activityBefore));
      expect(screen.getByRole('button', { name: 'Enable email MFA' })).toBeInTheDocument();
    });

    it('leaves the badge Enabled and returns focus when the disable flow is cancelled', async () => {
      statusState = { ...statusState, mfaEnabled: true };
      renderPage();
      await openDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Disable email MFA' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Keep email MFA enabled' }));

      await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
      expect(apiPost).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Disable email MFA' })).toHaveFocus(),
      );
    });

    it('hides MFA actions and never guesses a state when the status is unavailable', async () => {
      apiGet.mockImplementation((path: string) =>
        path === '/security/credential-status'
          ? Promise.reject(new Error('status offline'))
          : Promise.resolve({ events: [] }),
      );
      renderPage();

      await waitFor(() =>
        expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0),
      );
      expect(screen.queryByRole('button', { name: 'Enable email MFA' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Disable email MFA' })).not.toBeInTheDocument();
      expect(screen.queryByText('Not enabled')).not.toBeInTheDocument();
      expect(screen.queryByText('Setup pending')).not.toBeInTheDocument();
    });

    it('reports Change required for a forced password change alongside the MFA state', async () => {
      statusState = { ...statusState, mustChangePassword: true };
      renderPage();

      await waitFor(() => expect(screen.getByText('Change required')).toBeInTheDocument());
      expect(screen.getByText('Not enabled')).toBeInTheDocument();
    });

    it('never renders a full address or a cross-profile value on the MFA surface', async () => {
      statusState = { ...statusState, mfaEnabled: true };
      renderPage();
      await openDialog();

      expect(screen.getByText('Codes go to a••••@example.com')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('ariel@example.com');
      expect(document.body.textContent).not.toMatch(/ariel@/);
    });
  });
});
