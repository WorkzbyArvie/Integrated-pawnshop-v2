import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationChannel, NotificationType } from '@prisma/client';

@Injectable()
export class GracePeriodService {
  private readonly logger = new Logger(GracePeriodService.name);
  private readonly GRACE_PERIOD_DAYS = 5;

  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
    private notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async autoEnterGracePeriod(): Promise<void> {
    if (!(await this.prisma.ensureConnected('grace period auto-entry cron'))) {
      return;
    }

    this.logger.log('Running grace period auto-entry check...');
    const result = await this.processGracePeriodEntries();
    this.logger.log(`Grace period auto-entry complete: ${result.count} ticket(s) moved to GRACE_PERIOD`);
  }

  async processGracePeriodEntries(): Promise<{ count: number; tickets: number[] }> {
    const now = new Date();
    const moved: number[] = [];

    const overdueTickets = await this.prisma.ticket.findMany({
      where: {
        lifecycleStatus: 'OVERDUE',
      },
      include: { customer: true },
    });

    for (const ticket of overdueTickets) {
      try {
        const overdueDuration = now.getTime() - ticket.updatedAt.getTime();
        const daysOverdue = Math.floor(overdueDuration / (1000 * 60 * 60 * 24));

        if (daysOverdue < this.GRACE_PERIOD_DAYS) {
          continue;
        }

        await this.stateMachine.transition(
          'TICKET_LIFECYCLE',
          'OVERDUE',
          'GRACE_PERIOD',
        );

        const gracePeriodEnd = new Date(now);
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);

        const forfeitureDate = new Date(gracePeriodEnd);
        forfeitureDate.setDate(forfeitureDate.getDate() + 15);

        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            lifecycleStatus: 'GRACE_PERIOD',
            gracePeriodEnd,
            forfeitureDate,
            updatedAt: now,
          },
        });

        await this.prisma.loan.updateMany({
          where: { ticketId: ticket.id },
          data: { status: 'GRACE_PERIOD' },
        });

        if (ticket.customerId) {
          try {
            await this.notificationService.sendNotification({
              recipientId: ticket.customerId,
              channel: NotificationChannel.IN_APP,
              type: NotificationType.PAYMENT_DUE,
              title: 'Grace Period Started',
              body: `Your pawn ticket ${ticket.ticketNumber} has entered grace period. You have 30 days to redeem your item before forfeiture.`,
              data: {
                ticketId: ticket.id,
                ticketNumber: ticket.ticketNumber,
                gracePeriodEnd: gracePeriodEnd.toISOString(),
                forfeitureDate: forfeitureDate.toISOString(),
              },
            });
          } catch (notifErr) {
            this.logger.warn(`Failed to send grace period notification for ticket #${ticket.id}: ${(notifErr as Error).message}`);
          }
        }

        moved.push(ticket.id);
        this.logger.log(`Ticket #${ticket.id} (${ticket.ticketNumber}) moved to GRACE_PERIOD`);
      } catch (err) {
        this.logger.warn(`Cannot move ticket #${ticket.id} to GRACE_PERIOD: ${(err as Error).message}`);
      }
    }

    return { count: moved.length, tickets: moved };
  }
}
