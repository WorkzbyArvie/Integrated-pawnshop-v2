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
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou1',
  'admin1234',
  'welcome123',
  'letmein123',
  'monkey1234',
  'dragon1234',
  'baseball1',
  'football1',
  'trustno123',
  'sunshine1',
  'princess1',
  'passw0rd123',
]);

/** Obvious variant: a common password with simple character substitutions appended. */
function isObviousVariant(value: string): boolean {
  const normalized = value.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return true;
  const collapsed = normalized
    .replace(/[0]/g, 'o')
    .replace(/[1!]/g, 'l')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't');
  for (const common of COMMON_PASSWORDS) {
    if (collapsed === common) return true;
    if (collapsed.startsWith(common) && collapsed.length - common.length <= 3) return true;
  }
  return false;
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
      PASSWORD_POLICY.rejectSurroundingWhitespace
        ? value === value.trim()
        : true,
    common: value.length > 0 ? !isObviousVariant(value) : true,
  };
}

export function isPasswordCompliant(value: string): boolean {
  return Object.values(evaluatePasswordRules(value)).every(Boolean);
}

export function failedPasswordRules(value: string): PasswordRuleKey[] {
  const result = evaluatePasswordRules(value);
  return PASSWORD_RULE_ORDER.filter((key) => !result[key]);
}
