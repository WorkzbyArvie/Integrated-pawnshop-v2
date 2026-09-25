import { useEffect, useRef, useState, type InputHTMLAttributes, type RefObject } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '../ui/input';
import { PasswordRequirements } from './PasswordRequirements';

export interface PasswordFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'name' | 'value' | 'defaultValue' | 'onChange' | 'type' | 'autoComplete'
  > {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  showRequirements?: boolean;
  autoComplete?: 'current-password' | 'new-password';
  errorSummaryId?: string;
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
  errorSummaryId,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const requirementsId = `${id}-requirements`;
  const describedBy = [
    helperText ? helperId : null,
    showRequirements ? requirementsId : null,
    error ? errorId : null,
    error ? errorSummaryId : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      <div className="relative">
        <Input
          {...inputProps}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={10}
          maxLength={128}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className="h-11 rounded-[12px] border-[#C9A05C]/30 bg-white/[0.05] px-3.5 pr-12 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#C9A05C]"
          style={{
            background: 'rgba(255,255,255,0.05)',
            borderColor: 'rgba(201,160,92,0.3)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A05C]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      {helperText && (
        <p id={helperId} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {helperText}
        </p>
      )}
      {showRequirements && <PasswordRequirements id={requirementsId} value={value} />}
      {error && (
        <p id={errorId} className="text-[12px]" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
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
  summaryRef?: RefObject<HTMLDivElement | null>;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const activeRef = summaryRef ?? internalRef;

  useEffect(() => {
    if (message) activeRef.current?.focus();
  }, [activeRef, message]);

  return (
    <div
      id={id}
      ref={activeRef}
      role="alert"
      tabIndex={-1}
      className="rounded-[10px] border px-3 py-2 text-[12px]"
      style={{ background: 'rgba(212,69,69,0.1)', borderColor: 'rgba(212,69,69,0.2)', color: 'var(--red)' }}
    >
      <p>{message}</p>
      <a
        href={`#${fieldId}`}
        className="mt-1 inline-block underline"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(fieldId)?.focus();
        }}
      >
        Review password
      </a>
    </div>
  );
}
