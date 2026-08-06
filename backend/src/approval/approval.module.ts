import { Module } from '@nestjs/common';

import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { PrismaModule } from '../prisma.module';
import { LoanModule } from '../loan/loan.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, LoanModule, NotificationModule],
  controllers: [ApprovalController],
  providers: [ApprovalService],
})
export class ApprovalModule {}
