import { Check, Circle } from 'lucide-react';

export type PasswordRuleKey =
  | 'minLength'
  | 'maxLength'
  | 'uppercase'
  | 'lowercase'
  | 'number'
  | 'symbol'
  | 'noSurroundingWhitespace'
  | 'common';

export const PASSWORD_RULE_COPY = {
  length: '10–128 characters',
  uppercase: 'One uppercase letter',
  lowercase: 'One lowercase letter',
  number: 'One number',
  symbol: 'One symbol',
  whitespace: 'No leading or trailing spaces',
  common: 'Not a common password or obvious variant',
  complete: 'All password requirements met',
  mismatch: 'Passwords do not match',
  show: 'Show password',
  hide: 'Hide password',
  heading: 'Password requirements',
} as const;

const COMMON_PASSWORDS = new Set([
  'password',
  'passwd',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'master',
  'shadow',
  'sunshine',
  'princess',
  'abc',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
]);

const VARIANT_SUBSTITUTIONS: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '(': 'c',
  '3': 'e',
  '6': 'g',
  '1': 'i',
  '0': 'o',
  $: 's',
  '5': 's',
  '7': 't',
  '+': 't',
};

function normalizePasswordVariant(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((character) => VARIANT_SUBSTITUTIONS[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

export function getPasswordRuleFailures(value: string): PasswordRuleKey[] {
  const failed: PasswordRuleKey[] = [];
  if (value.length < 10) failed.push('minLength');
  if (value.length > 128) failed.push('maxLength');
  if (!/[A-Z]/.test(value)) failed.push('uppercase');
  if (!/[a-z]/.test(value)) failed.push('lowercase');
  if (!/[0-9]/.test(value)) failed.push('number');
  if (!/[^A-Za-z0-9]/.test(value)) failed.push('symbol');
  if (value.length === 0 || value !== value.trim()) {
    failed.push('noSurroundingWhitespace');
  }
  if (value.length === 0 || COMMON_PASSWORDS.has(normalizePasswordVariant(value))) {
    failed.push('common');
  }
  return failed;
}

const RULE_ROWS: Array<{
  id: string;
  keys: PasswordRuleKey[];
  label: string;
  met: (value: string) => boolean;
}> = [
  {
    id: 'length',
    keys: ['minLength', 'maxLength'],
    label: PASSWORD_RULE_COPY.length,
    met: (value) => value.length >= 10 && value.length <= 128,
  },
  {
    id: 'uppercase',
    keys: ['uppercase'],
    label: PASSWORD_RULE_COPY.uppercase,
    met: (value) => /[A-Z]/.test(value),
  },
  {
    id: 'lowercase',
    keys: ['lowercase'],
    label: PASSWORD_RULE_COPY.lowercase,
    met: (value) => /[a-z]/.test(value),
  },
  {
    id: 'number',
    keys: ['number'],
    label: PASSWORD_RULE_COPY.number,
    met: (value) => /[0-9]/.test(value),
  },
  {
    id: 'symbol',
    keys: ['symbol'],
    label: PASSWORD_RULE_COPY.symbol,
    met: (value) => /[^A-Za-z0-9]/.test(value),
  },
  {
    id: 'whitespace',
    keys: ['noSurroundingWhitespace'],
    label: PASSWORD_RULE_COPY.whitespace,
    met: (value) => value.length > 0 && value === value.trim(),
  },
  {
    id: 'common',
    keys: ['common'],
    label: PASSWORD_RULE_COPY.common,
    met: (value) => value.length > 0 && !COMMON_PASSWORDS.has(normalizePasswordVariant(value)),
  },
];

export function PasswordRequirements({
  id,
  value = '',
}: {
  id: string;
  value?: string;
}) {
  const allMet = getPasswordRuleFailures(value).length === 0 && value.length > 0;

  return (
    <div className="space-y-2" aria-live="polite">
      <p id={`${id}-heading`} className="text-[14px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {PASSWORD_RULE_COPY.heading}
      </p>
      <ul
        id={id}
        aria-labelledby={`${id}-heading`}
        className="grid gap-1.5 sm:grid-cols-2"
      >
        {RULE_ROWS.map((rule) => {
          const met = rule.met(value);
          return (
            <li
              key={rule.id}
              data-rule={rule.id}
              data-rule-keys={rule.keys.join(' ')}
              data-state={met ? 'met' : 'not-met'}
              className="flex min-h-5 items-center gap-1.5 text-[14px]"
              style={{ color: met ? 'var(--text-secondary)' : 'var(--text-muted)' }}
            >
              {met ? (
                <Check size={14} aria-hidden="true" style={{ color: 'var(--green)' }} />
              ) : (
                <Circle size={14} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
              )}
              <span>{rule.label}</span>
              <span className="sr-only">{met ? 'Met' : 'Not met'}</span>
            </li>
          );
        })}
      </ul>
      {allMet && (
        <p role="status" className="text-[14px] font-medium" style={{ color: 'var(--green)' }}>
          {PASSWORD_RULE_COPY.complete}
        </p>
      )}
    </div>
  );
}
