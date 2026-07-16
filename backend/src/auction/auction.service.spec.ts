import { Test, TestingModule } from '@nestjs/testing';
import { AuctionService } from './auction.service';
import { PrismaService } from '../prisma.service';
import { AuctionStatus } from '@prisma/client';
import { FinanceService } from '../finance/finance.service';
import { TOSService } from '../contract/tos.service';
import { ContractTemplateService } from '../contract/contract-template.service';

const prismaMock = {
  ticket: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  auctionListing: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  auctionBid: {
    create: jest.fn(),
  },
  auctionImage: {
    createMany: jest.fn(),
  },
  profile: {
    findUnique: jest.fn(),
  },
  bidderKyc: {
    findUnique: jest.fn(),
  },
  legalProof: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const financeMock = {
  createEntry: jest.fn(),
};

const tosServiceMock = {
  hasAccepted: jest.fn(),
  acceptTOS: jest.fn(),
  getAcceptance: jest.fn(),
};

const contractTemplateServiceMock = {
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
};

describe('AuctionService', () => {
  let service: AuctionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: FinanceService,
          useValue: financeMock,
        },
        {
          provide: TOSService,
          useValue: tosServiceMock,
        },
        {
          provide: ContractTemplateService,
          useValue: contractTemplateServiceMock,
        },
      ],
    }).compile();

    service = module.get<AuctionService>(AuctionService);
    prismaMock.ticket.findUnique.mockReset();
    prismaMock.ticket.findFirst.mockReset();
    prismaMock.ticket.findMany.mockReset();
    prismaMock.ticket.update.mockReset();
    prismaMock.ticket.updateMany.mockReset();
    prismaMock.auctionListing.findUnique.mockReset();
    prismaMock.auctionListing.create.mockReset();
    prismaMock.auctionListing.update.mockReset();
    prismaMock.auctionListing.updateMany.mockReset();
    prismaMock.auctionListing.findMany.mockReset();
    prismaMock.auctionBid.create.mockReset();
    prismaMock.auctionImage.createMany.mockReset();
    prismaMock.profile.findUnique.mockReset();
    prismaMock.bidderKyc.findUnique.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.legalProof.create.mockReset();
    financeMock.createEntry.mockReset();
    tosServiceMock.hasAccepted.mockReset();
    tosServiceMock.acceptTOS.mockReset();
    tosServiceMock.getAcceptance.mockReset();
    contractTemplateServiceMock.listTemplates.mockReset();
    contractTemplateServiceMock.getTemplate.mockReset();

    // Default: bidder has accepted TOS so existing bid tests pass
    tosServiceMock.hasAccepted.mockResolvedValue(true);
    tosServiceMock.getAcceptance.mockResolvedValue({
      tosVersion: '1.0',
      acceptedAt: new Date(),
    });
  });

  it('throws when ticket is missing', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expect(
      service.createListing(
        {
          ticketId: 42,
          startingPrice: 1000,
        },
        'actor-id',
      ),
    ).rejects.toThrow('Ticket not found');
  });

  it('creates listing with images', async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({
      id: 7,
      pawnshopId: '11111111-1111-1111-1111-111111111111',
      description: 'Gold ring',
      ticketNumber: 'TK-007',
      category: 'Jewelry',
    });
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'OWNER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.auctionListing.findUnique.mockResolvedValue(null);
    prismaMock.auctionListing.create.mockResolvedValue({ id: 99 });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb(prismaMock),
    );

    const result = await service.createListing(
      {
        ticketId: 7,
        startingPrice: 5000,
        imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      },
      'actor-id',
    );

    expect(prismaMock.auctionListing.create).toHaveBeenCalled();
    expect(prismaMock.auctionImage.createMany).toHaveBeenCalledWith({
      data: [
        { listingId: 99, url: 'https://example.com/a.jpg', sortOrder: 0 },
        { listingId: 99, url: 'https://example.com/b.jpg', sortOrder: 1 },
      ],
    });
    expect(result).toEqual({ id: 99 });
  });

  it('places a bid when listing is live', async () => {
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'BIDDER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.bidderKyc.findUnique.mockResolvedValue({ status: 'VERIFIED' });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb(prismaMock),
    );
    prismaMock.auctionListing.findUnique.mockResolvedValue({
      id: 1,
      currentBid: 1000,
      startingPrice: 500,
      minBidIncrement: 100,
      status: AuctionStatus.LIVE,
      endAt: new Date(Date.now() + 1000 * 60 * 60),
      startAt: new Date(Date.now() - 1000 * 60),
    });
    prismaMock.auctionListing.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auctionBid.create.mockResolvedValue({ id: 321 });

    const result = await service.placeBid(
      1,
      {
        amount: 1500,
      },
      '22222222-2222-2222-2222-222222222222',
    );

    expect(prismaMock.auctionListing.updateMany).toHaveBeenCalled();
    expect(prismaMock.auctionBid.create).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ bidId: 321, listingId: 1, currentBid: 1500 }),
    );
  });

  it('rejects bid below current', async () => {
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'BIDDER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.bidderKyc.findUnique.mockResolvedValue({ status: 'VERIFIED' });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb(prismaMock),
    );
    prismaMock.auctionListing.findUnique.mockResolvedValue({
      id: 2,
      currentBid: 2000,
      startingPrice: 500,
      minBidIncrement: 100,
      status: AuctionStatus.LIVE,
      endAt: new Date(Date.now() + 1000 * 60 * 60),
      startAt: new Date(Date.now() - 1000 * 60),
    });

    await expect(
      service.placeBid(
        2,
        {
          amount: 1500,
        },
        '33333333-3333-3333-3333-333333333333',
      ),
    ).rejects.toThrow('Put Valid Amount');
  });

  it('cancels a listing and returns ticket to auction', async () => {
    prismaMock.auctionListing.findUnique.mockResolvedValue({
      id: 5,
      status: AuctionStatus.LIVE,
      pawnshopId: '11111111-1111-1111-1111-111111111111',
      ticketId: 42,
    });
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'MANAGER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.auctionListing.update.mockResolvedValue({
      id: 5,
      status: AuctionStatus.CANCELLED,
    });
    prismaMock.ticket.update = jest
      .fn()
      .mockResolvedValue({ id: 42, status: 'AUCTION' });

    const result = await service.cancelListing(5, 'actor-id');

    expect(prismaMock.auctionListing.update).toHaveBeenCalled();
    expect(prismaMock.ticket.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ status: 'AUCTION' }),
    });
    expect(result).toEqual({ id: 5, status: AuctionStatus.CANCELLED });
  });

  it('returns queue entries with listing status', async () => {
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'MANAGER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.ticket.findMany.mockResolvedValue([
      {
        id: 101,
        ticketNumber: 'TK-101',
        description: 'Gold ring',
        category: 'Jewelry',
        loanAmount: 5000,
        expiryDate: new Date('2026-03-01T00:00:00.000Z'),
        auctionListing: { id: 9, status: AuctionStatus.LIVE },
      },
    ]);

    const result = await service.getQueue('actor-id');

    expect(prismaMock.ticket.findMany).toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: 101,
        ticketNumber: 'TK-101',
        description: 'Gold ring',
        category: 'Jewelry',
        loanAmount: 5000,
        expiryDate: new Date('2026-03-01T00:00:00.000Z'),
        listingId: 9,
        listingStatus: AuctionStatus.LIVE,
      },
    ]);
  });

  it('returns a ticket to vault', async () => {
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'OWNER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.ticket.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.returnToVault(77, 'actor-id');

    expect(prismaMock.ticket.updateMany).toHaveBeenCalled();
    expect(result).toEqual({ id: 77, status: 'ACTIVE' });
  });

  it('marks a ticket as sold', async () => {
    prismaMock.profile.findUnique.mockResolvedValue({
      role: 'OWNER',
      pawnshopId: '11111111-1111-1111-1111-111111111111',
    });
    prismaMock.ticket.findFirst.mockResolvedValue({
      id: 88,
      pawnshopId: '11111111-1111-1111-1111-111111111111',
      ticketNumber: 'TK-88',
      loanAmount: 1000,
      auctionListing: { id: 3, currentBid: 1200, title: 'Ring' },
    });
    prismaMock.ticket.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.markSold(88, 'actor-id');

    expect(prismaMock.ticket.updateMany).toHaveBeenCalled();
    expect(result).toEqual({ id: 88, status: 'REDEEMED' });
  });
});
