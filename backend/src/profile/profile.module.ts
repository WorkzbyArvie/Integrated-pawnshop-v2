import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { AuthUserService } from '../common/auth-user.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, AuthUserService],
  exports: [ProfileService],
})
export class ProfileModule {}
