import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { clearMfaAssertion, setMfaAssertion } from '../../lib/authHeaders';
import * as credentialApi from '../../lib/credentialApi';
import { supabase } from '../../lib/supabaseClient';

vi.mock('../../lib/credentialApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/credentialApi')>(
    '../../lib/credentialApi',
  );
  return { ...actual, fetchCredentialStatus: vi.fn() };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const fetchCredentialStatus = vi.mocked(credentialApi.fetchCredentialStatus);

const SESSION = {
  access_token: 'token-123',
  user: { id: 'user-1', email: 'bidder@example.com' },
} as never;

function Probe() {
  const { credentialState, credentialStatus, mfaRequired } = useAuth();
  return (
    <div>
      <span data-testid="credential-state">{credentialState}</span>
      <span data-testid="mfa-enabled">{String(credentialStatus?.mfaEnabled ?? 'none')}</span>
      <span data-testid="mfa-required">{String(mfaRequired)}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthContext credential state', () => {
  beforeEach(() => {
    clearMfaAssertion();
    fetchCredentialStatus.mockReset();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as never);
  });

  it('resolves to ready for an authenticated bidder with MFA off', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: SESSION }, error: null });
    fetchCredentialStatus.mockResolvedValue({
      mustChangePassword: false,
      reason: null,
      markedAt: null,
      mfaEnabled: false,
      mfaEmailMasked: null,
      passwordUpdatedAt: null,
    });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('credential-state')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('mfa-required')).toHaveTextContent('false');
  });

  it('requires the MFA challenge when the server reports MFA on and no assertion is held', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: SESSION }, error: null });
    fetchCredentialStatus.mockResolvedValue({
      mustChangePassword: false,
      reason: null,
      markedAt: null,
      mfaEnabled: true,
      mfaEmailMasked: 'b••••r@example.com',
      passwordUpdatedAt: null,
    });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('mfa-required')).toHaveTextContent('true');
    });
  });

  it('clears the MFA requirement once a session assertion is held', async () => {
    setMfaAssertion('assertion-abc', { userId: 'user-1' });
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: SESSION }, error: null });
    fetchCredentialStatus.mockResolvedValue({
      mustChangePassword: false,
      reason: null,
      markedAt: null,
      mfaEnabled: true,
      mfaEmailMasked: 'b••••r@example.com',
      passwordUpdatedAt: null,
    });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('mfa-required')).toHaveTextContent('false');
    });
  });

  it('fails closed to unavailable when the status cannot be confirmed', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: SESSION }, error: null });
    fetchCredentialStatus.mockResolvedValue(null);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('credential-state')).toHaveTextContent('unavailable');
    });
  });

  it('fails closed to unavailable when the status request rejects', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: SESSION }, error: null });
    fetchCredentialStatus.mockRejectedValue(
      new credentialApi.CredentialApiError('nope', 503, 'CREDENTIAL_STATE_UNAVAILABLE'),
    );

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('credential-state')).toHaveTextContent('unavailable');
    });
  });

  it('never requires MFA for an unauthenticated visitor', async () => {
    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required')).toHaveTextContent('false');
    });
    expect(fetchCredentialStatus).not.toHaveBeenCalled();
  });
});
