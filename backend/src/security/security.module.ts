import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuthUserService } from '../common/auth-user.service';

@Module({
  controllers: [SecurityController],
  providers: [SecurityService, AuthUserService],
  exports: [SecurityService],
})
export class SecurityModule {}
