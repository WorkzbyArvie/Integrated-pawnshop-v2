import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class PasswordPolicyService {
  evaluate(_raw: unknown): {
    valid: boolean;
    failed: string[];
    message: string;
  } {
    return {
      valid: false,
      failed: ['required'],
      message: 'Password does not meet the required policy.',
    };
  }

  assert(_raw: unknown): void {
    throw new BadRequestException({
      success: false,
      error: 'PASSWORD_POLICY_FAILED',
      message: 'Password does not meet the required policy.',
      data: { failed: ['required'] },
    });
  }
}
