import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuthUserService } from '../common/auth-user.service';
import { PasswordPolicyService } from './password-policy.service';
import { CredentialStateService } from './credential-state.service';

@Module({
  controllers: [SecurityController],
  providers: [
    SecurityService,
    AuthUserService,
    PasswordPolicyService,
    CredentialStateService,
  ],
  exports: [SecurityService, PasswordPolicyService, CredentialStateService],
})
export class SecurityModule {}
