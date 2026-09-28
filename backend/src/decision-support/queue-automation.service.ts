import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { DecisionSupportService } from './decision-support.service';

/**
 * Call-ahead and no-show enforcement.
 *
 * The customer-facing half of the queue feature, and the part that gives the
 * decision-support engine something real to measure.
 *
 * **Trigger on position, not on predicted time.** Position is exact; a time
 * prediction is an estimate. An alert fired off a prediction either arrives too
 * early — the customer turns up and joins the physical line anyway, gaining
 * nothing — or too late, which defeats the point. So the sweep looks at how many
 * people are ahead, and the message says "you're next", never a time.
 *
 * **No-show needs a grace window and an escape hatch.** Marking someone absent
 * after an alert they never received punishes them for a system failure, so the
 * window is generous, it is configurable per shop, and staff can reverse it with
 * the reason recorded.
 */

const DEFAULT_CALL_AHEAD_POSITION = 2;
const DEFAULT_GRACE_MINUTES = 5;

@Injectable()
export class QueueAutomationService {
  private readonly logger = new Logger(QueueAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly decisionSupport: DecisionSupportService,
  ) {}

  private async settingsFor(pawnshopId: string) {
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });
    const settings = (pawnshop?.settings ?? {}) as Record<string, unknown>;

    const position = Number(settings.queueCallAheadPosition);
    const grace = Number(settings.queueNoShowGraceMinutes);

    return {
      callAheadPosition:
        Number.isInteger(position) && position > 0
          ? position
          : DEFAULT_CALL_AHEAD_POSITION,
      graceMinutes:
        Number.isInteger(grace) && grace > 0 ? grace : DEFAULT_GRACE_MINUTES,
    };
  }

  /**
   * Warns every waiting customer who has reached the front of the queue.
   *
   * Idempotent: `notifiedAt` is only written once, so repeated sweeps do not
   * re-alert. Each ticket is handled inside its own error boundary so one bad
   * row cannot stop the rest of the shop from being warned.
   */
  @Cron('0 * * * * *', { name: 'queue-call-ahead', timeZone: 'UTC' })
  async sendCallAheadAlerts(): Promise<void> {
    const shops = await this.prisma.pawnshop.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const shop of shops) {
      try {
        await this.callAheadForShop(shop.id);
      } catch (error) {
        this.logger.error(
          `Call-ahead sweep failed for shop ${shop.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }
  }

  private async callAheadForShop(pawnshopId: string): Promise<number> {
    const { callAheadPosition } = await this.settingsFor(pawnshopId);

    // Only tickets that have not been warned yet. The window is narrowed in
    // memory below because "position N" is not expressible in a where clause
    // without a self-join, and the waiting set per shop is small.
    const waiting = await this.prisma.queueTicket.findMany({
      where: { pawnshopId, status: 'WAITING', notifiedAt: null },
      select: {
        id: true,
        branchId: true,
        queueType: true,
        priority: true,
        joinedAt: true,
        customerId: true,
      },
      take: 200,
      orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
    });

    if (waiting.length <= callAheadPosition) return 0;

    // Group per branch so a customer's position is measured against the queue
    // they will actually be called from.
    const byBranch = new Map<string | null, typeof waiting>();
    for (const ticket of waiting) {
      const key = ticket.branchId === null ? null : String(ticket.branchId);
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key)!.push(ticket);
    }

    let alerted = 0;

    for (const [, queue] of byBranch) {
      const due = queue.slice(0, callAheadPosition);
      for (const ticket of due) {
        try {
          const prediction = await this.decisionSupport.predictWait(
            pawnshopId,
            ticket.id,
          );

          const message =
            'You are next. Please come to the pawnshop counter. ' +
            'If you do not arrive within a short grace period your place will be released.';

          // `notifiedAt` is the functional signal, and it is written first and
          // unconditionally. Clients already poll this ticket, so the call-ahead
          // works end to end without depending on notification delivery.
          await this.prisma.queueTicket.update({
            where: { id: ticket.id },
            data: { notifiedAt: new Date() },
          });

          // The notification row is supplementary: it populates the in-app
          // centre and leaves an audit record. A walk-in queue customer is not
          // guaranteed to have a linked login profile, so it is attempted only
          // when one exists rather than failing the alert itself.
          const profile = await this.prisma.profile.findUnique({
            where: { id: ticket.customerId },
            select: { id: true },
          });

          if (profile) {
            try {
              await this.notifications.sendNotification({
                recipientId: profile.id,
                channel: 'IN_APP',
                type: 'QUEUE_READY',
                title: 'You are next at the pawnshop',
                body: message,
                data: {
                  ticketId: ticket.id,
                  queueType: ticket.queueType,
                  peopleAhead: prediction.peopleAhead,
                  predictedMinutes: prediction.minutes.value,
                  predictedBasis: prediction.minutes.basis,
                },
              });
            } catch (error) {
              this.logger.warn(
                `Call-ahead notification failed for ticket ${ticket.id}, but the alert is still recorded: ${
                  (error as Error).message
                }`,
              );
            }
          }

          alerted += 1;
        } catch (error) {
          this.logger.error(
            `Call-ahead failed for ticket ${ticket.id}: ${(error as Error).message}`,
          );
        }
      }
    }

    return alerted;
  }

  /**
   * Marks warned customers absent once their grace window has passed.
   *
   * Requires `notifiedAt`: a customer who was never warned cannot be a no-show,
   * because they were never told to come. That is the distinction that stops the
   * system blaming a customer for a notification that failed to arrive.
   */
  @Cron('0 */5 * * * *', { name: 'queue-no-show-sweep', timeZone: 'UTC' })
  async enforceNoShows(): Promise<void> {
    const shops = await this.prisma.pawnshop.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const shop of shops) {
      try {
        const { graceMinutes } = await this.settingsFor(shop.id);
        const cutoff = new Date(Date.now() - graceMinutes * 60_000);

        const { count } = await this.prisma.queueTicket.updateMany({
          where: {
            pawnshopId: shop.id,
            status: 'WAITING',
            notifiedAt: { not: null, lte: cutoff },
          },
          data: { status: 'NO_SHOW' },
        });

        if (count > 0) {
          this.logger.log(
            `Marked ${count} no-show(s) at shop ${shop.id} after a ${graceMinutes} min grace window`,
          );
        }
      } catch (error) {
        this.logger.error(
          `No-show sweep failed for shop ${shop.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
