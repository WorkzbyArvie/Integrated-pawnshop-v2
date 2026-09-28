import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ACCOUNT_SECURITY_COPY, AccountSecuritySection } from '../AccountSecuritySection';
import { clearMfaAssertion } from '../../lib/authHeaders';
import * as credentialApi from '../../lib/credentialApi';

vi.mock('../../lib/credentialApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/credentialApi')>(
    '../../lib/credentialApi',
  );
  return {
    ...actual,
    fetchCredentialStatus: vi.fn(),
    fetchSecurityActivity: vi.fn(),
    submitPasswordChange: vi.fn(),
    startMfaEnrollment: vi.fn(),
    completeMfaEnrollment: vi.fn(),
    disableMfa: vi.fn(),
  };
});

const fetchCredentialStatus = vi.mocked(credentialApi.fetchCredentialStatus);
const fetchSecurityActivity = vi.mocked(credentialApi.fetchSecurityActivity);
const submitPasswordChange = vi.mocked(credentialApi.submitPasswordChange);
const startMfaEnrollment = vi.mocked(credentialApi.startMfaEnrollment);
const completeMfaEnrollment = vi.mocked(credentialApi.completeMfaEnrollment);
const disableMfa = vi.mocked(credentialApi.disableMfa);

const COMPLIANT = 'Str0ng!Passphrase';

const READY_STATUS = {
  mustChangePassword: false,
  reason: null,
  markedAt: null,
  mfaEnabled: false,
  mfaEmailMasked: 'b••••r@example.com',
  passwordUpdatedAt: null,
};

function renderSection() {
  return render(
    <AccountSecuritySection
      accessToken="token-123"
      userId="user-1"
      email="bidder@example.com"
    />,
  );
}

describe('AccountSecuritySection', () => {
  beforeEach(() => {
    clearMfaAssertion();
    fetchCredentialStatus.mockReset().mockResolvedValue(READY_STATUS);
    fetchSecurityActivity.mockReset().mockResolvedValue([]);
    submitPasswordChange.mockReset().mockResolvedValue(undefined);
    startMfaEnrollment.mockReset().mockResolvedValue({
      challengeId: 'challenge-1',
      expiresAt: null,
      maskedEmail: 'b••••r@example.com',
    });
    completeMfaEnrollment.mockReset().mockResolvedValue(undefined);
    disableMfa.mockReset().mockResolvedValue(undefined);
  });

  it('renders the section heading as the first focusable element', async () => {
    renderSection();
    expect(
      await screen.findByRole('heading', { name: ACCOUNT_SECURITY_COPY.heading }),
    ).toBeInTheDocument();
  });

  it('shows the masked MFA destination rather than a raw address', async () => {
    renderSection();
    expect(
      await screen.findByText(ACCOUNT_SECURITY_COPY.codesGoTo('b••••r@example.com')),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bidder@example\.com/)).not.toBeInTheDocument();
  });

  it('reports the password as current and MFA as not enabled', async () => {
    renderSection();
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.current)).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_SECURITY_COPY.notEnabled)).toBeInTheDocument();
  });

  it('surfaces a change-required password state', async () => {
    fetchCredentialStatus.mockResolvedValue({ ...READY_STATUS, mustChangePassword: true });
    renderSection();
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.changeRequired)).toBeInTheDocument();
  });

  it('fails closed to Unavailable when the status cannot be read', async () => {
    fetchCredentialStatus.mockResolvedValue(null);
    renderSection();
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.unavailable)).toBeInTheDocument();
  });

  it('shows the empty activity state', async () => {
    renderSection();
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.activityEmptyHeading)).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_SECURITY_COPY.activityEmptyBody)).toBeInTheDocument();
  });

  it('offers a retry only for a failed activity load', async () => {
    fetchSecurityActivity.mockRejectedValue(new Error('offline'));
    renderSection();
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.activityLoadError)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.retry });
    await waitFor(() => expect(fetchSecurityActivity).toHaveBeenCalledTimes(1));
    fireEvent.click(retry);
    await waitFor(() => expect(fetchSecurityActivity).toHaveBeenCalledTimes(2));
  });

  it('blocks a non-compliant password change and never sends it', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.changePassword }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.currentPasswordLabel), {
      target: { value: 'token-123' },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.newPasswordLabel), {
      target: { value: 'weak' },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.confirmPasswordLabel), {
      target: { value: 'weak' },
    });
    expect(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.updatePassword })).toBeDisabled();
    expect(submitPasswordChange).not.toHaveBeenCalled();
  });

  it('submits a compliant password change and reports success', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.changePassword }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.currentPasswordLabel), {
      target: { value: 'old-password' },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.newPasswordLabel), {
      target: { value: COMPLIANT },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.confirmPasswordLabel), {
      target: { value: COMPLIANT },
    });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.updatePassword }));

    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.passwordUpdated)).toBeInTheDocument();
    expect(submitPasswordChange).toHaveBeenCalledWith(
      expect.objectContaining({ newPassword: COMPLIANT }),
    );
  });

  it('reports a mismatch instead of submitting', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.changePassword }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.currentPasswordLabel), {
      target: { value: 'old-password' },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.newPasswordLabel), {
      target: { value: COMPLIANT },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.confirmPasswordLabel), {
      target: { value: `${COMPLIANT}x` },
    });
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.mismatch)).toBeInTheDocument();
    expect(submitPasswordChange).not.toHaveBeenCalled();
  });

  it('reports an invalid current password without echoing the secret', async () => {
    submitPasswordChange.mockRejectedValue(
      new credentialApi.CredentialApiError('nope', 400, 'CURRENT_PASSWORD_INVALID'),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.changePassword }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.currentPasswordLabel), {
      target: { value: 'wrong-password' },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.newPasswordLabel), {
      target: { value: COMPLIANT },
    });
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.confirmPasswordLabel), {
      target: { value: COMPLIANT },
    });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.updatePassword }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ACCOUNT_SECURITY_COPY.currentPasswordInvalid);
    expect(alert.textContent).not.toContain('wrong-password');
    expect(alert.textContent).not.toContain(COMPLIANT);
  });

  it('requires the current password before requesting an enrollment code', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.enableMfa }));
    const request = screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.requestCode });
    expect(request).toBeDisabled();

    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.currentPasswordPrompt), {
      target: { value: 'old-password' },
    });
    fireEvent.click(request);
    await waitFor(() => expect(startMfaEnrollment).toHaveBeenCalled());
    expect(startMfaEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ currentPassword: 'old-password' }),
    );
  });

  it('enables MFA only after a six-digit code is verified', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.enableMfa }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.currentPasswordPrompt), {
      target: { value: 'old-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.requestCode }));

    const verify = await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.verifyCode });
    expect(verify).toBeDisabled();
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.codeLabel), {
      target: { value: '123456' },
    });
    fireEvent.click(verify);

    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.mfaEnabled)).toBeInTheDocument();
    expect(completeMfaEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: 'challenge-1', code: '123456' }),
    );
  });

  it('keeps MFA enabled when a disable attempt is cancelled at confirmation', async () => {
    fetchCredentialStatus.mockResolvedValue({ ...READY_STATUS, mfaEnabled: true });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.disableMfa }));
    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.disableConfirm)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.keepEnabled }));

    expect(disableMfa).not.toHaveBeenCalled();
    expect(screen.getByText(ACCOUNT_SECURITY_COPY.enabled)).toBeInTheDocument();
  });

  it('requires both the password and the code before disabling MFA', async () => {
    fetchCredentialStatus.mockResolvedValue({ ...READY_STATUS, mfaEnabled: true });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.disableMfa }));
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.continueLabel }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.disablePasswordPrompt), {
      target: { value: 'old-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.requestCode }));

    const verify = await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.verifyCode });
    expect(disableMfa).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.codeLabel), {
      target: { value: '654321' },
    });
    fireEvent.click(verify);

    await waitFor(() =>
      expect(disableMfa).toHaveBeenCalledWith(
        expect.objectContaining({ currentPassword: 'old-password', code: '654321' }),
      ),
    );
  });

  it('reports a failed disable without claiming MFA was turned off', async () => {
    fetchCredentialStatus.mockResolvedValue({ ...READY_STATUS, mfaEnabled: true });
    disableMfa.mockRejectedValue(
      new credentialApi.CredentialApiError('nope', 400, 'MFA_CHALLENGE_INVALID'),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.disableMfa }));
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT_SECURITY_COPY.continueLabel }));
    fireEvent.change(screen.getByLabelText(ACCOUNT_SECURITY_COPY.disablePasswordPrompt), {
      target: { value: 'old-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.requestCode }));
    fireEvent.change(await screen.findByLabelText(ACCOUNT_SECURITY_COPY.codeLabel), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_SECURITY_COPY.verifyCode }));

    expect(await screen.findByText(ACCOUNT_SECURITY_COPY.mfaUnchanged)).toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_SECURITY_COPY.mfaDisabled)).not.toBeInTheDocument();
  });
});
