import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: jest.Mocked<AnalyticsService>;

  beforeEach(async () => {
    const analyticsServiceMock = {
      getDashboardStats: jest.fn(),
      getBranchStats: jest.fn(),
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

  it('delegates getStats to AnalyticsService', async () => {
    const result: Awaited<ReturnType<AnalyticsService['getDashboardStats']>> = {
      totalLoans: 0,
      totalCustomers: 0,
      activeTickets: 0,
      interestEarned: 0,
      growth: '+12.5%',
    };
    analyticsService.getDashboardStats.mockResolvedValue(result);

    await expect(controller.getStats()).resolves.toEqual(result);
    expect(analyticsService.getDashboardStats).toHaveBeenCalledWith();
  });

  it('delegates getBranchStats to AnalyticsService', async () => {
    const pawnshopId = 'pawnshop-1';
    const result: Awaited<ReturnType<AnalyticsService['getBranchStats']>> = {
      pawnshopId,
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

    await expect(controller.getBranchStats(pawnshopId)).resolves.toEqual(
      result,
    );
    expect(analyticsService.getBranchStats).toHaveBeenCalledWith(pawnshopId);
  });
});
