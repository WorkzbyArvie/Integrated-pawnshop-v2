import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { TierService } from './tier.service';
import { PrismaService } from '../prisma.service';
import { CustomerTier } from '@prisma/client';

describe('TierService (CUST-01 / CUST-02 / CUST-03)', () => {
  let service: TierService;
  let prisma: {
    customer: { findUnique: jest.Mock; update: jest.Mock };
    payment: { findMany: jest.Mock };
    loanDisbursement: { findMany: jest.Mock };
    receipt: { findMany: jest.Mock };
    customerTierHistory: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'cust_1' }),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      loanDisbursement: { findMany: jest.fn().mockResolvedValue([]) },
      receipt: { findMany: jest.fn().mockResolvedValue([]) },
      customerTierHistory: {
        create: jest.fn().mockResolvedValue({ id: 'hist_1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module = await Test.createTestingModule({
      providers: [TierService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TierService);
  });

  describe('tierFor(volume, count)', () => {
    it('assigns STANDARD below every threshold', () => {
      expect(TierService.tierFor(0, 0)).toBe(CustomerTier.STANDARD);
      expect(TierService.tierFor(49_999, 2)).toBe(CustomerTier.STANDARD);
    });

    it('assigns BRONZE at ₱50,000 or 3 transactions', () => {
      expect(TierService.tierFor(50_000, 0)).toBe(CustomerTier.BRONZE);
      expect(TierService.tierFor(1, 3)).toBe(CustomerTier.BRONZE);
    });

    it('assigns SILVER at ₱150,000 or 8 transactions', () => {
      expect(TierService.tierFor(150_000, 0)).toBe(CustomerTier.SILVER);
      expect(TierService.tierFor(1, 8)).toBe(CustomerTier.SILVER);
    });

    it('assigns GOLD at ₱400,000 or 15 transactions', () => {
      expect(TierService.tierFor(400_000, 0)).toBe(CustomerTier.GOLD);
      expect(TierService.tierFor(1, 15)).toBe(CustomerTier.GOLD);
    });

    it('assigns VIP at ₱1,000,000 or 30 transactions', () => {
      expect(TierService.tierFor(1_000_000, 0)).toBe(CustomerTier.VIP);
      expect(TierService.tierFor(1, 30)).toBe(CustomerTier.VIP);
    });
  });

  describe('getTransactionAggregates(customerId)', () => {
    it('sums COMPLETED payments, disbursements and AUCTION_SALE receipts', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { amount: 1000 },
        { amount: 2000 },
      ]);
      prisma.loanDisbursement.findMany.mockResolvedValue([{ amount: 5000 }]);
      prisma.receipt.findMany.mockResolvedValue([
        { totalAmount: 3000 },
        { totalAmount: 1500 },
      ]);

      const aggregates = await service.getTransactionAggregates('cust_1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'cust_1', status: 'COMPLETED' },
        }),
      );
      expect(aggregates).toEqual({
        volume: 12500,
        count: 5,
        breakdown: {
          payments: { count: 2, sum: 3000 },
          disbursements: { count: 1, sum: 5000 },
          auctionSales: { count: 2, sum: 4500 },
        },
      });
    });

    it('returns zeros when the customer has no transactions', async () => {
      const aggregates = await service.getTransactionAggregates('cust_1');

      expect(aggregates.volume).toBe(0);
      expect(aggregates.count).toBe(0);
    });
  });

  describe('recomputeCustomerTier(customerId)', () => {
    it('updates Customer.tier and mirrors loyaltyTier, writing history only on change', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust_1',
        tier: CustomerTier.STANDARD,
      });
      prisma.payment.findMany.mockResolvedValue([
        { amount: 200_000 },
        { amount: 200_000 },
      ]);

      const result = await service.recomputeCustomerTier('cust_1', 'staff_1');

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust_1' },
          data: expect.objectContaining({
            tier: CustomerTier.GOLD,
            loyaltyTier: 'Gold',
          }),
        }),
      );
      expect(prisma.customerTierHistory.create).toHaveBeenCalledTimes(1);
      expect(prisma.customerTierHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust_1',
            fromTier: CustomerTier.STANDARD,
            toTier: CustomerTier.GOLD,
            changedById: 'staff_1',
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          tier: CustomerTier.GOLD,
          label: 'Gold',
          changed: true,
        }),
      );
    });

    it('does not write tier history when tier is unchanged', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust_1',
        tier: CustomerTier.BRONZE,
      });
      prisma.payment.findMany.mockResolvedValue([{ amount: 60_000 }]);

      const result = await service.recomputeCustomerTier('cust_1');

      expect(prisma.customerTierHistory.create).not.toHaveBeenCalled();
      expect(result?.changed).toBe(false);
      expect(result?.tier).toBe(CustomerTier.BRONZE);
    });

    it('returns null when the customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      const result = await service.recomputeCustomerTier('missing');

      expect(result).toBeNull();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('getCustomerTierInfo(customerId)', () => {
    it('returns tier label, aggregates and history', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        tier: CustomerTier.VIP,
        loyaltyTier: 'VIP',
      });
      prisma.customerTierHistory.findMany.mockResolvedValue([
        { id: 'hist_1', toTier: CustomerTier.VIP },
      ]);

      const info = await service.getCustomerTierInfo('cust_1');

      expect(info.tier).toBe('VIP');
      expect(info.tierCode).toBe(CustomerTier.VIP);
      expect(info.transactionVolume).toBe(0);
      expect(info.history).toHaveLength(1);
    });

    it('throws NotFoundException for unknown customers', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.getCustomerTierInfo('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
