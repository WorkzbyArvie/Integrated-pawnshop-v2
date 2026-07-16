import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    // We use 'ACTIVE' in all caps to satisfy the Prisma Enum type requirement
    const [totalCustomers, activeTickets, loanSum] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.ticket.count({
        where: { status: 'ACTIVE' },
      }),
      this.prisma.ticket.aggregate({
        _sum: { loanAmount: true },
        where: { status: 'ACTIVE' },
      }),
    ]);

    const totalLoansValue = Number(loanSum._sum.loanAmount) || 0;

    return {
      totalLoans: totalLoansValue,
      totalCustomers,
      activeTickets,
      // Fixed: Calculating interest based on the sum of active loans
      interestEarned: totalLoansValue * 0.05,
      growth: '+12.5%',
    };
  }

  // Branch-scoped dashboard data (uses service role on the server)
  async getBranchStats(pawnshopId: string) {
    // Fetch pawnshop name
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { id: true, name: true },
    });

    if (!pawnshop) {
      throw new Error(`Pawnshop ${pawnshopId} not found`);
    }

    // Tickets for this pawnshop
    const tickets = await this.prisma.ticket.findMany({
      where: { pawnshopId },
      select: {
        id: true,
        loanAmount: true,
        interestRate: true,
        status: true,
        category: true,
      },
    });

    const ticketIds = tickets.map((t) => t.id);

    const activeTickets = tickets.filter(
      (t) => (t.status || '').toUpperCase() === 'ACTIVE',
    );

    const totalPrincipal = activeTickets.reduce(
      (s, t) => s + (Number(t.loanAmount) || 0),
      0,
    );

    // Projected interest calculated from each ticket's interest rate
    const projectedInterest = activeTickets.reduce(
      (s, t) =>
        s + ((Number(t.loanAmount) || 0) * (Number(t.interestRate) || 0)) / 100,
      0,
    );

    // Client count for the pawnshop
    const clientCount = await this.prisma.customer.count({
      where: { pawnshopId },
    });

    // Inventory summary derived from ticket categories
    const categoryMap: Record<string, number> = {};
    for (const t of activeTickets) {
      const name = t.category || 'Other';
      categoryMap[name] = (categoryMap[name] || 0) + 1;
    }

    const inventorySummary = Object.keys(categoryMap).map((name) => ({
      name,
      count: categoryMap[name],
    }));

    // Staff / profiles count for this pawnshop
    const staffOnDuty = await this.prisma.profile.count({
      where: { pawnshopId },
    });

    // Active tickets count
    const activeTicketsCount = activeTickets.length;

    // Transactions (earnings) for tickets in this pawnshop
    let totalEarnings = 0;
    if (ticketIds.length > 0) {
      const trxAgg = await this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { ticketId: { in: ticketIds } },
      });
      totalEarnings = Number(trxAgg._sum.amount) || 0;
    }

    // Vault capacity: simple heuristic, inventory items vs arbitrary capacity (server can improve later)
    const inventoryCount = Object.values(categoryMap).reduce(
      (s, v) => s + v,
      0,
    );
    const vaultCapacity =
      inventoryCount === 0
        ? 0
        : Math.min(100, Math.round((inventoryCount / 200) * 100));

    return {
      pawnshopId,
      name: pawnshop.name,
      totalPrincipal,
      projectedInterest,
      clientCount,
      inventorySummary,
      staffOnDuty,
      activeTickets: activeTicketsCount,
      vaultCapacity,
      totalEarnings,
    };
  }
}
