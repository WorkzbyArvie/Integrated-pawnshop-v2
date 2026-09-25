import type { InputHTMLAttributes, RefObject } from 'react';
import { PasswordRequirements } from './PasswordRequirements';

export interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'name' | 'value' | 'defaultValue' | 'onChange' | 'type' | 'autoComplete'> {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  showRequirements?: boolean;
  autoComplete?: 'current-password' | 'new-password';
}

export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  helperText,
  showRequirements = true,
  autoComplete = 'new-password',
}: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
      />
      {helperText && <p>{helperText}</p>}
      {showRequirements && <PasswordRequirements id={`${id}-requirements`} value={value} />}
      {error && <p>{error}</p>}
    </div>
  );
}

export function PasswordErrorSummary({
  id,
  message,
  fieldId,
  summaryRef,
}: {
  id: string;
  message: string;
  fieldId: string;
  summaryRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <div id={id} ref={summaryRef} role="alert" tabIndex={-1}>
      <p>{message}</p>
      <a href={`#${fieldId}`}>Review password</a>
    </div>
  );
}
