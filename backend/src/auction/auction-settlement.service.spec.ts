import { Test, TestingModule } from '@nestjs/testing';
import { AuctionSettlementService } from './auction-settlement.service';
import { PrismaService } from '../prisma.service';
import { AuctionStatus, ComplianceStatus } from '@prisma/client';
import { ContractTemplateService } from '../contract/contract-template.service';

describe('AuctionSettlementService', () => {
  let service: AuctionSettlementService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      ensureConnected: jest.fn().mockResolvedValue(true),
      auctionListing: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auctionWinnerCompliance: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      profile: {
        findUnique: jest.fn(),
      },
      ticket: {
        update: jest.fn(),
      },
      legalProof: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionSettlementService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ContractTemplateService,
          useValue: { listTemplates: jest.fn(), getTemplate: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuctionSettlementService>(AuctionSettlementService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // settleEndedAuctions()
  // ──────────────────────────────────────────────────────────────────────
  describe('settleEndedAuctions', () => {
    it('should do nothing when no auctions have ended', async () => {
      prisma.auctionListing.findMany.mockResolvedValue([]);

      await service.settleEndedAuctions();

      expect(prisma.auctionListing.update).not.toHaveBeenCalled();
    });

    it('should settle auction with winning bid above reserve price', async () => {
      prisma.auctionListing.findMany.mockResolvedValue([
        {
          id: 1,
          pawnshopId: 'ps-1',
          ticketId: 10,
          reservePrice: 5000,
          bids: [{ bidderId: 'bidder-1', amount: 8000 }],
          ticket: { id: 10 },
          pawnshop: { id: 'ps-1' },
        },
      ]);
      prisma.auctionListing.update.mockResolvedValue({});
      prisma.profile.findUnique.mockResolvedValue({
        id: 'bidder-1',
        fullName: 'Juan Dela Cruz',
        email: 'juan@email.com',
        kyc: {
          fullName: 'Juan Dela Cruz',
          phoneNumber: '09171234567',
          address: 'Manila',
        },
      });
      prisma.auctionWinnerCompliance.create.mockResolvedValue({ id: 'comp-1' });

      await service.settleEndedAuctions();

      // Should mark as ENDED
      expect(prisma.auctionListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { status: AuctionStatus.ENDED },
        }),
      );
      // Should create compliance with 48-hour deadline
      expect(prisma.auctionWinnerCompliance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            winnerId: 'bidder-1',
            winningBid: 8000,
            winnerFullName: 'Juan Dela Cruz',
          }),
        }),
      );
    });

    it('should end auction with no bids and return ticket to FORFEITED', async () => {
      prisma.auctionListing.findMany.mockResolvedValue([
        {
          id: 2,
          pawnshopId: 'ps-1',
          ticketId: 20,
          reservePrice: 10000,
          bids: [],
          ticket: { id: 20 },
          pawnshop: { id: 'ps-1' },
        },
      ]);
      prisma.auctionListing.update.mockResolvedValue({});
      prisma.ticket.update.mockResolvedValue({});

      await service.settleEndedAuctions();

      expect(prisma.auctionListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AuctionStatus.ENDED },
        }),
      );
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 20 },
          data: { status: 'FORFEITED' },
        }),
      );
      expect(prisma.auctionWinnerCompliance.create).not.toHaveBeenCalled();
    });

    it('should end auction when bid is below reserve price', async () => {
      prisma.auctionListing.findMany.mockResolvedValue([
        {
          id: 3,
          pawnshopId: 'ps-1',
          ticketId: 30,
          reservePrice: 10000,
          bids: [{ bidderId: 'b1', amount: 5000 }],
          ticket: { id: 30 },
          pawnshop: { id: 'ps-1' },
        },
      ]);
      prisma.auctionListing.update.mockResolvedValue({});
      prisma.ticket.update.mockResolvedValue({});

      await service.settleEndedAuctions();

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'FORFEITED' },
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // checkExpiredCompliances()
  // ──────────────────────────────────────────────────────────────────────
  describe('checkExpiredCompliances', () => {
    it('should do nothing when no compliances are expired', async () => {
      prisma.auctionWinnerCompliance.findMany.mockResolvedValue([]);

      await service.checkExpiredCompliances();

      expect(prisma.auctionWinnerCompliance.update).not.toHaveBeenCalled();
    });

    it('should mark expired compliance and return ticket to queue', async () => {
      prisma.auctionWinnerCompliance.findMany.mockResolvedValue([
        {
          id: 'comp-1',
          listing: {
            ticketId: 10,
            bids: [{ amount: 8000 }, { amount: 6000 }],
          },
        },
      ]);
      prisma.auctionWinnerCompliance.update.mockResolvedValue({});
      prisma.ticket.update.mockResolvedValue({});

      await service.checkExpiredCompliances();

      expect(prisma.auctionWinnerCompliance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'comp-1' },
          data: expect.objectContaining({
            status: ComplianceStatus.EXPIRED,
            expiryAction: 'REQUEUE',
          }),
        }),
      );
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'FORFEITED' },
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // manualSettle()
  // ──────────────────────────────────────────────────────────────────────
  describe('manualSettle', () => {
    it('should create compliance for manually settled auction', async () => {
      prisma.auctionListing.findUnique.mockResolvedValue({
        id: 5,
        pawnshopId: 'ps-1',
        ticket: { id: 50 },
        pawnshop: { id: 'ps-1' },
      });
      prisma.auctionListing.update.mockResolvedValue({});
      prisma.profile.findUnique.mockResolvedValue({
        id: 'manual-winner',
        fullName: 'Maria Santos',
        email: 'maria@mail.com',
        kyc: {
          fullName: 'Maria Santos',
          phoneNumber: '09181234567',
          address: 'Quezon City',
        },
      });
      prisma.auctionWinnerCompliance.create.mockResolvedValue({
        id: 'comp-new',
        winnerId: 'manual-winner',
        winningBid: 25000,
      });

      const result = await service.manualSettle(5, 'manual-winner', 25000);

      expect(result.winnerId).toBe('manual-winner');
      expect(result.winningBid).toBe(25000);
      expect(prisma.auctionListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AuctionStatus.ENDED },
        }),
      );
    });

    it('should throw when auction not found', async () => {
      prisma.auctionListing.findUnique.mockResolvedValue(null);

      await expect(service.manualSettle(999, 'winner', 1000)).rejects.toThrow(
        'Auction not found',
      );
    });
  });
});
