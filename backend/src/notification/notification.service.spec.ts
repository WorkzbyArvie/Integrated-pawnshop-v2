import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma.service';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  AuctionStatus,
} from '@prisma/client';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      pushToken: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      notification: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      auctionListing: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      auctionWinnerCompliance: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // registerPushToken()
  // ──────────────────────────────────────────────────────────────────────
  describe('registerPushToken', () => {
    it('should upsert a push token', async () => {
      prisma.pushToken.upsert.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        deviceToken: 'abc123',
        platform: 'android',
      });

      const result = await service.registerPushToken({
        userId: 'user-1',
        deviceToken: 'abc123',
        platform: 'android',
        deviceName: 'Pixel 7',
      });

      expect(result.userId).toBe('user-1');
      expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_deviceToken: {
              userId: 'user-1',
              deviceToken: 'abc123',
            },
          },
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // deactivatePushToken()
  // ──────────────────────────────────────────────────────────────────────
  describe('deactivatePushToken', () => {
    it('should set isActive to false', async () => {
      prisma.pushToken.updateMany.mockResolvedValue({ count: 1 });

      await service.deactivatePushToken('user-1', 'abc123');

      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', deviceToken: 'abc123' },
        data: { isActive: false },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // sendNotification()
  // ──────────────────────────────────────────────────────────────────────
  describe('sendNotification', () => {
    it('should create notification and attempt immediate delivery', async () => {
      const mockNotification = {
        id: 'notif-1',
        recipientId: 'user-1',
        status: NotificationStatus.PENDING,
      };
      prisma.notification.create.mockResolvedValue(mockNotification);
      prisma.notification.findUnique.mockResolvedValue(mockNotification);
      prisma.pushToken.findMany.mockResolvedValue([]);
      prisma.notification.update.mockResolvedValue({
        ...mockNotification,
        status: NotificationStatus.FAILED,
      });

      const result = await service.sendNotification({
        recipientId: 'user-1',
        channel: NotificationChannel.PUSH,
        type: NotificationType.QUEUE_READY,
        title: 'Your Turn!',
        body: 'Counter 3 is ready for you',
      });

      expect(result.id).toBe('notif-1');
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('should defer delivery for scheduled notifications', async () => {
      const futureDate = new Date('2026-12-31T00:00:00Z');
      prisma.notification.create.mockResolvedValue({
        id: 'notif-2',
        status: NotificationStatus.PENDING,
        scheduledFor: futureDate,
      });

      await service.sendNotification({
        recipientId: 'user-1',
        channel: NotificationChannel.PUSH,
        type: NotificationType.SYSTEM_ANNOUNCEMENT,
        title: 'Happy New Year',
        body: 'Welcome to 2027',
        scheduledFor: futureDate,
      });

      // deliverNotification should NOT have been called for scheduled
      expect(prisma.notification.findUnique).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markAsRead()
  // ──────────────────────────────────────────────────────────────────────
  describe('markAsRead', () => {
    it('should update status to READ with timestamp', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markAsRead('user-1', 'notif-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', recipientId: 'user-1' },
        data: expect.objectContaining({
          status: NotificationStatus.READ,
          readAt: expect.any(Date),
        }),
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getUserNotifications()
  // ──────────────────────────────────────────────────────────────────────
  describe('getUserNotifications', () => {
    it('should return paginated notifications', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n1' },
        { id: 'n2' },
      ]);
      prisma.notification.count.mockResolvedValue(25);

      const result = await service.getUserNotifications('user-1', 10, 0);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(25);
      expect(result.meta.limit).toBe(10);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // notifyOutbid()
  // ──────────────────────────────────────────────────────────────────────
  describe('notifyOutbid', () => {
    it('should send outbid notification with bid amount', async () => {
      prisma.auctionListing.findUnique.mockResolvedValue({
        id: 1,
        title: 'Gold Ring',
      });
      prisma.notification.create.mockResolvedValue({ id: 'notif-3' });
      prisma.notification.findUnique.mockResolvedValue({
        id: 'notif-3',
        recipientId: 'old-bidder',
      });
      prisma.pushToken.findMany.mockResolvedValue([]);
      prisma.notification.update.mockResolvedValue({});

      await service.notifyOutbid(1, 'old-bidder', 15000);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.AUCTION_OUTBID,
            recipientId: 'old-bidder',
          }),
        }),
      );
    });

    it('should silently skip when listing not found', async () => {
      prisma.auctionListing.findUnique.mockResolvedValue(null);

      await service.notifyOutbid(999, 'old-bidder', 15000);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // notifyAuctionWon()
  // ──────────────────────────────────────────────────────────────────────
  describe('notifyAuctionWon', () => {
    it('should send auction won notification mentioning 48-hour deadline', async () => {
      prisma.auctionListing.findUnique.mockResolvedValue({
        id: 1,
        title: 'Diamond Necklace',
      });
      prisma.notification.create.mockResolvedValue({ id: 'notif-4' });
      prisma.notification.findUnique.mockResolvedValue({
        id: 'notif-4',
        recipientId: 'winner-1',
      });
      prisma.pushToken.findMany.mockResolvedValue([]);
      prisma.notification.update.mockResolvedValue({});

      await service.notifyAuctionWon(1, 'winner-1', 50000);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.AUCTION_WON,
            body: expect.stringContaining('48 hours'),
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // cleanupExpiredNotifications()
  // ──────────────────────────────────────────────────────────────────────
  describe('cleanupExpiredNotifications', () => {
    it('should delete expired and 30-day-old read notifications', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 42 });

      await service.cleanupExpiredNotifications();

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });
});
