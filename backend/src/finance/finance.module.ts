import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PrismaModule } from '../prisma.module';
import { AuthUserService } from '../common/auth-user.service';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceController],
  providers: [FinanceService, AuthUserService],
  exports: [FinanceService],
})
export class FinanceModule {}
