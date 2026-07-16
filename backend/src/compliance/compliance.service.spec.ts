import { Test, TestingModule } from '@nestjs/testing';
import { ComplianceService } from './compliance.service';
import { PrismaService } from '../prisma.service';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ComplianceStatus } from '@prisma/client';

describe('ComplianceService', () => {
  let service: ComplianceService;
  let prisma: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      auctionWinnerCompliance: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      ticket: {
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ComplianceService>(ComplianceService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // findAll()
  // ──────────────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('should return all compliances for pawnshop', async () => {
      prisma.auctionWinnerCompliance.findMany.mockResolvedValue([
        { id: 'c1' },
        { id: 'c2' },
      ]);

      const result = await service.findAll(PAWNSHOP_ID);
      expect(result).toHaveLength(2);
    });

    it('should filter by status when provided', async () => {
      prisma.auctionWinnerCompliance.findMany.mockResolvedValue([]);

      await service.findAll(PAWNSHOP_ID, ComplianceStatus.PENDING_COMPLIANCE);

      expect(prisma.auctionWinnerCompliance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            pawnshopId: PAWNSHOP_ID,
            status: ComplianceStatus.PENDING_COMPLIANCE,
          },
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // findOne()
  // ──────────────────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('should return compliance with listing details', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        pawnshopId: PAWNSHOP_ID,
        listing: { id: 1, ticket: {}, images: [] },
      });

      const result = await service.findOne(PAWNSHOP_ID, 'c1');
      expect(result.id).toBe('c1');
    });

    it('should throw NotFoundException for unknown compliance', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue(null);

      await expect(service.findOne(PAWNSHOP_ID, 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // submitCompliance() – state machine: PENDING → COMPLIED
  // ──────────────────────────────────────────────────────────────────────
  describe('submitCompliance', () => {
    const WINNER_ID = 'winner-uuid-1';

    it('should transition from PENDING_COMPLIANCE to COMPLIED', async () => {
      prisma.auctionWinnerCompliance.findUnique.mockResolvedValue({
        id: 'c1',
        winnerId: WINNER_ID,
        status: ComplianceStatus.PENDING_COMPLIANCE,
      });
      prisma.auctionWinnerCompliance.update.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.COMPLIED,
        compliedAt: expect.any(Date),
      });

      const result = await service.submitCompliance(WINNER_ID, 'c1', {
        paymentProofUrl: 'https://proof.url/receipt.jpg',
        paymentReference: 'REF-001',
      });

      expect(result.status).toBe(ComplianceStatus.COMPLIED);
    });

    it('should reject if caller is not the winner', async () => {
      prisma.auctionWinnerCompliance.findUnique.mockResolvedValue({
        id: 'c1',
        winnerId: 'other-winner',
        status: ComplianceStatus.PENDING_COMPLIANCE,
      });

      await expect(
        service.submitCompliance(WINNER_ID, 'c1', {
          paymentProofUrl: 'url',
          paymentReference: 'ref',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject submission when not in PENDING_COMPLIANCE status', async () => {
      prisma.auctionWinnerCompliance.findUnique.mockResolvedValue({
        id: 'c1',
        winnerId: WINNER_ID,
        status: ComplianceStatus.RELEASED,
      });

      await expect(
        service.submitCompliance(WINNER_ID, 'c1', {
          paymentProofUrl: 'url',
          paymentReference: 'ref',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // verifyCompliance() – state machine: COMPLIED → READY_FOR_RELEASE
  // ──────────────────────────────────────────────────────────────────────
  describe('verifyCompliance', () => {
    it('should transition from COMPLIED to READY_FOR_RELEASE', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.COMPLIED,
        pawnshopId: PAWNSHOP_ID,
      });
      prisma.auctionWinnerCompliance.update.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.READY_FOR_RELEASE,
      });

      const result = await service.verifyCompliance(
        PAWNSHOP_ID,
        'c1',
        'staff-1',
      );

      expect(result.status).toBe(ComplianceStatus.READY_FOR_RELEASE);
    });

    it('should reject verification when not in COMPLIED status', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.PENDING_COMPLIANCE,
        pawnshopId: PAWNSHOP_ID,
      });

      await expect(
        service.verifyCompliance(PAWNSHOP_ID, 'c1', 'staff-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // releaseItem() – state machine: READY_FOR_RELEASE → RELEASED
  // ──────────────────────────────────────────────────────────────────────
  describe('releaseItem', () => {
    it('should release item and mark ticket as SOLD', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.READY_FOR_RELEASE,
        pawnshopId: PAWNSHOP_ID,
        listing: { ticketId: 42 },
      });
      prisma.auctionWinnerCompliance.update.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.RELEASED,
      });
      prisma.ticket.update.mockResolvedValue({ id: 42, status: 'SOLD' });

      const result = await service.releaseItem(PAWNSHOP_ID, 'c1', {
        releasedBy: 'staff-1',
        releaseNotes: 'Picked up by winner',
      });

      expect(result.status).toBe(ComplianceStatus.RELEASED);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42 },
          data: { status: 'SOLD' },
        }),
      );
    });

    it('should reject release when not READY_FOR_RELEASE', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.COMPLIED,
        pawnshopId: PAWNSHOP_ID,
      });

      await expect(
        service.releaseItem(PAWNSHOP_ID, 'c1', {
          releasedBy: 'staff-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // extendDeadline()
  // ──────────────────────────────────────────────────────────────────────
  describe('extendDeadline', () => {
    it('should extend deadline by specified hours', async () => {
      const originalDeadline = new Date('2026-03-04T12:00:00Z');
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.PENDING_COMPLIANCE,
        complianceDeadline: originalDeadline,
        pawnshopId: PAWNSHOP_ID,
      });
      prisma.auctionWinnerCompliance.update.mockImplementation(({ data }) => ({
        id: 'c1',
        complianceDeadline: data.complianceDeadline,
      }));

      const result = await service.extendDeadline(PAWNSHOP_ID, 'c1', 24);

      const expectedDeadline = new Date(originalDeadline);
      expectedDeadline.setHours(expectedDeadline.getHours() + 24);
      expect(result.complianceDeadline.getTime()).toBe(
        expectedDeadline.getTime(),
      );
    });

    it('should reject extending non-pending compliance', async () => {
      prisma.auctionWinnerCompliance.findFirst.mockResolvedValue({
        id: 'c1',
        status: ComplianceStatus.RELEASED,
        pawnshopId: PAWNSHOP_ID,
      });

      await expect(
        service.extendDeadline(PAWNSHOP_ID, 'c1', 24),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getStatistics()
  // ──────────────────────────────────────────────────────────────────────
  describe('getStatistics', () => {
    it('should return counts per status and avg compliance hours', async () => {
      prisma.auctionWinnerCompliance.count
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(2) // complied
        .mockResolvedValueOnce(1) // readyForRelease
        .mockResolvedValueOnce(10) // released
        .mockResolvedValueOnce(2); // expired
      prisma.$queryRaw.mockResolvedValue([
        { avg_time: 12 * 60 * 60 * 1000 }, // 12 hours in ms
      ]);

      const stats = await service.getStatistics(PAWNSHOP_ID);

      expect(stats.pending).toBe(3);
      expect(stats.complied).toBe(2);
      expect(stats.readyForRelease).toBe(1);
      expect(stats.released).toBe(10);
      expect(stats.expired).toBe(2);
      expect(stats.total).toBe(18);
      expect(stats.avgComplianceHours).toBe(12);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // logAccess() – privacy audit
  // ──────────────────────────────────────────────────────────────────────
  describe('logAccess', () => {
    it('should append an entry to the access log', async () => {
      prisma.auctionWinnerCompliance.findUnique.mockResolvedValue({
        id: 'c1',
        accessLog: [
          {
            accessedBy: 'old-user',
            accessType: 'VIEW',
            timestamp: '2026-01-01',
          },
        ],
      });
      prisma.auctionWinnerCompliance.update.mockResolvedValue({});

      await service.logAccess('c1', 'staff-1', 'VIEW');

      expect(prisma.auctionWinnerCompliance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            accessLog: expect.arrayContaining([
              expect.objectContaining({
                accessedBy: 'staff-1',
                accessType: 'VIEW',
              }),
            ]),
          },
        }),
      );
    });
  });
});
