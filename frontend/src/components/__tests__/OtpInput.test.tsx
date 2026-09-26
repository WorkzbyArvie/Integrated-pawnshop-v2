import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OTP_HELPER, OTP_LABEL, OTP_LENGTH, OtpInput } from '../Auth/OtpInput';

function renderOtp(overrides: Partial<React.ComponentProps<typeof OtpInput>> = {}) {
  const onChange = vi.fn();
  const onResend = vi.fn();
  const onVerify = vi.fn();
  const onExpired = vi.fn();
  const utils = render(
    <OtpInput
      id="mfa-code"
      value=""
      onChange={onChange}
      onResend={onResend}
      onVerify={onVerify}
      onExpired={onExpired}
      {...overrides}
    />,
  );
  return { ...utils, onChange, onResend, onVerify, onExpired };
}

function codeInput(): HTMLInputElement {
  return screen.getByLabelText(OTP_LABEL) as HTMLInputElement;
}

describe('OtpInput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes one semantic six-digit control with the approved label and helper copy', () => {
    renderOtp();

    const input = codeInput();
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('maxlength', String(OTP_LENGTH));
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByText(OTP_HELPER)).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('strips non-digits from typed input and keeps at most six digits', () => {
    const { onChange } = renderOtp();

    fireEvent.change(codeInput(), { target: { value: '1a2 3' } });
    expect(onChange).toHaveBeenLastCalledWith('123');

    fireEvent.change(codeInput(), { target: { value: '123456789' } });
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('applies a pasted full code without blocking the paste event', () => {
    const { onChange } = renderOtp();

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: () => '12 34-56' },
    });
    codeInput().dispatchEvent(pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('leaves a partial paste to the normal input path', () => {
    const { onChange } = renderOtp();

    fireEvent.paste(codeInput(), { clipboardData: { getData: () => '12' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the caret to the previous digit on backspace at the start and on delete at the end', () => {
    const { onChange } = renderOtp({ value: '123456' });
    const input = codeInput();
    input.setSelectionRange(0, 0);

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('12345');

    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(onChange).toHaveBeenLastCalledWith('12345');
  });

  it('supports Home and End caret navigation', () => {
    renderOtp({ value: '123456' });
    const input = codeInput();
    input.setSelectionRange(3, 3);

    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.selectionStart).toBe(0);

    fireEvent.keyDown(input, { key: 'End' });
    expect(input.selectionStart).toBe(6);
  });

  it('marks the field invalid and links the server message below it', () => {
    renderOtp({ error: 'That code is invalid or expired. Check the six digits or request a new code when the timer ends.' });

    const input = codeInput();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('mfa-code-helper');
    expect(describedBy).toContain('mfa-code-error');
    expect(
      screen.getByText(
        'That code is invalid or expired. Check the six digits or request a new code when the timer ends.',
      ),
    ).toBeInTheDocument();
  });

  it('requires an explicit verification action and never auto-submits on the sixth digit', () => {
    const { onVerify } = renderOtp({ value: '123456' });

    expect(onVerify).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  describe('resend cooldown', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('disables resend for sixty seconds and then offers it again', () => {
      const { onResend } = renderOtp({ resendAt: Date.now() + 60_000 });

      expect(screen.getByRole('button', { name: 'Resend code in 60' })).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      const ready = screen.getByRole('button', { name: 'Resend code' });
      expect(ready).toBeEnabled();
      fireEvent.click(ready);
      expect(onResend).toHaveBeenCalledTimes(1);
    });

    it('keeps resend unavailable while verification is locked after repeated failures', () => {
      renderOtp({ resendAt: null, resendDisabled: true, resendLabel: 'Request a new code' });

      expect(screen.getByRole('button', { name: 'Request a new code' })).toBeDisabled();
    });
  });

  it('signals expiry once so the caller can clear the value and refocus the field', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onExpired } = renderOtp({ expiresAt: Date.now() + 10_000 });

    expect(onExpired).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(onExpired).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
