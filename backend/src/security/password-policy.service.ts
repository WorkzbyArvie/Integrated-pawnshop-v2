import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PASSWORD_POLICY,
  type PasswordRuleKey,
} from './password-policy.constants';

export type PasswordPolicyFailureKey = PasswordRuleKey | 'required';

export interface PasswordPolicyResult {
  valid: boolean;
  failed: PasswordPolicyFailureKey[];
  message: string;
}

const POLICY_MESSAGE = 'Password does not meet the required policy.';
const SUCCESS_MESSAGE = 'Password meets the required policy.';

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

@Injectable()
export class PasswordPolicyService {
  evaluate(raw: unknown): PasswordPolicyResult {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { valid: false, failed: ['required'], message: POLICY_MESSAGE };
    }

    const failed: PasswordPolicyFailureKey[] = [];
    if (PASSWORD_POLICY.rejectSurroundingWhitespace && raw !== raw.trim()) {
      failed.push('noSurroundingWhitespace');
    }
    if (raw.length < PASSWORD_POLICY.minLength) failed.push('minLength');
    if (raw.length > PASSWORD_POLICY.maxLength) failed.push('maxLength');
    if (!PASSWORD_POLICY.uppercasePattern.test(raw)) failed.push('uppercase');
    if (!PASSWORD_POLICY.lowercasePattern.test(raw)) failed.push('lowercase');
    if (!PASSWORD_POLICY.numberPattern.test(raw)) failed.push('number');
    if (!PASSWORD_POLICY.symbolPattern.test(raw)) failed.push('symbol');
    if (COMMON_PASSWORDS.has(normalizePasswordVariant(raw))) failed.push('common');

    return {
      valid: failed.length === 0,
      failed,
      message: failed.length === 0 ? SUCCESS_MESSAGE : POLICY_MESSAGE,
    };
  }

  assert(raw: unknown): void {
    const result = this.evaluate(raw);
    if (result.valid) return;

    throw new BadRequestException({
      success: false,
      error: 'PASSWORD_POLICY_FAILED',
      message: result.message,
      data: { failed: result.failed },
    });
  }
}
