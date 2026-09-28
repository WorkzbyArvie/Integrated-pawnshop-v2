import { Test, TestingModule } from '@nestjs/testing';
import { DecisionSupportService } from './decision-support.service';
import { PrismaService } from '../prisma.service';

const SHOP_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const SHOP_B = 'bbbbbbbb-2222-2222-2222-222222222222';

const MIN = 60_000;

/** A completed ticket occupied a counter for `minutes`. */
function served(minutes: number, overrides: Record<string, unknown> = {}) {
  const servedAt = new Date('2026-09-28T09:00:00Z');
  return {
    servedAt,
    completedAt: new Date(servedAt.getTime() + minutes * MIN),
    calledAt: new Date(servedAt.getTime() - 2 * MIN),
    joinedAt: new Date(servedAt.getTime() - 12 * MIN),
    counterNumber: '1',
    queueType: 'PAWNING' as const,
    notifiedAt: null,
    estimatedWaitMinutes: null,
    ...overrides,
  };
}

describe('DecisionSupportService', () => {
  let service: DecisionSupportService;
  let prisma: {
    queueTicket: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    pawnshop: { findMany: jest.Mock; findUnique: jest.Mock };
    ticket: { findMany: jest.Mock };
    profile: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      queueTicket: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pawnshop: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      profile: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionSupportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DecisionSupportService>(DecisionSupportService);
  });

  /** A waiting ticket owned by SHOP_A, so predictWait proceeds. */
  function givenWaitingTicket(overrides: Record<string, unknown> = {}) {
    prisma.queueTicket.findUnique.mockResolvedValue({
      id: 'ticket-1',
      pawnshopId: SHOP_A,
      branchId: null,
      queueType: 'PAWNING',
      status: 'WAITING',
      priority: 0,
      joinedAt: new Date('2026-09-28T08:00:00Z'),
      ...overrides,
    });
  }

  describe('the honesty contract', () => {
    // The screen this replaces returned `total * 0.035` and a hardcoded
    // '+12.5%'. The whole point of this module is that it declines to answer
    // rather than producing a confident number it cannot support.
    it('declines to predict with no history instead of guessing', async () => {
      givenWaitingTicket();
      prisma.queueTicket.count.mockResolvedValue(0);
      prisma.queueTicket.findMany.mockResolvedValue([]);

      const result = await service.predictWait(SHOP_A, 'ticket-1');

      expect(result.minutes.value).toBeNull();
      expect(result.minutes.basis).toBe('insufficient_history');
      expect(result.meanServiceMinutes.value).toBeNull();
      expect(result.explanation).toMatch(/not enough/i);
    });

    it('returns a null value with a stated basis in the report when history is thin', async () => {
      prisma.queueTicket.findMany.mockResolvedValue([]);
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_A);

      expect(report.noShowRate.overall.value).toBeNull();
      expect(report.noShowRate.overall.basis).toBe('insufficient_history');
      expect(report.predictionCalibration.biasMinutes.value).toBeNull();
      expect(report.dataQuality.canPredictWait).toBe(false);
      expect(report.dataQuality.warnings.join(' ')).toMatch(/prediction needs/i);
    });

    it('still reports real counts and sums when it cannot predict', async () => {
      prisma.queueTicket.findMany.mockResolvedValue([]);
      prisma.ticket.findMany.mockResolvedValue([
        { lifecycleStatus: 'ACTIVE', loanAmount: 5000 },
        { lifecycleStatus: 'ACTIVE', loanAmount: 3000 },
        { lifecycleStatus: 'FORFEITED', loanAmount: 2000 },
      ]);

      const report = await service.buildReport(SHOP_A);

      // No rate applied, nothing forecast - just what the tickets say.
      expect(report.lifecycleExposure).toEqual([
        { lifecycleStatus: 'ACTIVE', tickets: 2, principal: 8000 },
        { lifecycleStatus: 'FORFEITED', tickets: 1, principal: 2000 },
      ]);
    });
  });

  describe('wait prediction', () => {
    it('uses the observed mean once a bucket has enough samples', async () => {
      // 12 observations of a 10 minute transaction clears the sample floor.
      const history = Array.from({ length: 12 }, () => served(10));
      givenWaitingTicket();
      prisma.queueTicket.count
        .mockResolvedValueOnce(4) // people ahead
        .mockResolvedValueOnce(2); // counters serving
      prisma.queueTicket.findMany.mockResolvedValue(history);

      const result = await service.predictWait(SHOP_A, 'ticket-1');

      expect(result.meanServiceMinutes.basis).toBe('observed');
      expect(result.meanServiceMinutes.value).toBe(10);
      // 4 ahead * 10 min / 2 counters
      expect(result.minutes.value).toBe(20);
      expect(result.explanation).toContain('12 completed tickets');
    });

    it('never divides by zero when no counter is serving', async () => {
      const history = Array.from({ length: 12 }, () => served(8));
      givenWaitingTicket();
      prisma.queueTicket.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
      prisma.queueTicket.findMany.mockResolvedValue(history);

      const result = await service.predictWait(SHOP_A, 'ticket-1');

      expect(Number.isFinite(result.minutes.value)).toBe(true);
      expect(result.minutes.value).toBe(24);
      expect(result.activeCounters).toBe(0);
    });

    it('discards implausible durations rather than averaging them in', async () => {
      // A negative duration and a 13-hour one are data errors, not signals.
      const base = served(10);
      const history = [
        ...Array.from({ length: 10 }, () => served(10)),
        { ...base, completedAt: new Date(base.servedAt.getTime() - 5 * MIN) },
        { ...base, completedAt: new Date(base.servedAt.getTime() + 13 * 60 * MIN) },
      ];
      givenWaitingTicket();
      prisma.queueTicket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      prisma.queueTicket.findMany.mockResolvedValue(history);

      const result = await service.predictWait(SHOP_A, 'ticket-1');

      expect(result.meanServiceMinutes.value).toBe(10);
      expect(result.meanServiceMinutes.sampleSize).toBe(10);
    });

    it('refuses to predict a ticket belonging to another shop', async () => {
      givenWaitingTicket({ pawnshopId: SHOP_B });
      prisma.queueTicket.findMany.mockResolvedValue([]);

      const result = await service.predictWait(SHOP_A, 'ticket-1');

      expect(result.minutes.value).toBeNull();
      expect(result.explanation).toMatch(/could not be found/i);
    });
  });

  describe('no-show rate', () => {
    // The denominator is warned customers, not every join. A customer who was
    // never told to come cannot be a no-show, and counting them would make the
    // shop look worse for a feature that never reached them.
    it('divides by warned tickets, not by all joins', async () => {
      prisma.queueTicket.findMany.mockImplementation((args: any) => {
        if (args?.where?.notifiedAt) {
          return Promise.resolve([
            { queueType: 'PAWNING', status: 'NO_SHOW' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
            { queueType: 'PAWNING', status: 'COMPLETED' },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_A);

      expect(report.noShowRate.overall.sampleSize).toBe(10);
      expect(report.noShowRate.overall.value).toBe(10);
    });
  });

  describe('prediction calibration', () => {
    it('reports a positive bias when the engine over-promises', async () => {
      const history = Array.from({ length: 12 }, () =>
        served(10, { estimatedWaitMinutes: 20, calledAt: new Date('2026-09-28T09:00:00Z') }),
      );
      prisma.queueTicket.findMany.mockImplementation((args: any) =>
        args?.where?.notifiedAt ? Promise.resolve([]) : Promise.resolve(history),
      );
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_A);

      // Promised 20 min, was actually called immediately -> +20 bias.
      expect(report.predictionCalibration.comparedSamples).toBe(12);
      expect(report.predictionCalibration.biasMinutes.value).toBeGreaterThan(0);
      expect(report.predictionCalibration.note).toMatch(/run long/i);
    });

    it('excludes tickets that were never given an estimate', async () => {
      const history = [
        ...Array.from({ length: 11 }, () => served(10, { estimatedWaitMinutes: 20 })),
        served(10, { estimatedWaitMinutes: null }),
      ];
      prisma.queueTicket.findMany.mockImplementation((args: any) =>
        args?.where?.notifiedAt ? Promise.resolve([]) : Promise.resolve(history),
      );
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_A);

      expect(report.predictionCalibration.comparedSamples).toBe(11);
    });
  });

  describe('operational breakdowns', () => {
    it('summarises counters and peak hours from completed tickets only', async () => {
      const history = [
        served(10, { counterNumber: '1', joinedAt: new Date('2026-09-28T08:00:00Z') }),
        served(20, { counterNumber: '1', joinedAt: new Date('2026-09-28T09:00:00Z') }),
        served(15, { counterNumber: '2', joinedAt: new Date('2026-09-28T09:00:00Z') }),
      ];
      prisma.queueTicket.findMany.mockImplementation((args: any) =>
        args?.where?.notifiedAt ? Promise.resolve([]) : Promise.resolve(history),
      );
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_A);

      expect(report.counterUtilisation).toEqual([
        { counter: '1', served: 2, meanServiceMinutes: 15 },
        { counter: '2', served: 1, meanServiceMinutes: 15 },
      ]);
      expect(report.peakHours).toEqual([
        { hour: 8, joined: 1 },
        { hour: 9, joined: 2 },
      ]);
    });

    it('leaves per-type service time null where a type has no history', async () => {
      prisma.queueTicket.findMany.mockResolvedValue([]);
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_A);

      const all = report.serviceTimeByType;
      expect(all).toHaveLength(5);
      expect(all.every((row) => row.meanServiceMinutes === null)).toBe(true);
      expect(all.every((row) => row.samples === 0)).toBe(true);
    });
  });

  describe('tenant scope', () => {
    it('never returns another shop in the report', async () => {
      prisma.queueTicket.findMany.mockResolvedValue([]);
      prisma.ticket.findMany.mockResolvedValue([]);

      const report = await service.buildReport(SHOP_B);

      expect(report.pawnshopId).toBe(SHOP_B);
    });
  });
});
