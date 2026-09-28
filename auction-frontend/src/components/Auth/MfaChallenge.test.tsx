import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MFA_LOGIN_CHALLENGE_COPY, MfaChallenge } from './MfaChallenge';
import { clearMfaAssertion } from '../../lib/authHeaders';
import * as credentialApi from '../../lib/credentialApi';

vi.mock('../../lib/credentialApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/credentialApi')>(
    '../../lib/credentialApi',
  );
  return {
    ...actual,
    startLoginChallenge: vi.fn(),
    verifyLoginChallenge: vi.fn(),
  };
});

const startLoginChallenge = vi.mocked(credentialApi.startLoginChallenge);
const verifyLoginChallenge = vi.mocked(credentialApi.verifyLoginChallenge);

function renderChallenge(
  overrides: Partial<React.ComponentProps<typeof MfaChallenge>> = {},
) {
  return render(
    <MfaChallenge
      email="bidder@example.com"
      accessToken="token-123"
      userId="user-1"
      onVerified={() => undefined}
      onSignOut={() => undefined}
      {...overrides}
    />,
  );
}

describe('MfaChallenge', () => {
  beforeEach(() => {
    clearMfaAssertion();
    startLoginChallenge.mockReset();
    verifyLoginChallenge.mockReset();
    startLoginChallenge.mockResolvedValue({
      challenge: {
        challengeId: 'challenge-1',
        expiresAt: null,
        maskedEmail: 'b••••r@example.com',
      },
      assertion: '',
      expiresAt: null,
      userId: null,
    });
    verifyLoginChallenge.mockResolvedValue(undefined);
  });

  it('renders the approved heading and requests a challenge on mount', async () => {
    renderChallenge();
    expect(
      await screen.findByRole('heading', { name: MFA_LOGIN_CHALLENGE_COPY.heading }),
    ).toHaveTextContent('Verify your sign-in');
    expect(startLoginChallenge).toHaveBeenCalledWith('bidder@example.com');
  });

  it('is a non-dismissible modal with no close control', async () => {
    renderChallenge();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-mfa-challenge', 'required');
    expect(
      dialog.querySelector('button[aria-label*="close" i], button[data-slot="close"]'),
    ).toBeNull();
  });

  it('shows the masked destination in the explanation', async () => {
    renderChallenge();
    expect(await screen.findByText(/Enter the six-digit code sent to/)).toBeInTheDocument();
  });

  it('keeps verify disabled until six digits are entered', async () => {
    renderChallenge();
    const verify = await screen.findByRole('button', {
      name: MFA_LOGIN_CHALLENGE_COPY.verifyCode,
    });
    expect(verify).toBeDisabled();

    fireEvent.change(screen.getByLabelText(MFA_LOGIN_CHALLENGE_COPY.codeLabel), {
      target: { value: '123456' },
    });
    expect(verify).toBeEnabled();
  });

  it('accepts only digits and caps the code at six characters', async () => {
    renderChallenge();
    const input = (await screen.findByLabelText(
      MFA_LOGIN_CHALLENGE_COPY.codeLabel,
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab3456789' } });
    expect(input.value).toBe('123456');
  });

  it('surfaces a rate-limit alert on a 429', async () => {
    verifyLoginChallenge.mockRejectedValue(
      Object.assign(new Error('locked'), { status: 429, code: 'MFA_CHALLENGE_LOCKED' }),
    );
    renderChallenge();
    const input = await screen.findByLabelText(MFA_LOGIN_CHALLENGE_COPY.codeLabel);
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: MFA_LOGIN_CHALLENGE_COPY.verifyCode }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      MFA_LOGIN_CHALLENGE_COPY.tooManyAttempts,
    );
  });

  it('reports an invalid code without leaking the submitted value', async () => {
    verifyLoginChallenge.mockRejectedValue(
      Object.assign(new Error('bad'), { status: 400, code: 'MFA_CHALLENGE_INVALID' }),
    );
    renderChallenge();
    const input = await screen.findByLabelText(MFA_LOGIN_CHALLENGE_COPY.codeLabel);
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: MFA_LOGIN_CHALLENGE_COPY.verifyCode }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(MFA_LOGIN_CHALLENGE_COPY.invalidCode);
    expect(alert.textContent).not.toContain('000000');
  });

  it('clears the code after a failed verification', async () => {
    verifyLoginChallenge.mockRejectedValue(
      Object.assign(new Error('bad'), { status: 400, code: 'MFA_CHALLENGE_INVALID' }),
    );
    renderChallenge();
    const input = (await screen.findByLabelText(
      MFA_LOGIN_CHALLENGE_COPY.codeLabel,
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: MFA_LOGIN_CHALLENGE_COPY.verifyCode }));
    await screen.findByRole('alert');
    expect(input.value).toBe('');
  });

  it('exposes a request-new-code path when the challenge could not be issued', async () => {
    startLoginChallenge.mockRejectedValue(new Error('network'));
    renderChallenge();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      MFA_LOGIN_CHALLENGE_COPY.requestFailed,
    );
    expect(
      screen.getByRole('button', { name: MFA_LOGIN_CHALLENGE_COPY.requestNewCode }),
    ).toBeInTheDocument();
  });

  it('offers sign out on the escape path', async () => {
    const onSignOut = vi.fn();
    renderChallenge({ onSignOut });
    fireEvent.click(
      await screen.findByRole('button', { name: MFA_LOGIN_CHALLENGE_COPY.signOut }),
    );
    expect(onSignOut).toHaveBeenCalled();
  });
});
