import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForcedPasswordChangeGate, CredentialStatusLoading, CredentialStatusUnavailable } from '../Auth/ForcedPasswordChangeGate';
import { resolveCredentialAccess, type CredentialStatus } from '../../lib/accountSecurity';

const submitPasswordChange = vi.fn();
const getApiErrorDetails = vi.fn((_error: unknown) => ({ code: undefined, failedRules: [] as string[] }));

vi.mock('../../lib/apiClient', () => ({
  getApiErrorDetails: (error: unknown) => getApiErrorDetails(error),
  default: {
    post: (...args: unknown[]) => submitPasswordChange(...args),
    get: vi.fn(),
  },
}));

vi.mock('../../lib/accountSecurity', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/accountSecurity')>('../../lib/accountSecurity');
  return {
    ...actual,
    submitPasswordChange: (...args: unknown[]) => submitPasswordChange(...args),
  };
});

const COMPLIANT = 'S9!riverstone';

const forcedStatus: CredentialStatus = {
  mustChangePassword: true,
  reason: 'LEGACY_HASH_MIGRATION',
  markedAt: '2026-09-01T00:00:00.000Z',
  mfaEnabled: false,
  mfaEmailMasked: 'j••••@example.com',
  passwordUpdatedAt: null,
};

function renderGate(
  overrides: Partial<React.ComponentProps<typeof ForcedPasswordChangeGate>> = {},
) {
  const onStatusChanged = vi.fn().mockResolvedValue({ ...forcedStatus, mustChangePassword: false });
  const onSignOut = vi.fn();
  const utils = render(
    <ForcedPasswordChangeGate
      status={forcedStatus}
      displayName="Juan Dela Cruz"
      accountEmail="juan@example.com"
      tenantName="Dasmariñas Pawnshop"
      onStatusChanged={onStatusChanged}
      onSignOut={onSignOut}
      {...overrides}
    />,
  );
  return { ...utils, onStatusChanged, onSignOut };
}

async function fillChangeForm() {
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'Pawn!Legacy2026' },
  });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: COMPLIANT } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password and continue' }));
}

describe('ForcedPasswordChangeGate', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    submitPasswordChange.mockReset();
    submitPasswordChange.mockResolvedValue({ changed: true, mustChangePassword: false });
    getApiErrorDetails.mockReset();
    getApiErrorDetails.mockReturnValue({ code: undefined, failedRules: [] });
  });

  it('renders the approved blocking copy with no dismissal or operational path', async () => {
    renderGate();

    expect(screen.getByText('Action required: password change')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Update your password to continue' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This account was created before the PawnGold security update. Choose a new password to restore access.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('j•••@example.com')).toBeInTheDocument();
    expect(screen.queryByText('juan@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Pawnshop: Dasmariñas Pawnshop')).toBeInTheDocument();
    expect(screen.getByText('Password requirements')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Update password and continue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Use password recovery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Access')).not.toBeInTheDocument();
    expect(screen.queryByText('Subscription Required')).not.toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Update your password to continue' }),
      ).toHaveFocus(),
    );
  });

  it('describes a platform account and a missing tenant without inventing either', () => {
    const { unmount } = renderGate({ isPlatformAccount: true, tenantName: null });
    expect(screen.getByText('Platform account')).toBeInTheDocument();
    expect(screen.queryByText('No pawnshop assigned')).not.toBeInTheDocument();
    unmount();

    renderGate({ tenantName: null });
    expect(screen.getByText('No pawnshop assigned')).toBeInTheDocument();
  });

  it('clears the gate only after the backend status refetch reports the change cleared', async () => {
    const { onStatusChanged } = renderGate();

    await fillChangeForm();

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalledTimes(1));
    expect(submitPasswordChange).toHaveBeenCalledWith({
      currentPassword: 'Pawn!Legacy2026',
      newPassword: COMPLIANT,
      confirmPassword: COMPLIANT,
    });
    expect(
      screen.queryByRole('heading', { name: 'Update your password to continue' }),
    ).toBeInTheDocument();
  });

  it('stays blocking and reports the documented message when the server still requires a change', async () => {
    const onStatusChanged = vi.fn().mockResolvedValue({ ...forcedStatus, mustChangePassword: true });
    renderGate({ onStatusChanged });

    await fillChangeForm();

    await waitFor(() =>
      expect(
        screen.getByText('Your password change has not cleared yet. Try again.'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('heading', { name: 'Update your password to continue' }),
    ).toBeInTheDocument();
  });

  it('blocks the approved mismatch copy before any server change is attempted', async () => {
    renderGate();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Pawn!Legacy2026' },
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'S9!riverston3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password and continue' }));

    await waitFor(() =>
      expect(screen.getAllByText('Passwords do not match').length).toBeGreaterThan(0),
    );
    expect(submitPasswordChange).not.toHaveBeenCalled();
  });

  it('never persists a credential secret in browser storage', async () => {
    const onStatusChanged = vi.fn().mockResolvedValue({ ...forcedStatus, mustChangePassword: true });
    renderGate({ onStatusChanged });

    await fillChangeForm();

    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('blocks the shell while status is unknown and offers retry, recovery, and sign out', () => {
    const onRetry = vi.fn();
    const onSignOut = vi.fn();
    const { unmount } = render(
      <CredentialStatusLoading onSignOut={onSignOut} />,
    );
    expect(screen.getByText('Checking account security')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    unmount();

    render(<CredentialStatusUnavailable onRetry={onRetry} onSignOut={onSignOut} />);
    expect(
      screen.getByText("We couldn't confirm your account security status. Try again before continuing."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Access')).not.toBeInTheDocument();
    expect(screen.queryByText('Subscription Required')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Use password recovery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('resolves the fail-closed access decision from server status alone', () => {
    expect(resolveCredentialAccess({ state: 'loading', status: null })).toBe('loading');
    expect(resolveCredentialAccess({ state: 'unavailable', status: null })).toBe('unavailable');
    expect(resolveCredentialAccess({ state: 'ready', status: null })).toBe('unavailable');
    expect(
      resolveCredentialAccess({ state: 'ready', status: { ...forcedStatus, mustChangePassword: true } }),
    ).toBe('forced');
    expect(
      resolveCredentialAccess({ state: 'ready', status: { ...forcedStatus, mustChangePassword: false } }),
    ).toBe('clear');
  });
});
