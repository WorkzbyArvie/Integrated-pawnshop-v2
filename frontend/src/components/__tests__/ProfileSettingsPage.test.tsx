import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileSettingsPage } from '../../pages/ProfileSettingsPage';
import { PROFILE_COPY, type MyProfile } from '../../lib/profile';
import * as profileApi from '../../lib/profile';

// Spy rather than module-mock so the real copy constants and the real
// build/validate logic stay in play; only the two network calls are stubbed.
const fetchMyProfile = vi.spyOn(profileApi, 'fetchMyProfile');
const updateMyProfile = vi.spyOn(profileApi, 'updateMyProfile');

const PROFILE: MyProfile = {
  id: 'user-1',
  email: 'owner@pawngold.ph',
  fullName: 'Ana Dela Cruz',
  phoneNumber: '09171234567',
  address: '123 Rizal St, Dasmarinas',
  dateOfBirth: '1990-04-12T00:00:00.000Z',
  avatarUrl: null,
  role: 'OWNER',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ProfileSettingsPage', () => {
  beforeEach(() => {
    fetchMyProfile.mockReset();
    fetchMyProfile.mockResolvedValue(PROFILE);
    updateMyProfile.mockReset();
    updateMyProfile.mockImplementation(async (input) => ({
      ...PROFILE,
      ...input,
      updatedAt: '2026-02-02T00:00:00.000Z',
    }));
  });

  it('renders the page heading', async () => {
    render(<ProfileSettingsPage />);
    expect(
      await screen.findByRole('heading', { name: PROFILE_COPY.heading }),
    ).toHaveTextContent('Profile settings');
  });

  it('populates every editable field from the server profile', async () => {
    render(<ProfileSettingsPage />);
    expect(await screen.findByLabelText(PROFILE_COPY.fullName)).toHaveValue('Ana Dela Cruz');
    expect(screen.getByLabelText(PROFILE_COPY.phoneNumber)).toHaveValue('09171234567');
    expect(screen.getByLabelText(PROFILE_COPY.dateOfBirth)).toHaveValue('1990-04-12');
  });

  it('shows the email read-only with an explanation', async () => {
    render(<ProfileSettingsPage />);
    expect(await screen.findByText('owner@pawngold.ph')).toBeInTheDocument();
    expect(screen.getByText(PROFILE_COPY.emailNote)).toBeInTheDocument();
    expect(screen.queryByLabelText(PROFILE_COPY.emailReadOnly)).not.toBeInTheDocument();
  });

  it('sends only the changed field so untouched fields are not blanked', async () => {
    render(<ProfileSettingsPage />);
    const name = await screen.findByLabelText(PROFILE_COPY.fullName);
    fireEvent.change(name, { target: { value: 'Ana Dela Cruz-Lopez' } });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));

    await waitFor(() => expect(updateMyProfile).toHaveBeenCalled());
    expect(updateMyProfile).toHaveBeenCalledWith({ fullName: 'Ana Dela Cruz-Lopez' });
  });

  it('sends nothing when no field changed', async () => {
    render(<ProfileSettingsPage />);
    await screen.findByLabelText(PROFILE_COPY.fullName);
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));
    await waitFor(() => expect(screen.getByText(PROFILE_COPY.saved)).toBeInTheDocument());
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it('confirms a successful save', async () => {
    render(<ProfileSettingsPage />);
    fireEvent.change(await screen.findByLabelText(PROFILE_COPY.fullName), {
      target: { value: 'New Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));
    expect(await screen.findByText(PROFILE_COPY.saved)).toBeInTheDocument();
  });

  it('rejects an over-length value before contacting the server', async () => {
    render(<ProfileSettingsPage />);
    const phone = await screen.findByLabelText(PROFILE_COPY.phoneNumber);
    fireEvent.change(phone, { target: { value: '9'.repeat(51) } });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('50 characters or fewer');
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it('rejects a future date of birth', async () => {
    render(<ProfileSettingsPage />);
    const dob = await screen.findByLabelText(PROFILE_COPY.dateOfBirth);
    const future = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10);
    fireEvent.change(dob, { target: { value: future } });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));

    // Reported twice by design: once in the focusable error summary and once
    // inline under the field.
    const messages = await screen.findAllByText(PROFILE_COPY.futureDate);
    expect(messages.length).toBe(2);
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it('surfaces a save failure without claiming success', async () => {
    updateMyProfile.mockRejectedValue(new Error('server down'));
    render(<ProfileSettingsPage />);
    fireEvent.change(await screen.findByLabelText(PROFILE_COPY.fullName), {
      target: { value: 'New Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));

    expect(await screen.findByText(PROFILE_COPY.saveError)).toBeInTheDocument();
    expect(screen.queryByText(PROFILE_COPY.saved)).not.toBeInTheDocument();
  });

  it('offers a retry when the profile cannot be loaded', async () => {
    fetchMyProfile.mockRejectedValue(new Error('offline'));
    render(<ProfileSettingsPage />);

    expect(await screen.findByText(PROFILE_COPY.loadError)).toBeInTheDocument();
    await waitFor(() => expect(fetchMyProfile).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.retry }));
    await waitFor(() => expect(fetchMyProfile).toHaveBeenCalledTimes(2));
  });

  it('fails closed when the server returns no profile', async () => {
    fetchMyProfile.mockResolvedValue(null);
    render(<ProfileSettingsPage />);
    expect(await screen.findByText(PROFILE_COPY.loadError)).toBeInTheDocument();
  });

  it('reverts the draft on cancel', async () => {
    render(<ProfileSettingsPage />);
    const name = await screen.findByLabelText(PROFILE_COPY.fullName);
    fireEvent.change(name, { target: { value: 'Unsaved Edit' } });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.cancel }));
    expect(name).toHaveValue('Ana Dela Cruz');
  });

  it('reports the changed profile to the caller on save', async () => {
    const onSaved = vi.fn();
    render(<ProfileSettingsPage onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText(PROFILE_COPY.fullName), {
      target: { value: 'New Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: PROFILE_COPY.save }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0][0]).toMatchObject({ fullName: 'New Name' });
  });
});
