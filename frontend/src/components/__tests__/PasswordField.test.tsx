import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  PASSWORD_CONFIRMATION_MISMATCH,
  PasswordConfirmField,
  PasswordErrorSummary,
  PasswordField,
} from '../Auth/PasswordField';
import { ApiError } from '../../lib/apiClient';

function ControlledPasswordField({ error }: { error?: string }) {
  const [value, setValue] = useState('');
  return (
    <PasswordField
      id="ownerPassword"
      name="ownerPassword"
      label="Password"
      value={value}
      onChange={setValue}
      error={error}
      helperText="Use a private password you do not use elsewhere."
    />
  );
}

function ControlledConfirmForm({ mismatch }: { mismatch?: boolean }) {
  const [value, setValue] = useState('S9!riverstone');
  const [confirm, setConfirm] = useState(mismatch ? 'S9!riverston3' : 'S9!riverstone');
  const confirmError = mismatch ? PASSWORD_CONFIRMATION_MISMATCH : undefined;
  return (
    <>
      <PasswordField
        id="ownerPassword"
        name="ownerPassword"
        label="New password"
        value={value}
        onChange={setValue}
        error={mismatch ? 'Password requirements are not met.' : undefined}
        errorSummaryId="owner-password-error-summary"
        autoComplete="new-password"
      />
      <PasswordConfirmField
        id="ownerConfirmPassword"
        name="ownerConfirmPassword"
        value={confirm}
        onChange={setConfirm}
        error={confirmError}
        errorSummaryId="owner-password-error-summary"
      />
      <PasswordErrorSummary
        id="owner-password-error-summary"
        message={confirmError ?? 'Check the password requirements and try again.'}
        fieldId="ownerConfirmPassword"
      />
    </>
  );
}

describe('PasswordField', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows the exact accessible checklist and never persists the secret', () => {
    render(<ControlledPasswordField />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'S9!riverstone' } });

    expect(screen.getByText('Password requirements')).toBeInTheDocument();
    expect(screen.getByText('10–128 characters')).toBeInTheDocument();
    expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
    expect(screen.getByText('One lowercase letter')).toBeInTheDocument();
    expect(screen.getByText('One number')).toBeInTheDocument();
    expect(screen.getByText('One symbol')).toBeInTheDocument();
    expect(screen.getByText('No leading or trailing spaces')).toBeInTheDocument();
    expect(screen.getByText('Not a common password or obvious variant')).toBeInTheDocument();
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('aria-describedby');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('exposes safe machine error and failed-rule data without request secrets', () => {
    const error = new ApiError('Password policy failed', 400, {
      error: 'PASSWORD_POLICY_FAILED',
      data: { failed: ['minLength', 'symbol'] },
    });

    expect((error as any).code).toBe('PASSWORD_POLICY_FAILED');
    expect((error as any).failedRules).toEqual(['minLength', 'symbol']);
    expect(JSON.stringify(error)).not.toContain('password');
  });

  it('toggles visibility with a real accessible button', () => {
    render(<ControlledPasswordField />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const show = screen.getByRole('button', { name: 'Show password' });

    expect(input).toHaveAttribute('type', 'password');
    expect(show).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(show);

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('focuses a linked error summary and returns focus to the field', async () => {
    render(
      <>
        <ControlledPasswordField error="Password requirements are not met." />
        <PasswordErrorSummary
          id="owner-password-error-summary"
          message="Check the password requirements and try again."
          fieldId="ownerPassword"
        />
      </>,
    );

    const summary = screen.getByRole('alert');
    await waitFor(() => expect(summary).toHaveFocus());
    fireEvent.click(screen.getByRole('link', { name: 'Review password' }));
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('preserves a pasted or autofilled value and never blocks clipboard input', () => {
    render(<ControlledPasswordField />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;

    expect(input).not.toHaveAttribute('readonly');
    expect(input).not.toHaveAttribute('maxlength', '0');

    fireEvent.paste(input, {
      clipboardData: { getData: () => 'Pawn!Ledger9' },
    });
    fireEvent.change(input, { target: { value: 'Pawn!Ledger9' } });

    expect(input).toHaveValue('Pawn!Ledger9');
    expect(screen.getByText('All password requirements met')).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps the checklist visible while a new-password field is invalid', () => {
    render(<ControlledPasswordField error="Password requirements are not met." />);

    expect(screen.getByText('Password requirements')).toBeInTheDocument();
    expect(screen.getByText('One symbol')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses the approved mismatch copy on the confirmation field and focuses the linked summary', async () => {
    render(<ControlledConfirmForm mismatch />);

    const confirm = screen.getByLabelText('Confirm password') as HTMLInputElement;
    expect(confirm).toHaveAttribute('autocomplete', 'new-password');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText(PASSWORD_CONFIRMATION_MISMATCH).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Password requirements')).toBeInTheDocument();

    const summary = screen.getByRole('alert');
    await waitFor(() => expect(summary).toHaveFocus());
  });
});
