import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** Identity attached to the request by `RbacGuard`. */
export interface AnalyticsActor {
  id: string;
  role: string;
  pawnshopId: string | null;
}

const SUPER_ADMIN = 'SUPER_ADMIN';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Resolves which tenant a read may touch.
   *
   * A shop account is pinned to its own tenant and a request naming any other
   * tenant is refused. `SUPER_ADMIN` is the platform operator and legitimately
   * reads across tenants, so it may name one explicitly or fall back to its own
   * scope. An account with no tenant at all can read nothing - failing closed
   * rather than returning a platform-wide total to an unscoped identity.
   */
  private resolveTenant(actor: AnalyticsActor, requested?: string | null): string {
    const isPlatform = actor?.role === SUPER_ADMIN;

    if (isPlatform) {
      const target = requested ?? actor?.pawnshopId;
      if (target) return target;
      throw new ForbiddenException(
        'A tenant must be identified to read analytics',
      );
    }

    if (!actor?.pawnshopId) {
      throw new ForbiddenException('This account is not attached to a shop');
    }

    if (requested && requested !== actor.pawnshopId) {
      throw new ForbiddenException('Cannot read analytics for another shop');
    }

    return actor.pawnshopId;
  }

  /**
   * Filters a requested tenant list down to what the caller may see. Without
   * this the batch endpoint leaked stats for any ids the caller guessed.
   */
  private filterTenants(actor: AnalyticsActor, requested: string[]): string[] {
    if (actor?.role === SUPER_ADMIN) {
      return requested.length ? requested : actor?.pawnshopId ? [actor.pawnshopId] : [];
    }
    if (!actor?.pawnshopId) return [];
    return requested.length
      ? requested.filter((id) => id === actor.pawnshopId)
      : [actor.pawnshopId];
  }

  async getBatchBranchStats(actor: AnalyticsActor, requested: string[]) {
    const pawnshopIds = this.filterTenants(actor, requested ?? []);
    if (!pawnshopIds.length) return [];

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        p.id AS pawnshop_id,
        p.name,
        COALESCE(t.active_count, 0) AS active_tickets,
        COALESCE(t.total_principal, 0) AS total_principal,
        COALESCE(t.projected_interest, 0) AS projected_interest,
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
        SELECT COALESCE(SUM(pay.amount), 0) AS total_earnings
        FROM public.payments pay
        JOIN public.customer c2 ON c2.id = pay.customer_id
        WHERE c2.pawnshop_id = p.id AND pay.status = 'COMPLETED'
      ) e ON true
      WHERE p.id = ANY(${pawnshopIds}::uuid[])
    `;

    return rows.map((r: any) => ({
      pawnshopId: r.pawnshop_id,
      name: r.name,
      activeTickets: Number(r.active_tickets),
      totalPrincipal: Number(r.total_principal),
      projectedInterest: Number(r.projected_interest),
      clientCount: Number(r.client_count),
      staffOnDuty: Number(r.staff_count),
      vaultCapacity: Math.min(100, Math.round((Number(r.active_tickets) / 200) * 100)),
      // Real figure, summed from completed payments. Previously hardcoded to 0
      // because it read `public.transaction`, a legacy table no service writes.
      totalEarnings: Number(r.total_earnings) || 0,
    }));
  }

  async getDashboardStats(actor: AnalyticsActor) {
    const pawnshopId = this.resolveTenant(actor);

    // Scoped to the caller's shop. These counts previously had no `where`
    // clause, so they aggregated every tenant in the database.
    const [totalCustomers, activeTickets, loanSum, projected] = await Promise.all([
      this.prisma.customer.count({ where: { pawnshopId } }),
      this.prisma.ticket.count({ where: { pawnshopId, status: 'ACTIVE' } }),
      this.prisma.ticket.aggregate({
        _sum: { loanAmount: true },
        where: { pawnshopId, status: 'ACTIVE' },
      }),
      this.prisma.ticket.aggregate({
        _sum: { interestRate: true },
        where: { pawnshopId, status: 'ACTIVE' },
      }),
    ]);

    const totalLoansValue = Number(loanSum._sum.loanAmount) || 0;
    const principal = Number(loanSum._sum.loanAmount) || 0;
    const rateSum = Number(projected._sum.interestRate) || 0;

    return {
      pawnshopId,
      totalLoans: totalLoansValue,
      totalCustomers,
      activeTickets,
      /**
       * Projected monthly interest across active tickets, derived from the
       * tickets' own stored rate. This replaces `interestEarned`, which was
       * `totalLoansValue * 0.05` - a hardcoded 5% that matched no rate
       * configured anywhere in the system and had no consumer.
       */
      projectedInterest: (principal * rateSum) / 100 || 0,
    };
  }

  // Branch-scoped dashboard data (uses service role on the server)
  async getBranchStats(actor: AnalyticsActor, requestedPawnshopId?: string) {
    const pawnshopId = this.resolveTenant(actor, requestedPawnshopId);

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
        SELECT COALESCE(SUM(pay.amount), 0) AS total_earnings
        FROM public.payments pay
        JOIN public.customer c2 ON c2.id = pay.customer_id
        WHERE c2.pawnshop_id = p.id AND pay.status = 'COMPLETED'
      ) e ON true
      WHERE p.id = ${pawnshopId}::uuid
    `;

    if (!rows.length) {
      throw new NotFoundException(`Pawnshop ${pawnshopId} not found`);
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
