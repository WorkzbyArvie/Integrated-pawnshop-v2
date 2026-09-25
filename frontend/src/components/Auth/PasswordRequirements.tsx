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
} as const;

export function getPasswordRuleFailures(value: string): PasswordRuleKey[] {
  if (!value) return ['minLength'];
  return [];
}

export function PasswordRequirements({ id }: { id: string; value?: string }) {
  return <div id={id}>Password requirements</div>;
}
