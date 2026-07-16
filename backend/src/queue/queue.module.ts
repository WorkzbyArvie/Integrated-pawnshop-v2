import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma.module';
import { AuthUserService } from '../common/auth-user.service';

@Module({
  imports: [NotificationModule, PrismaModule],
  controllers: [QueueController],
  providers: [QueueService, AuthUserService],
  exports: [QueueService],
})
export class QueueModule {}
