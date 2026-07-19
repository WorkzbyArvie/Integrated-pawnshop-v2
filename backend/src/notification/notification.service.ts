import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  AuctionStatus,
  ComplianceStatus,
} from '@prisma/client';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Register or update a push token for a user
   */
  async registerPushToken(dto: RegisterPushTokenDto): Promise<any> {
    try {
      const token = await this.prisma.pushToken.upsert({
        where: {
          userId_deviceToken: {
            userId: dto.userId,
            deviceToken: dto.deviceToken,
          },
        },
        update: {
          platform: dto.platform,
          deviceName: dto.deviceName,
          isActive: true,
          lastUsedAt: new Date(),
        },
        create: {
          userId: dto.userId,
          deviceToken: dto.deviceToken,
          platform: dto.platform,
          deviceName: dto.deviceName,
        },
      });

      this.logger.log(`Push token registered for user ${dto.userId}`);
      return token;
    } catch (error: any) {
      this.logger.error(
        `Failed to register push token: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Deactivate a push token
   */
  async deactivatePushToken(
    userId: string,
    deviceToken: string,
  ): Promise<void> {
    await this.prisma.pushToken.updateMany({
      where: { userId, deviceToken },
      data: { isActive: false },
    });
    this.logger.log(`Push token deactivated for user ${userId}`);
  }

  /**
   * Send a notification
   */
  async sendNotification(dto: SendNotificationDto): Promise<any> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          recipientId: dto.recipientId,
          channel: dto.channel,
          type: dto.type,
          title: dto.title,
          body: dto.body,
          data: dto.data || {},
          scheduledFor: dto.scheduledFor,
          expiresAt: dto.expiresAt,
          status: dto.scheduledFor
            ? NotificationStatus.PENDING
            : NotificationStatus.PENDING,
        },
      });

      // If not scheduled, send immediately
      if (!dto.scheduledFor) {
        await this.deliverNotification(notification.id);
      }

      return notification;
    } catch (error: any) {
      this.logger.error(
        `Failed to send notification: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Deliver a notification to the user's devices
   */
  private async deliverNotification(notificationId: string): Promise<void> {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        throw new NotFoundException('Notification not found');
      }

      // IN_APP notifications don't require push tokens — mark as SENT immediately
      if (notification.channel === NotificationChannel.IN_APP) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
        this.logger.log(`In-app notification ${notificationId} marked as sent`);
        return;
      }

      // Get active push tokens for the user
      const tokens = await this.prisma.pushToken.findMany({
        where: {
          userId: notification.recipientId,
          isActive: true,
        },
      });

      if (tokens.length === 0) {
        this.logger.warn(
          `No active push tokens found for user ${notification.recipientId}`,
        );
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.FAILED,
            failureReason: 'No active push tokens',
          },
        });
        return;
      }

      // TODO: Integrate with FCM/APNs/OneSignal for actual push delivery
      // For now, mark as sent
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      this.logger.log(
        `Notification ${notificationId} delivered to ${tokens.length} devices`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to deliver notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          failureReason: error.message,
          retryCount: { increment: 1 },
        },
      });
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        recipientId: userId,
      },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: userId,
        status: { not: NotificationStatus.READ },
      },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });

    return result.count;
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<any> {
    const safeLimit = Math.max(1, Number(limit) || 50);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: userId },
        orderBy: { createdAt: 'desc' },
        skip: safeOffset,
        take: safeLimit,
      }),
      this.prisma.notification.count({
        where: { recipientId: userId },
      }),
    ]);

    return {
      data: notifications,
      meta: { total, limit: safeLimit, offset: safeOffset },
    };
  }

  // ============================================================================
  // SCHEDULED JOBS FOR AUCTION NOTIFICATIONS
  // ============================================================================

  /**
   * Check for auctions ending soon and send notifications
   * Runs every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkAuctionEndingSoon(): Promise<void> {
    if (!(await this.prisma.ensureConnected('auction ending-soon notification cron'))) {
      return;
    }

    try {
      const now = new Date();
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

      // Find live auctions ending in 15, 5, or 1 minute
      const endingSoonListings = await this.prisma.auctionListing.findMany({
        where: {
          status: AuctionStatus.LIVE,
          endAt: {
            gte: now,
            lte: fifteenMinutesFromNow,
          },
        },
        include: {
          bids: {
            select: { bidderId: true },
            distinct: ['bidderId'],
          },
        },
      });

      for (const listing of endingSoonListings) {
        const timeLeft = listing.endAt.getTime() - now.getTime();
        const minutesLeft = Math.floor(timeLeft / 60000);

        let shouldNotify = false;
        let timeMessage = '';

        if (minutesLeft <= 1 && minutesLeft > 0) {
          shouldNotify = true;
          timeMessage = '1 minute';
        } else if (minutesLeft <= 5 && minutesLeft > 4) {
          shouldNotify = true;
          timeMessage = '5 minutes';
        } else if (minutesLeft <= 15 && minutesLeft > 14) {
          shouldNotify = true;
          timeMessage = '15 minutes';
        }

        if (shouldNotify) {
          // Notify all bidders
          const uniqueBidders = [
            ...new Set(listing.bids.map((b) => b.bidderId)),
          ];

          for (const bidderId of uniqueBidders) {
            await this.sendNotification({
              recipientId: bidderId,
              channel: NotificationChannel.PUSH,
              type: NotificationType.AUCTION_ENDING_SOON,
              title: `Auction Ending Soon!`,
              body: `The auction for "${listing.title}" ends in ${timeMessage}. Place your bid now!`,
              data: {
                listingId: listing.id,
                timeLeftMs: timeLeft,
              },
            });
          }

          this.logger.log(
            `Sent ending soon notifications for listing ${listing.id} (${timeMessage} left)`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to check auction ending soon: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Send outbid notifications
   */
  async notifyOutbid(
    listingId: number,
    previousHighBidderId: string,
    newBidAmount: number,
  ): Promise<void> {
    try {
      const listing = await this.prisma.auctionListing.findUnique({
        where: { id: listingId },
      });

      if (!listing) return;

      await this.sendNotification({
        recipientId: previousHighBidderId,
        channel: NotificationChannel.PUSH,
        type: NotificationType.AUCTION_OUTBID,
        title: "You've Been Outbid!",
        body: `Someone placed a higher bid of ₱${newBidAmount.toLocaleString()} on "${listing.title}"`,
        data: {
          listingId,
          newBidAmount,
        },
      });

      this.logger.log(
        `Outbid notification sent to ${previousHighBidderId} for listing ${listingId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send outbid notification: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Send auction won notification
   */
  async notifyAuctionWon(
    listingId: number,
    winnerId: string,
    winningBid: number,
  ): Promise<void> {
    try {
      const listing = await this.prisma.auctionListing.findUnique({
        where: { id: listingId },
      });

      if (!listing) return;

      await this.sendNotification({
        recipientId: winnerId,
        channel: NotificationChannel.PUSH,
        type: NotificationType.AUCTION_WON,
        title: 'Congratulations! You Won!',
        body: `You won the auction for "${listing.title}" with a bid of ₱${winningBid.toLocaleString()}. Please complete payment within 48 hours.`,
        data: {
          listingId,
          winningBid,
        },
      });

      this.logger.log(
        `Auction won notification sent to ${winnerId} for listing ${listingId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send auction won notification: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Check for compliance reminders
   * Runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkComplianceReminders(): Promise<void> {
    if (!(await this.prisma.ensureConnected('compliance reminder cron'))) {
      return;
    }

    try {
      const now = new Date();
      const twentyFourHoursFromNow = new Date(
        now.getTime() + 24 * 60 * 60 * 1000,
      );

      // Find compliances approaching deadline
      const pendingCompliances =
        await this.prisma.auctionWinnerCompliance.findMany({
          where: {
            status: ComplianceStatus.PENDING_COMPLIANCE,
            complianceDeadline: {
              lte: twentyFourHoursFromNow,
              gte: now,
            },
          },
        });

      for (const compliance of pendingCompliances) {
        const timeLeft =
          compliance.complianceDeadline.getTime() - now.getTime();
        const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));

        await this.sendNotification({
          recipientId: compliance.winnerId,
          channel: NotificationChannel.PUSH,
          type: NotificationType.COMPLIANCE_REMINDER,
          title: 'Payment Deadline Approaching',
          body: `You have ${hoursLeft} hours left to complete payment for your auction win. Please visit the pawnshop soon!`,
          data: {
            complianceId: compliance.id,
            listingId: compliance.listingId,
            hoursLeft,
          },
        });

        await this.prisma.auctionWinnerCompliance.update({
          where: { id: compliance.id },
          data: {
            lastReminderAt: now,
            reminderCount: { increment: 1 },
          },
        });
      }

      this.logger.log(`Sent ${pendingCompliances.length} compliance reminders`);
    } catch (error: any) {
      this.logger.error(
        `Failed to check compliance reminders: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Notify mobile-account users when pawn ticket payment deadline is near.
   * Runs every 6 hours to keep reminders timely without excessive noise.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async checkPawnTicketDeadlineReminders(): Promise<void> {
    if (!(await this.prisma.ensureConnected('pawn ticket deadline reminder cron'))) {
      return;
    }

    try {
      const now = new Date();
      const reminderWindow = new Date(now.getTime() + 72 * 60 * 60 * 1000); // next 72 hours
      const dedupeWindow = new Date(now.getTime() - 24 * 60 * 60 * 1000); // avoid duplicate reminders within 24h

      const nearDeadlineTickets = await this.prisma.ticket.findMany({
        where: {
          status: 'ACTIVE',
          customerId: { not: null },
          expiryDate: {
            gt: now,
            lte: reminderWindow,
          },
        },
        select: {
          id: true,
          ticketNumber: true,
          customerId: true,
          expiryDate: true,
          description: true,
          loanAmount: true,
        },
      });

      if (nearDeadlineTickets.length === 0) {
        return;
      }

      const customerIds = Array.from(
        new Set(nearDeadlineTickets.map((ticket) => ticket.customerId).filter(Boolean)),
      ) as string[];

      const bidderProfiles = await this.prisma.profile.findMany({
        where: {
          id: { in: customerIds },
          role: 'BIDDER',
        },
        select: { id: true },
      });

      const activePushTokens = await this.prisma.pushToken.findMany({
        where: {
          userId: { in: customerIds },
          isActive: true,
        },
        select: { userId: true },
      });

      const bidderIdSet = new Set(bidderProfiles.map((profile) => profile.id));
      const pushEnabledUserSet = new Set(activePushTokens.map((token) => token.userId));
      let remindersSent = 0;

      for (const ticket of nearDeadlineTickets) {
        if (!bidderIdSet.has(ticket.customerId)) {
          continue;
        }

        const alreadyNotified = await this.prisma.notification.findFirst({
          where: {
            recipientId: ticket.customerId,
            type: NotificationType.PAYMENT_DUE,
            createdAt: { gte: dedupeWindow },
            body: { contains: ticket.ticketNumber },
          },
          select: { id: true },
        });

        if (alreadyNotified) {
          continue;
        }

        const hoursLeft = Math.max(
          1,
          Math.ceil((ticket.expiryDate.getTime() - now.getTime()) / (60 * 60 * 1000)),
        );

        const urgencyText =
          hoursLeft <= 24
            ? `Your pawn ticket ${ticket.ticketNumber} is due within ${hoursLeft} hour(s).`
            : `Your pawn ticket ${ticket.ticketNumber} is nearing deadline (${hoursLeft} hour(s) left).`;

        const payload = {
          recipientId: ticket.customerId,
          type: NotificationType.PAYMENT_DUE,
          title: 'Pawn Payment Deadline Reminder',
          body: `${urgencyText} Please settle payment before ${ticket.expiryDate.toLocaleString()}.`,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            expiryDate: ticket.expiryDate.toISOString(),
            loanAmount: ticket.loanAmount,
          },
        };

        // Always keep a guaranteed in-app reminder for timeline/history visibility.
        await this.sendNotification({
          ...payload,
          channel: NotificationChannel.IN_APP,
        });

        // Add push delivery when device token is available.
        if (pushEnabledUserSet.has(ticket.customerId)) {
          await this.sendNotification({
            ...payload,
            channel: NotificationChannel.PUSH,
          });
        }

        remindersSent += 1;
      }

      if (remindersSent > 0) {
        this.logger.log(`Sent ${remindersSent} pawn deadline reminder notifications`);
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to check pawn ticket deadline reminders: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Process pending scheduled notifications
   * Runs every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledNotifications(): Promise<void> {
    if (!(await this.prisma.ensureConnected('scheduled notification cron'))) {
      return;
    }

    try {
      const now = new Date();

      const pendingNotifications = await this.prisma.notification.findMany({
        where: {
          status: NotificationStatus.PENDING,
          scheduledFor: {
            lte: now,
          },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        take: 100,
      });

      for (const notification of pendingNotifications) {
        await this.deliverNotification(notification.id);
      }

      if (pendingNotifications.length > 0) {
        this.logger.log(
          `Processed ${pendingNotifications.length} scheduled notifications`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to process scheduled notifications: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Clean up expired notifications
   * Runs daily at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredNotifications(): Promise<void> {
    if (!(await this.prisma.ensureConnected('notification cleanup cron'))) {
      return;
    }

    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.notification.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            {
              status: NotificationStatus.READ,
              readAt: { lt: thirtyDaysAgo },
            },
          ],
        },
      });

      this.logger.log(`Cleaned up ${result.count} expired notifications`);
    } catch (error: any) {
      this.logger.error(
        `Failed to cleanup expired notifications: ${error.message}`,
        error.stack,
      );
    }
  }
}
