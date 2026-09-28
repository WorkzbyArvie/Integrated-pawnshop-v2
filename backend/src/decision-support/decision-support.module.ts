import { Module } from '@nestjs/common';
import { DecisionSupportService } from './decision-support.service';
import { DecisionSupportController } from './decision-support.controller';
import { QueueAutomationService } from './queue-automation.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  controllers: [DecisionSupportController],
  providers: [DecisionSupportService, QueueAutomationService],
  exports: [DecisionSupportService],
})
export class DecisionSupportModule {}
