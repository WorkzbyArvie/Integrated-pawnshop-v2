import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prismaMock: {
    customer: { count: jest.Mock };
    ticket: { count: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
    pawnshop: { findUnique: jest.Mock };
    profile: { count: jest.Mock };
    transaction: { aggregate: jest.Mock };
  };

  beforeEach(async () => {
    prismaMock = {
      customer: { count: jest.fn() },
      ticket: { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
      pawnshop: { findUnique: jest.fn() },
      profile: { count: jest.fn() },
      transaction: { aggregate: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaService,
          useValue: prismaMock as unknown as PrismaService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns aggregated dashboard stats', async () => {
    prismaMock.customer.count.mockResolvedValue(10);
    prismaMock.ticket.count.mockResolvedValue(3);
    prismaMock.ticket.aggregate.mockResolvedValue({
      _sum: { loanAmount: 1000 },
    });

    await expect(service.getDashboardStats()).resolves.toEqual({
      totalLoans: 1000,
      totalCustomers: 10,
      activeTickets: 3,
      interestEarned: 50,
      growth: '+12.5%',
    });
  });
});
