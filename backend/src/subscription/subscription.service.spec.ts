import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import { PaymongoService } from './paymongo.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  SubscriptionTier,
  SubscriptionStatus,
  BillingInterval,
} from '@prisma/client';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let prisma: Record<string, any>;
  let financeService: Record<string, any>;
  let paymongoService: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      subscription: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      subscriptionPayment: {
        create: jest.fn(),
      },
      branch: {
        count: jest.fn(),
      },
      staff: {
        count: jest.fn(),
      },
      cashLedgerEntry: {
        count: jest.fn(),
      },
    };

    financeService = { createEntry: jest.fn() };
    paymongoService = {
      isEnabled: false,
      getOrCreatePlan: jest.fn(),
      createSubscription: jest.fn(),
      createPaymentLink: jest.fn(),
      updateSubscriptionPlan: jest.fn(),
      cancelSubscription: jest.fn(),
      createTestCycle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceService, useValue: financeService },
        { provide: PaymongoService, useValue: paymongoService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // create()
  // ──────────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('should create a subscription with TRIAL status and 14-day trial', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.create.mockImplementation(({ data }) => ({
        id: 'sub-1',
        ...data,
      }));

      const result = await service.create(PAWNSHOP_ID, {
        tier: SubscriptionTier.BASIC,
        billingInterval: BillingInterval.MONTHLY,
        billingEmail: 'owner@shop.com',
        trialAutoChargeConsent: true,
      });

      expect(result.status).toBe(SubscriptionStatus.TRIAL);
      expect(result.tier).toBe(SubscriptionTier.BASIC);
      expect(result.price).toBe(2999); // BASIC monthly
      expect(result.maxBranches).toBe(3);
      expect(result.maxStaff).toBe(10);
    });

    it('should apply quarterly discount (2.85x monthly instead of 3x)', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.create.mockImplementation(({ data }) => ({
        id: 'sub-1',
        ...data,
      }));

      const result = await service.create(PAWNSHOP_ID, {
        tier: SubscriptionTier.PROFESSIONAL,
        billingInterval: BillingInterval.QUARTERLY,
        trialAutoChargeConsent: true,
      });

      // PROFESSIONAL monthly = 7999, quarterly = 7999 * 2.85
      expect(result.price).toBeCloseTo(7999 * 2.85, 2);
    });

    it('should apply annual discount (10.8x monthly instead of 12x)', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.subscription.create.mockImplementation(({ data }) => ({
        id: 'sub-1',
        ...data,
      }));

      const result = await service.create(PAWNSHOP_ID, {
        tier: SubscriptionTier.BASIC,
        billingInterval: BillingInterval.ANNUALLY,
        trialAutoChargeConsent: true,
      });

      expect(result.price).toBeCloseTo(2999 * 10.8, 2);
    });

    it('should require explicit auto-charge consent before trial starts', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(
        service.create(PAWNSHOP_ID, {
          tier: SubscriptionTier.BASIC,
          billingInterval: BillingInterval.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not grant trial again once trial was previously used', async () => {
      prisma.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'old-sub' });
      prisma.subscription.create.mockImplementation(({ data }) => ({
        id: 'sub-2',
        ...data,
      }));

      const result = await service.create(PAWNSHOP_ID, {
        tier: SubscriptionTier.BASIC,
        billingInterval: BillingInterval.MONTHLY,
      });

      expect(result.status).toBe(SubscriptionStatus.PAST_DUE);
      expect(result.trialEndDate).toBeNull();
      expect(result.trialEligible).toBe(false);
    });

    it('should throw BadRequestException when active subscription exists', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'existing',
        status: SubscriptionStatus.ACTIVE,
      });

      await expect(
        service.create(PAWNSHOP_ID, {
          tier: SubscriptionTier.BASIC,
          billingInterval: BillingInterval.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getCurrent()
  // ──────────────────────────────────────────────────────────────────────
  describe('getCurrent', () => {
    it('should return active subscription with recent payments', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tier: SubscriptionTier.PROFESSIONAL,
        status: SubscriptionStatus.ACTIVE,
        payments: [],
      });

      const result = await service.getCurrent(PAWNSHOP_ID);
      expect(result.tier).toBe(SubscriptionTier.PROFESSIONAL);
    });

    it('should auto-provision BASIC trial when no subscription history exists', async () => {
      prisma.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.subscription.create.mockImplementation(({ data }) => ({
        id: 'trial-1',
        ...data,
      }));

      const result = await service.getCurrent(PAWNSHOP_ID);

      expect(result.tier).toBe(SubscriptionTier.BASIC);
      expect(result.status).toBe(SubscriptionStatus.TRIAL);
      expect(result.maxBranches).toBe(3);
      expect(result.maxStaff).toBe(10);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // changeTier()
  // ──────────────────────────────────────────────────────────────────────
  describe('changeTier', () => {
    it('should upgrade tier and recalculate price', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tier: SubscriptionTier.BASIC,
        billingInterval: BillingInterval.MONTHLY,
      });
      prisma.subscription.update.mockImplementation(({ data }) => ({
        id: 'sub-1',
        ...data,
      }));

      const result = await service.changeTier(
        PAWNSHOP_ID,
        SubscriptionTier.PROFESSIONAL,
      );

      expect(result.tier).toBe(SubscriptionTier.PROFESSIONAL);
      expect(result.price).toBe(7999); // PROFESSIONAL monthly
      expect(result.maxBranches).toBe(10);
    });

    it('should throw NotFoundException when no active subscription', async () => {
      prisma.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        service.changeTier(PAWNSHOP_ID, SubscriptionTier.ENTERPRISE),
      ).rejects.toThrow(NotFoundException);
    });

    it('should block tier change while subscription period is active', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);

      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tier: SubscriptionTier.BASIC,
        billingInterval: BillingInterval.MONTHLY,
        endDate: future,
      });

      await expect(
        service.changeTier(PAWNSHOP_ID, SubscriptionTier.PROFESSIONAL),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // cancel()
  // ──────────────────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('should cancel subscription and disable auto-renew', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
      });
      prisma.subscription.update.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.CANCELLED,
        autoRenew: false,
      });

      const result = await service.cancel(PAWNSHOP_ID, 'Cancelling due to operational budget constraints.');

      expect(result.status).toBe(SubscriptionStatus.CANCELLED);
      expect(result.autoRenew).toBe(false);
    });

    it('should throw NotFoundException when no active subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(
        service.cancel(PAWNSHOP_ID, 'Cancelling due to operational budget constraints.'),
      ).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return latest cancelled subscription when already cancelled', async () => {
      prisma.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'sub-cancelled',
          status: SubscriptionStatus.CANCELLED,
          autoRenew: false,
        });

      const result = await service.cancel(
        PAWNSHOP_ID,
        'Cancel action should be idempotent when subscription is already cancelled.',
      );

      expect(result.status).toBe(SubscriptionStatus.CANCELLED);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('should cancel subscription when status is PAST_DUE', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-3',
        status: SubscriptionStatus.PAST_DUE,
      });
      prisma.subscription.update.mockResolvedValue({
        id: 'sub-3',
        status: SubscriptionStatus.CANCELLED,
        autoRenew: false,
      });

      const result = await service.cancel(
        PAWNSHOP_ID,
        'Cancelling pending subscription before any successful payment.',
      );

      expect(result.status).toBe(SubscriptionStatus.CANCELLED);
      expect(result.autoRenew).toBe(false);
    });

    it('should cancel upstream PayMongo subscription to prevent future charges', async () => {
      paymongoService.isEnabled = true;
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-2',
        status: SubscriptionStatus.TRIAL,
        paymongoSubscriptionId: 'pm-sub-123',
      });
      prisma.subscription.update.mockResolvedValue({
        id: 'sub-2',
        status: SubscriptionStatus.CANCELLED,
        autoRenew: false,
      });

      await service.cancel(
        PAWNSHOP_ID,
        'Cancelling trial before billing to avoid automatic charge.',
      );

      expect(paymongoService.cancelSubscription).toHaveBeenCalledWith('pm-sub-123');
    });
  });

  describe('getCurrent after cancellation', () => {
    it('should not auto-provision trial when historical subscription exists', async () => {
      prisma.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'cancelled-sub' });

      const result = await service.getCurrent(PAWNSHOP_ID);

      expect(result.tier).toBe(SubscriptionTier.FREE);
      expect(result.status).toBe(SubscriptionStatus.CANCELLED);
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getPlans()
  // ──────────────────────────────────────────────────────────────────────
  describe('getPlans', () => {
    it('should return all 4 tier configurations', () => {
      const plans = service.getPlans();

      expect(plans).toHaveLength(4);
      expect(plans.map((p: any) => p.tier)).toEqual([
        'FREE',
        'BASIC',
        'PROFESSIONAL',
        'ENTERPRISE',
      ]);
      expect(plans[0].monthlyPrice).toBe(0);
      expect(plans[3].limits.max_branches).toBeNull(); // ENTERPRISE unlimited
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // hasFeature()
  // ──────────────────────────────────────────────────────────────────────
  describe('hasFeature', () => {
    it('should return true for enabled feature', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        features: { analytics: true, api_access: true },
        payments: [],
      });

      const result = await service.hasFeature(PAWNSHOP_ID, 'api_access');
      expect(result).toBe(true);
    });

    it('should return false for disabled feature on FREE tier', async () => {
      prisma.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'historical-sub' });

      const result = await service.hasFeature(PAWNSHOP_ID, 'api_access');
      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // checkLimits()
  // ──────────────────────────────────────────────────────────────────────
  describe('checkLimits', () => {
    it('should report within limits when usage is below maximums', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        maxBranches: 3,
        maxStaff: 10,
        maxTransactions: 500,
        features: {},
        payments: [],
      });
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ count: 5 }])
        .mockResolvedValueOnce([{ count: 100 }]);

      const limits = await service.checkLimits(PAWNSHOP_ID);

      expect(limits.exceededLimits).not.toContain('Branches');
      expect(limits.exceededLimits).not.toContain('Staff');
    });

    it('should report exceeded when at max branches', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        maxBranches: 3,
        maxStaff: 10,
        maxTransactions: 500,
        features: {},
        payments: [],
      });
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 3 }])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([{ count: 10 }]);

      const limits = await service.checkLimits(PAWNSHOP_ID);

      expect(limits.exceededLimits).toContain('Branches');
    });

    it('should always allow for ENTERPRISE (null limits)', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        maxBranches: null,
        maxStaff: null,
        maxTransactions: null,
        features: {},
        payments: [],
      });
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 100 }])
        .mockResolvedValueOnce([{ count: 500 }])
        .mockResolvedValueOnce([{ count: 1000 }]);

      const limits = await service.checkLimits(PAWNSHOP_ID);

      expect(limits.exceededLimits).not.toContain('Branches');
      expect(limits.exceededLimits).not.toContain('Staff');
    });
  });
});
