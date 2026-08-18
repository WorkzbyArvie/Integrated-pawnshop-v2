import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CustomerTier } from '@prisma/client';

const TIER_THRESHOLDS: ReadonlyArray<{
  tier: CustomerTier;
  volume: number;
  count: number;
}> = [
  { tier: CustomerTier.VIP, volume: 1_000_000, count: 30 },
  { tier: CustomerTier.GOLD, volume: 400_000, count: 15 },
  { tier: CustomerTier.SILVER, volume: 150_000, count: 8 },
  { tier: CustomerTier.BRONZE, volume: 50_000, count: 3 },
];

const TIER_LABELS: Record<CustomerTier, string> = {
  STANDARD: 'Standard',
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  VIP: 'VIP',
};

export interface TransactionAggregates {
  volume: number;
  count: number;
  breakdown: {
    payments: { count: number; sum: number };
    disbursements: { count: number; sum: number };
    auctionSales: { count: number; sum: number };
  };
}

@Injectable()
export class TierService {
  private readonly logger = new Logger(TierService.name);

  constructor(private readonly prisma: PrismaService) {}

  static tierFor(volume: number, count: number): CustomerTier {
    for (const level of TIER_THRESHOLDS) {
      if (volume >= level.volume || count >= level.count) {
        return level.tier;
      }
    }
    return CustomerTier.STANDARD;
  }

  static labelFor(tier: CustomerTier): string {
    return TIER_LABELS[tier] ?? 'Standard';
  }

  async getTransactionAggregates(customerId: string): Promise<TransactionAggregates> {
    const [payments, disbursements, auctionSales] = await Promise.all([
      this.prisma.payment.findMany({
        where: { customerId, status: 'COMPLETED' },
        select: { amount: true },
      }),
      this.prisma.loanDisbursement.findMany({
        where: { loan: { application: { customerId } } },
        select: { amount: true },
      }),
      this.prisma.receipt.findMany({
        where: { customerId, receiptType: 'AUCTION_SALE', isVoid: false },
        select: { totalAmount: true },
      }),
    ]);

    const sum = (rows: Array<{ amount: number }>) =>
      rows.reduce((total, row) => total + row.amount, 0);

    const paymentsSum = sum(payments);
    const disbursementsSum = sum(disbursements);
    const auctionSalesSum = auctionSales.reduce(
      (total, row) => total + row.totalAmount,
      0,
    );

    return {
      volume: paymentsSum + disbursementsSum + auctionSalesSum,
      count: payments.length + disbursements.length + auctionSales.length,
      breakdown: {
        payments: { count: payments.length, sum: paymentsSum },
        disbursements: {
          count: disbursements.length,
          sum: disbursementsSum,
        },
        auctionSales: { count: auctionSales.length, sum: auctionSalesSum },
      },
    };
  }

  async recomputeCustomerTier(
    customerId: string,
    changedById?: string | null,
  ): Promise<{
    customerId: string;
    tier: CustomerTier;
    label: string;
    fromTier: CustomerTier;
    changed: boolean;
    transactionVolume: number;
    transactionCount: number;
  } | null> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, tier: true },
    });
    if (!customer) return null;

    const aggregates = await this.getTransactionAggregates(customerId);
    const nextTier = TierService.tierFor(aggregates.volume, aggregates.count);
    const fromTier = customer.tier ?? CustomerTier.STANDARD;
    const changed = fromTier !== nextTier;

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        tier: nextTier,
        loyaltyTier: TierService.labelFor(nextTier),
      },
    });

    if (changed) {
      try {
        await this.prisma.customerTierHistory.create({
          data: {
            customerId,
            fromTier,
            toTier: nextTier,
            changedById: changedById ?? null,
            reason: `Auto tier from transaction history — volume ₱${aggregates.volume.toLocaleString()}, ${aggregates.count} transactions`,
          },
        });
      } catch (historyErr) {
        this.logger.error(
          `Failed to record tier history for customer ${customerId}:`,
          historyErr,
        );
      }
    }

    return {
      customerId,
      tier: nextTier,
      label: TierService.labelFor(nextTier),
      fromTier,
      changed,
      transactionVolume: aggregates.volume,
      transactionCount: aggregates.count,
    };
  }

  async getCustomerTierInfo(customerId: string) {
    const [customer, history, aggregates] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { tier: true, loyaltyTier: true },
      }),
      this.prisma.customerTierHistory.findMany({
        where: { customerId },
        orderBy: { changedAt: 'desc' },
        take: 20,
      }),
      this.getTransactionAggregates(customerId),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const tier = customer.tier ?? CustomerTier.STANDARD;

    return {
      customerId,
      tier: TierService.labelFor(tier),
      tierCode: tier,
      transactionVolume: aggregates.volume,
      transactionCount: aggregates.count,
      breakdown: aggregates.breakdown,
      history,
    };
  }
}
