import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSecurityPage } from '../../pages/AccountSecurityPage';

const apiGet = vi.fn();
const apiPost = vi.fn();

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
});
