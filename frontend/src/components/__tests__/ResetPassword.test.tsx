import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPassword from '../Auth/ResetPassword';
import { ApiError } from '../../lib/apiClient';

const apiGet = vi.fn();
const apiPost = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();

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

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'recovery-session-token' } },
        error: null,
      }),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
      updateUser: (...args: unknown[]) => updateUser(...args),
      verifyOtp: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      setSession: vi.fn(),
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const COMPLIANT = 'S9!riverstone';

function readyRecoveryForm() {
  return screen.getByLabelText('New password') as HTMLInputElement;
}

describe('ResetPassword recovery authority', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiGet.mockReset();
    apiPost.mockReset();
    resetPasswordForEmail.mockReset();
    updateUser.mockReset();
    apiPost.mockResolvedValue({ changed: true, mustChangePassword: false });
    updateUser.mockResolvedValue({ error: null, data: { user: { id: 'p1' } } });
  });

  it('shows success only after backend completion and a status refetch that clears the forced change', async () => {
    apiGet.mockResolvedValue({ mustChangePassword: false, mfaEnabled: false });
    render(<ResetPassword />);

    await waitFor(() => expect(screen.getByText('Create a new password')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: COMPLIANT } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(screen.getByText('Password updated successfully')).toBeInTheDocument(),
    );
    expect(apiPost).toHaveBeenCalledWith('/security/recovery/complete', {
      newPassword: COMPLIANT,
      confirmPassword: COMPLIANT,
    });
    expect(apiGet).toHaveBeenCalledWith('/security/credential-status');
    expect(screen.queryByText('Password updated successfully. Redirecting to login...')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('stays on the failure state when the refetch still requires a password change', async () => {
    apiGet.mockResolvedValue({ mustChangePassword: true, mfaEnabled: false });
    render(<ResetPassword />);

    await waitFor(() => expect(screen.getByText('Create a new password')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: COMPLIANT } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(
        screen.getByText('Your password change has not cleared yet. Try again.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Password updated successfully')).not.toBeInTheDocument();
  });

  it('never reports success when the backend rejects the recovery completion', async () => {
    apiGet.mockResolvedValue({ mustChangePassword: true, mfaEnabled: false });
    apiPost.mockRejectedValue(
      new ApiError('Password could not be updated.', 503, {
        error: 'PASSWORD_UPDATE_FAILED',
      }),
    );
    render(<ResetPassword />);

    await waitFor(() => expect(screen.getByText('Create a new password')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: COMPLIANT } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't update your password. Check the fields below and try again."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('Password updated successfully')).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
    expect(readyRecoveryForm()).toHaveValue(COMPLIANT);
    expect(localStorage.length).toBe(0);
  });

  it('blocks the approved mismatch copy before any server completion is attempted', async () => {
    apiGet.mockResolvedValue({ mustChangePassword: true, mfaEnabled: false });
    render(<ResetPassword />);

    await waitFor(() => expect(screen.getByText('Create a new password')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: COMPLIANT } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'S9!riverston3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(screen.getAllByText('Passwords do not match').length).toBeGreaterThan(0),
    );
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
