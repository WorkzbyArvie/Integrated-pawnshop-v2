/**
 * Client-side mirror of the server-owned password policy (D-01).
 *
 * The backend in `backend/src/security/password-policy.constants.ts` is the only
 * accepting authority. This module exists for immediate guidance only and never
 * decides whether a password is acceptable — the server still rejects a
 * non-compliant value.
 */

export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  rejectSurroundingWhitespace: true,
} as const;

export const PASSWORD_RULE_LABELS = {
  minLength: `${PASSWORD_POLICY.minLength}–${PASSWORD_POLICY.maxLength} characters`,
  uppercase: 'One uppercase letter',
  lowercase: 'One lowercase letter',
  number: 'One number',
  symbol: 'One symbol',
  noSurroundingWhitespace: 'No leading or trailing spaces',
  common: 'Not a common password or obvious variant',
} as const;

export const PASSWORD_REQUIREMENTS_HEADING = 'Password requirements';
export const PASSWORD_REQUIREMENTS_MET = 'All password requirements met';

export const PASSWORD_RULE_ORDER = [
  'minLength',
  'uppercase',
  'lowercase',
  'number',
  'symbol',
  'noSurroundingWhitespace',
  'common',
] as const;

export type PasswordRuleKey = (typeof PASSWORD_RULE_ORDER)[number];

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

/**
 * Faithful mirror of `normalizePasswordVariant` in
 * `backend/src/security/password-policy.service.ts`. The substitution is a
 * single pass so one substitution can never cascade into another.
 */
function normalizePasswordVariant(value: string): string {
  const substitutions: Record<string, string> = {
    '@': 'a',
    '4': 'a',
    '8': 'b',
    '(': 'c',
    '3': 'e',
    '6': 'g',
    '1': 'i',
    '0': 'o',
    '$': 's',
    '5': 's',
    '7': 't',
    '+': 't',
  };

  return value
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((character) => substitutions[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

function isCommonPassword(value: string): boolean {
  return COMMON_PASSWORDS.has(normalizePasswordVariant(value));
}

export function evaluatePasswordRules(value: string): Record<PasswordRuleKey, boolean> {
  return {
    minLength:
      value.length >= PASSWORD_POLICY.minLength && value.length <= PASSWORD_POLICY.maxLength,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
    noSurroundingWhitespace:
      PASSWORD_POLICY.rejectSurroundingWhitespace ? value === value.trim() : true,
    common: value.length > 0 ? !isCommonPassword(value) : true,
  };
}

export function isPasswordCompliant(value: string): boolean {
  return Object.values(evaluatePasswordRules(value)).every(Boolean);
}

export function failedPasswordRules(value: string): PasswordRuleKey[] {
  const result = evaluatePasswordRules(value);
  return PASSWORD_RULE_ORDER.filter((key) => !result[key]);
}
