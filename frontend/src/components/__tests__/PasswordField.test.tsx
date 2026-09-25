import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { PasswordErrorSummary, PasswordField } from '../Auth/PasswordField';

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
});
