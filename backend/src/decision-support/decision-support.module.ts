import { Module } from '@nestjs/common';
import { DecisionSupportService } from './decision-support.service';
import { DecisionSupportController } from './decision-support.controller';
import { QueueAutomationService } from './queue-automation.service';
import { NotificationModule } from '../notification/notification.module';

/**
 * `NotificationModule` must stay in `imports`: `QueueAutomationService` injects
 * `NotificationService`. Dropping it does not fail type checking and does not
 * fail a unit test that registers its own providers — it only fails at boot,
 * when Nest tries to build the dependency graph. There is a test for that now.
 */
@Module({
  imports: [NotificationModule],
  controllers: [DecisionSupportController],
  providers: [DecisionSupportService, QueueAutomationService],
  exports: [DecisionSupportService],
})
export class DecisionSupportModule {}
