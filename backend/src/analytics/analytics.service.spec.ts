import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService, type AnalyticsActor } from './analytics.service';
import { PrismaService } from '../prisma.service';

const SHOP_A = '11111111-1111-1111-1111-111111111111';
const SHOP_B = '22222222-2222-2222-2222-222222222222';

const shopActor = (pawnshopId: string | null = SHOP_A): AnalyticsActor => ({
  id: 'user-1',
  role: 'OWNER',
  pawnshopId,
});

const platformActor = (): AnalyticsActor => ({
  id: 'user-root',
  role: 'SUPER_ADMIN',
  pawnshopId: null,
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prismaMock: {
    customer: { count: jest.Mock };
    ticket: { count: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
    pawnshop: { findUnique: jest.Mock };
    profile: { count: jest.Mock };
    transaction: { aggregate: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prismaMock = {
      customer: { count: jest.fn() },
      ticket: { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
      pawnshop: { findUnique: jest.fn() },
      profile: { count: jest.fn() },
      transaction: { aggregate: jest.fn() },
      $queryRaw: jest.fn(),
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

  describe('dashboard stats', () => {
    beforeEach(() => {
      prismaMock.customer.count.mockResolvedValue(10);
      prismaMock.ticket.count.mockResolvedValue(3);
      prismaMock.ticket.aggregate.mockResolvedValue({ _sum: { loanAmount: 1000 } });
      // Interest is summed per ticket now, so the aggregate on `interestRate` is
      // gone from the query. The fixtures used to model it as a summed rate,
      // which is what hid the fact that summing rates and multiplying once by
      // total principal is not an average.
      prismaMock.ticket.findMany.mockResolvedValue([
        { loanAmount: 400, interestRate: 0.035 },
        { loanAmount: 300, interestRate: 0.035 },
        { loanAmount: 300, interestRate: 0.035 },
      ] as any);
    });

    it('scopes every aggregate to the caller shop', async () => {
      // Regression: these three calls carried no `where` clause at all, so the
      // dashboard reported totals from every tenant in the database.
      await service.getDashboardStats(shopActor(SHOP_A));

      expect(prismaMock.customer.count).toHaveBeenCalledWith({
        where: { pawnshopId: SHOP_A },
      });
      expect(prismaMock.ticket.count).toHaveBeenCalledWith({
        where: { pawnshopId: SHOP_A, status: 'ACTIVE' },
      });
      expect(prismaMock.ticket.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pawnshopId: SHOP_A, status: 'ACTIVE' },
        }),
      );
    });

    it('echoes the tenant it scoped to', async () => {
      await expect(service.getDashboardStats(shopActor(SHOP_B))).resolves.toMatchObject({
        pawnshopId: SHOP_B,
      });
    });

    it('returns a projected interest figure instead of a fabricated one', async () => {
      // `interestEarned` was `totalLoans * 0.05` - a hardcoded 5% matching no
      // rate configured anywhere, with zero consumers. It is gone.
      const result = await service.getDashboardStats(shopActor());

      expect(result).not.toHaveProperty('interestEarned');
      expect(result).not.toHaveProperty('growth');
      // 1000 * 0.035 = 35. The old expression was (1000 * 10.5) / 100 = 105:
      // a summed rate multiplied by total principal, then divided by 100 as if
      // the column were a percentage when it is a fraction.
      expect(result.projectedInterest).toBeCloseTo(35, 5);
    });

    it('does not treat a sum of rates as an average', async () => {
      // The scaling bug. Three tickets at 3.5% summed to 10.5 and were then
      // multiplied by total principal, so a PHP 1,000 portfolio reported PHP 105
      // of monthly interest against a true PHP 35 - and the error grew with the
      // number of tickets, not with the money.
      const result = await service.getDashboardStats(shopActor());
      expect(result.projectedInterest).toBeCloseTo(35, 5);
    });

    it('accrues each ticket at its own rate', async () => {
      // A shop pricing two of its loans at 2% must not be shown the 3.5% figure.
      prismaMock.ticket.findMany.mockResolvedValue([
        { loanAmount: 10_000, interestRate: 0.02 },
        { loanAmount: 10_000, interestRate: 0.035 },
      ] as any);

      const result = await service.getDashboardStats(shopActor());
      expect(result.projectedInterest).toBeCloseTo(550, 5);
    });

    it('is unaffected by how many tickets there are', async () => {
      // Same money, same rate, split differently. Interest accrues on principal,
      // so the figure must not move with the ticket count.
      prismaMock.ticket.findMany.mockResolvedValue([
        { loanAmount: 1000, interestRate: 0.035 },
      ] as any);
      const one = await service.getDashboardStats(shopActor());

      prismaMock.ticket.findMany.mockResolvedValue([
        { loanAmount: 500, interestRate: 0.035 },
        { loanAmount: 500, interestRate: 0.035 },
      ] as any);
      const two = await service.getDashboardStats(shopActor());

      expect(two.projectedInterest).toBeCloseTo(one.projectedInterest, 5);
    });

    it('bounds the per-ticket read', async () => {
      await service.getDashboardStats(shopActor());
      expect(prismaMock.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { pawnshopId: expect.any(String), status: 'ACTIVE' } }),
      );
    });

    it('refuses an account with no tenant rather than returning a platform total', async () => {
      await expect(service.getDashboardStats(shopActor(null))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.customer.count).not.toHaveBeenCalled();
    });

    it('still lets a platform operator read a named tenant', async () => {
      await expect(service.getDashboardStats(platformActor())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      prismaMock.ticket.aggregate.mockResolvedValue({ _sum: { loanAmount: 0, interestRate: 0 } });
      prismaMock.customer.count.mockResolvedValue(0);
      prismaMock.ticket.count.mockResolvedValue(0);
      prismaMock.$queryRaw.mockResolvedValue([
        {
          pawnshop_id: SHOP_A,
          name: 'Dasmariñas Pawnshop',
          active_tickets: 0,
          total_principal: 0,
          projected_interest: 0,
          inventory_summary: [],
          client_count: 0,
          staff_on_duty: 0,
          total_earnings: 0,
        },
      ]);
      await expect(service.getBranchStats(platformActor(), SHOP_A)).resolves.toMatchObject({
        pawnshopId: SHOP_A,
      });
    });
  });

  describe('branch stats tenant isolation', () => {
    beforeEach(() => {
      prismaMock.$queryRaw.mockResolvedValue([
        {
          pawnshop_id: SHOP_A,
          name: 'Dasmariñas Pawnshop',
          active_tickets: 2,
          total_principal: 5000,
          projected_interest: 175,
          inventory_summary: [],
          client_count: 4,
          staff_on_duty: 2,
          total_earnings: 900,
        },
      ]);
    });

    it('refuses a read of another shop', async () => {
      // Regression: the handler took no identity and trusted the path segment,
      // so any authenticated profile could read any tenant by id.
      await expect(service.getBranchStats(shopActor(SHOP_A), SHOP_B)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('allows a read of the caller own shop', async () => {
      await expect(service.getBranchStats(shopActor(SHOP_A), SHOP_A)).resolves.toMatchObject({
        pawnshopId: SHOP_A,
        totalPrincipal: 5000,
      });
    });

    it('ignores the path segment and uses the caller tenant when none is given', async () => {
      await expect(service.getBranchStats(shopActor(SHOP_A))).resolves.toMatchObject({
        pawnshopId: SHOP_A,
      });
    });
  });

  describe('batch branch stats tenant isolation', () => {
    it('drops ids belonging to other shops', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const result = await service.getBatchBranchStats(shopActor(SHOP_A), [SHOP_B]);
      expect(result).toEqual([]);
    });

    it('keeps only the caller own id from a mixed request', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await service.getBatchBranchStats(shopActor(SHOP_A), [SHOP_A, SHOP_B]);
      // The filtered list is interpolated into the query, so assert the raw SQL
      // received only the permitted id.
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
    });

    it('returns nothing for an unscoped account', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await expect(
        service.getBatchBranchStats(shopActor(null), [SHOP_A, SHOP_B]),
      ).resolves.toEqual([]);
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
