import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService, type AnalyticsActor } from './analytics.service';

const SHOP_A = '11111111-1111-1111-1111-111111111111';

const req = (actor: AnalyticsActor) => ({ user: actor }) as never;

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: jest.Mocked<AnalyticsService>;

  beforeEach(async () => {
    const analyticsServiceMock = {
      getDashboardStats: jest.fn(),
      getBranchStats: jest.fn(),
      getBatchBranchStats: jest.fn(),
    } as unknown as jest.Mocked<AnalyticsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: analyticsServiceMock },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    analyticsService = module.get(AnalyticsService);
  });

  it('passes the authenticated principal to the service for the dashboard', async () => {
    const actor: AnalyticsActor = { id: 'u1', role: 'OWNER', pawnshopId: SHOP_A };
    const result: Awaited<ReturnType<AnalyticsService['getDashboardStats']>> = {
      pawnshopId: SHOP_A,
      totalLoans: 0,
      totalCustomers: 0,
      activeTickets: 0,
      projectedInterest: 0,
    };
    analyticsService.getDashboardStats.mockResolvedValue(result);

    await expect(controller.getStats(req(actor))).resolves.toEqual(result);
    // The tenant must come from the token, never from the request body.
    expect(analyticsService.getDashboardStats).toHaveBeenCalledWith(actor);
  });

  it('passes both the principal and the requested shop for branch stats', async () => {
    const actor: AnalyticsActor = { id: 'u1', role: 'OWNER', pawnshopId: SHOP_A };
    const result: Awaited<ReturnType<AnalyticsService['getBranchStats']>> = {
      pawnshopId: SHOP_A,
      name: 'Pawn Shop A',
      totalPrincipal: 0,
      projectedInterest: 0,
      clientCount: 0,
      inventorySummary: [],
      staffOnDuty: 0,
      activeTickets: 1,
      vaultCapacity: 0,
      totalEarnings: 0,
    };
    analyticsService.getBranchStats.mockResolvedValue(result);

    await expect(controller.getBranchStats(req(actor), SHOP_A)).resolves.toEqual(result);
    expect(analyticsService.getBranchStats).toHaveBeenCalledWith(actor, SHOP_A);
  });

  it('parses and forwards a batch id list', async () => {
    const actor: AnalyticsActor = { id: 'u1', role: 'SUPER_ADMIN', pawnshopId: null };
    analyticsService.getBatchBranchStats.mockResolvedValue([]);

    await controller.getBatchBranchStats(req(actor), ' a , b ,, c ');

    expect(analyticsService.getBatchBranchStats).toHaveBeenCalledWith(actor, ['a', 'b', 'c']);
  });

  it('tolerates a missing or empty id query', async () => {
    const actor: AnalyticsActor = { id: 'u1', role: 'OWNER', pawnshopId: SHOP_A };
    analyticsService.getBatchBranchStats.mockResolvedValue([]);

    await controller.getBatchBranchStats(req(actor), '');

    expect(analyticsService.getBatchBranchStats).toHaveBeenCalledWith(actor, []);
  });
});
