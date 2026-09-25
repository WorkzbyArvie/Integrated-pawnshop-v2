export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  uppercasePattern: /[A-Z]/,
  lowercasePattern: /[a-z]/,
  numberPattern: /[0-9]/,
  symbolPattern: /[^A-Za-z0-9]/,
  rejectSurroundingWhitespace: true,
} as const;

export const PASSWORD_RULE_KEYS = [
  'minLength',
  'maxLength',
  'uppercase',
  'lowercase',
  'number',
  'symbol',
  'noSurroundingWhitespace',
  'common',
] as const;

export type PasswordRuleKey = (typeof PASSWORD_RULE_KEYS)[number];
