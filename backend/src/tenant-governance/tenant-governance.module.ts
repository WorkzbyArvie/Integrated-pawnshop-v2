import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AuthUserService } from '../common/auth-user.service';
import { TenantGovernanceController } from './tenant-governance.controller';
import { TenantGovernanceService } from './tenant-governance.service';

@Module({
  imports: [PrismaModule],
  controllers: [TenantGovernanceController],
  providers: [TenantGovernanceService, AuthUserService],
  exports: [TenantGovernanceService],
})
export class TenantGovernanceModule {}
