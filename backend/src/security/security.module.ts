import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuthUserService } from '../common/auth-user.service';
import { PasswordPolicyService } from './password-policy.service';
import { CredentialStateService } from './credential-state.service';
import { MfaAssertionService } from './mfa-assertion.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { MfaPasswordAttemptService } from './mfa-password-attempt.service';
import { SecurityEmailService } from './security-email.service';
import { AccountSecurityGuard } from './guards/account-security.guard';

@Module({
  controllers: [SecurityController],
  providers: [
    SecurityService,
    AuthUserService,
    PasswordPolicyService,
    CredentialStateService,
    MfaAssertionService,
    MfaChallengeService,
    MfaPasswordAttemptService,
    SecurityEmailService,
    AccountSecurityGuard,
  ],
  exports: [
    SecurityService,
    PasswordPolicyService,
    CredentialStateService,
    MfaAssertionService,
    MfaChallengeService,
    SecurityEmailService,
    AccountSecurityGuard,
  ],
})
export class SecurityModule {}
