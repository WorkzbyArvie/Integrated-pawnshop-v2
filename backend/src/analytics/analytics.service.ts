import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getBatchBranchStats(pawnshopIds: string[]) {
    if (!pawnshopIds.length) return [];

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        p.id AS pawnshop_id,
        p.name,
        COALESCE(t.active_count, 0) AS active_tickets,
        COALESCE(t.total_principal, 0) AS total_principal,
        COALESCE(t.projected_interest, 0) AS projected_interest,
        COALESCE(c.client_count, 0) AS client_count,
        COALESCE(s.staff_count, 0) AS staff_on_duty
      FROM public.pawnshops p
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_count,
          COALESCE(SUM(loan_amount) FILTER (WHERE status = 'ACTIVE'), 0) AS total_principal,
          COALESCE(SUM((loan_amount * interest_rate) / 100) FILTER (WHERE status = 'ACTIVE'), 0) AS projected_interest
        FROM public.ticket
        WHERE pawnshop_id = p.id
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS client_count
        FROM public.customer
        WHERE pawnshop_id = p.id
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS staff_count
        FROM public.profiles
        WHERE pawnshop_id = p.id
      ) s ON true
      WHERE p.id = ANY(${pawnshopIds}::uuid[])
    `;

    return rows.map((r: any) => ({
      pawnshopId: r.pawnshop_id,
      name: r.name,
      activeTickets: Number(r.active_tickets),
      totalPrincipal: Number(r.total_principal),
      projectedInterest: Number(r.projected_interest),
      clientCount: Number(r.client_count),
      staffOnDuty: Number(r.staff_on_duty),
      vaultCapacity: Math.min(100, Math.round((Number(r.active_tickets) / 200) * 100)),
      totalEarnings: 0,
    }));
  }

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
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        p.id AS pawnshop_id,
        p.name,
        COALESCE(t.active_count, 0) AS active_tickets,
        COALESCE(t.total_principal, 0) AS total_principal,
        COALESCE(t.projected_interest, 0) AS projected_interest,
        COALESCE(inv.inventory_summary, '[]'::jsonb) AS inventory_summary,
        COALESCE(c.client_count, 0) AS client_count,
        COALESCE(s.staff_count, 0) AS staff_on_duty,
        COALESCE(e.total_earnings, 0) AS total_earnings
      FROM public.pawnshops p
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_count,
          COALESCE(SUM(loan_amount) FILTER (WHERE status = 'ACTIVE'), 0) AS total_principal,
          COALESCE(SUM((loan_amount * interest_rate) / 100) FILTER (WHERE status = 'ACTIVE'), 0) AS projected_interest
        FROM public.ticket
        WHERE pawnshop_id = p.id
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('name', category, 'count', cnt) ORDER BY cnt DESC) AS inventory_summary
        FROM (
          SELECT COALESCE(category, 'Other') AS category, COUNT(*) AS cnt
          FROM public.ticket
          WHERE pawnshop_id = p.id AND status = 'ACTIVE'
          GROUP BY COALESCE(category, 'Other')
        ) cat
      ) inv ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS client_count
        FROM public.customer
        WHERE pawnshop_id = p.id
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS staff_count
        FROM public.profiles
        WHERE pawnshop_id = p.id
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0) AS total_earnings
        FROM public.transaction
        WHERE ticketid IN (SELECT id FROM public.ticket WHERE pawnshop_id = p.id)
      ) e ON true
      WHERE p.id = ${pawnshopId}::uuid
    `;

    if (!rows.length) {
      throw new Error(`Pawnshop ${pawnshopId} not found`);
    }

    const row = rows[0];
    const rawInventory = row.inventory_summary;
    const inventorySummary: Array<{ name: string; count: number }> =
      Array.isArray(rawInventory)
        ? (rawInventory as Array<{ name: string; count: number }>)
        : typeof rawInventory === 'string' && rawInventory
          ? JSON.parse(rawInventory)
          : [];

    const activeTicketsCount = Number(row.active_tickets) || 0;
    const inventoryCount = inventorySummary.reduce(
      (sum, item) => sum + (Number(item.count) || 0),
      0,
    );

    return {
      pawnshopId,
      name: String(row.name || ''),
      totalPrincipal: Number(row.total_principal) || 0,
      projectedInterest: Number(row.projected_interest) || 0,
      clientCount: Number(row.client_count) || 0,
      inventorySummary,
      staffOnDuty: Number(row.staff_on_duty) || 0,
      activeTickets: activeTicketsCount,
      vaultCapacity:
        inventoryCount === 0
          ? 0
          : Math.min(100, Math.round((inventoryCount / 200) * 100)),
      totalEarnings: Number(row.total_earnings) || 0,
    };
  }
}
