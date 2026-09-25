import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuthUserService } from '../common/auth-user.service';
import { PasswordPolicyService } from './password-policy.service';
import { CredentialStateService } from './credential-state.service';
import { MfaAssertionService } from './mfa-assertion.service';
import { AccountSecurityGuard } from './guards/account-security.guard';

@Module({
  controllers: [SecurityController],
  providers: [
    SecurityService,
    AuthUserService,
    PasswordPolicyService,
    CredentialStateService,
    MfaAssertionService,
    AccountSecurityGuard,
  ],
  exports: [
    SecurityService,
    PasswordPolicyService,
    CredentialStateService,
    MfaAssertionService,
    AccountSecurityGuard,
  ],
})
export class SecurityModule {}
