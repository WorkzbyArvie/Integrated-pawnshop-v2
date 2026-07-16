import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import { PrismaService } from '../prisma.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueueStatus, QueueType } from '@prisma/client';

describe('QueueService', () => {
  let service: QueueService;
  let prisma: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
      },
      queueTicket: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [QueueService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // create()
  // ──────────────────────────────────────────────────────────────────────
  describe('create', () => {
    const dto = {
      customerId: 'cust-1',
      queueType: QueueType.PAWNING,
      branchId: 1,
      priority: 0,
      notes: 'Test ticket',
    };

    it('should create a queue ticket with generated number', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        pawnshopId: PAWNSHOP_ID,
      });
      prisma.queueTicket.findFirst.mockResolvedValue(null); // no existing ticket
      prisma.queueTicket.count
        .mockResolvedValueOnce(2) // generateQueueNumber count
        .mockResolvedValueOnce(5); // waitingCount
      prisma.queueTicket.create.mockResolvedValue({
        id: 'ticket-1',
        queueNumber: 'P003',
        status: QueueStatus.WAITING,
        estimatedWaitMinutes: 75,
      });

      const result = await service.create(PAWNSHOP_ID, dto);

      expect(result.queueNumber).toBe('P003');
      expect(prisma.queueTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            queueNumber: 'P003',
            pawnshopId: PAWNSHOP_ID,
            queueType: QueueType.PAWNING,
            estimatedWaitMinutes: 75,
          }),
        }),
      );
    });

    it('should throw ForbiddenException when customer not in pawnshop', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.create(PAWNSHOP_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when customer has active ticket', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      prisma.queueTicket.findFirst.mockResolvedValue({ id: 'existing-ticket' });

      await expect(service.create(PAWNSHOP_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should estimate wait at minimum 5 minutes when queue is empty', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      prisma.queueTicket.findFirst.mockResolvedValue(null);
      prisma.queueTicket.count
        .mockResolvedValueOnce(0) // generateQueueNumber
        .mockResolvedValueOnce(0); // waitingCount
      prisma.queueTicket.create.mockResolvedValue({
        id: 'ticket-1',
        queueNumber: 'P001',
      });

      await service.create(PAWNSHOP_ID, dto);

      expect(prisma.queueTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estimatedWaitMinutes: 5,
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // findAll()
  // ──────────────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('should return paginated tickets with filters', async () => {
      const mockTickets = [{ id: 'ticket-1' }, { id: 'ticket-2' }];
      prisma.queueTicket.findMany.mockResolvedValue(mockTickets);
      prisma.queueTicket.count.mockResolvedValue(10);

      const result = await service.findAll(PAWNSHOP_ID, {
        status: QueueStatus.WAITING,
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(10);
      expect(prisma.queueTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            pawnshopId: PAWNSHOP_ID,
            status: QueueStatus.WAITING,
          },
          orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
        }),
      );
    });

    it('should apply date range filters', async () => {
      prisma.queueTicket.findMany.mockResolvedValue([]);
      prisma.queueTicket.count.mockResolvedValue(0);

      await service.findAll(PAWNSHOP_ID, {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        limit: 20,
        offset: 0,
      });

      expect(prisma.queueTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            joinedAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // findOne()
  // ──────────────────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('should return a ticket when found', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        pawnshopId: PAWNSHOP_ID,
      });

      const result = await service.findOne(PAWNSHOP_ID, 'ticket-1');
      expect(result.id).toBe('ticket-1');
    });

    it('should throw NotFoundException when ticket not found', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue(null);

      await expect(service.findOne(PAWNSHOP_ID, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // update() – status transitions
  // ──────────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('should allow WAITING → SERVING transition', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        status: QueueStatus.WAITING,
        pawnshopId: PAWNSHOP_ID,
      });
      prisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-1',
        status: QueueStatus.SERVING,
      });

      const result = await service.update(PAWNSHOP_ID, 'ticket-1', {
        status: QueueStatus.SERVING,
      });

      expect(result.status).toBe(QueueStatus.SERVING);
    });

    it('should reject invalid transition COMPLETED → WAITING', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        status: QueueStatus.COMPLETED,
        pawnshopId: PAWNSHOP_ID,
      });

      await expect(
        service.update(PAWNSHOP_ID, 'ticket-1', {
          status: QueueStatus.WAITING,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should auto-set servedAt when transitioning to SERVING', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        status: QueueStatus.WAITING,
        pawnshopId: PAWNSHOP_ID,
      });
      prisma.queueTicket.update.mockImplementation(({ data }) => {
        expect(data.servedAt).toBeInstanceOf(Date);
        return {
          id: 'ticket-1',
          status: QueueStatus.SERVING,
          servedAt: data.servedAt,
        };
      });

      await service.update(PAWNSHOP_ID, 'ticket-1', {
        status: QueueStatus.SERVING,
      });

      expect(prisma.queueTicket.update).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // callNext()
  // ──────────────────────────────────────────────────────────────────────
  describe('callNext', () => {
    it('should call the highest-priority oldest-waiting ticket', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue({
        id: 'ticket-1',
        queueNumber: 'P001',
        customer: { fullName: 'John' },
      });
      prisma.queueTicket.update.mockResolvedValue({
        id: 'ticket-1',
        status: QueueStatus.SERVING,
        assignedStaffId: 'staff-1',
        counterNumber: 'C1',
      });

      const result = await service.callNext(PAWNSHOP_ID, 'staff-1', 'C1');

      expect(result.status).toBe(QueueStatus.SERVING);
      expect(prisma.queueTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: QueueStatus.SERVING,
            assignedStaffId: 'staff-1',
            counterNumber: 'C1',
          }),
        }),
      );
    });

    it('should throw NotFoundException when queue is empty', async () => {
      prisma.queueTicket.findFirst.mockResolvedValue(null);

      await expect(
        service.callNext(PAWNSHOP_ID, 'staff-1', 'C1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getStatistics()
  // ──────────────────────────────────────────────────────────────────────
  describe('getStatistics', () => {
    it('should return dashboard-ready queue stats', async () => {
      prisma.queueTicket.count
        .mockResolvedValueOnce(5) // waiting
        .mockResolvedValueOnce(2) // serving
        .mockResolvedValueOnce(12); // completedToday
      prisma.queueTicket.aggregate.mockResolvedValue({
        _avg: { estimatedWaitMinutes: 18.5 },
      });

      const stats = await service.getStatistics(PAWNSHOP_ID);

      expect(stats).toEqual({
        waiting: 5,
        serving: 2,
        completedToday: 12,
        avgWaitTimeMinutes: 19, // rounded
        totalActive: 7,
      });
    });
  });
});
