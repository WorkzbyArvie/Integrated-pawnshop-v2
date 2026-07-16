import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PaymongoService } from './paymongo.service';
import { FinanceModule } from '../finance/finance.module';
import { AuthUserService } from '../common/auth-user.service';

@Module({
  imports: [ScheduleModule.forRoot(), FinanceModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, PaymongoService, AuthUserService],
  exports: [SubscriptionService, PaymongoService],
})
export class SubscriptionModule {}
