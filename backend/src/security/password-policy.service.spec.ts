import { BadRequestException } from '@nestjs/common';
import { PasswordPolicyService } from './password-policy.service';

describe('PasswordPolicyService', () => {
  let service: PasswordPolicyService;

  beforeEach(() => {
    service = new PasswordPolicyService();
  });

  it('accepts a compliant password', () => {
    expect(service.evaluate('S9!riverstone')).toEqual({
      valid: true,
      failed: [],
      message: 'Password meets the required policy.',
    });
  });

  it.each([
    ['short', 'Ab1!efgh', ['minLength']],
    ['overlong', `A1!${'a'.repeat(126)}`, ['maxLength']],
    ['single-class', 'alllowercase', ['uppercase', 'number', 'symbol']],
    ['whitespace-padded', ' Ab1!cdefgh ', ['noSurroundingWhitespace']],
    ['common-variant', 'P@ssw0rd!!', ['common']],
  ])('rejects a %s password with stable rule keys', (_label, password, expected) => {
    const result = service.evaluate(password);
    expect(result.valid).toBe(false);
    expect(result.failed).toEqual(expect.arrayContaining(expected));
    expect(result.message).toBe('Password does not meet the required policy.');
  });

  it('rejects missing values without inspecting a secret', () => {
    const result = service.evaluate(undefined);
    expect(result).toEqual({
      valid: false,
      failed: ['required'],
      message: 'Password does not meet the required policy.',
    });
  });

  it('throws a structured policy failure from assert', () => {
    expect(() => service.assert('short')).toThrow(BadRequestException);

    try {
      service.assert('Ab1!efgh');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as Record<string, any>;
      expect(response.error).toBe('PASSWORD_POLICY_FAILED');
      expect(response.data.failed).toEqual(expect.arrayContaining(['minLength']));
      expect(JSON.stringify(response)).not.toContain('Ab1!efgh');
    }
  });
});
