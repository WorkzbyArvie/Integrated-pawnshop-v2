import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { AnalyticsService, type AnalyticsActor } from './analytics.service';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';

/**
 * Analytics is tenant-scoped.
 *
 * These handlers previously took no identity at all: `/stats` aggregated every
 * tenant in the database because the queries carried no `where` clause, and
 * `/branch/:pawnshopId` and `/branch-stats/batch` accepted whatever tenant id
 * the caller supplied. Any authenticated profile in any shop could read another
 * shop's customer counts, principal, and projected interest.
 *
 * The tenant is now derived from the authenticated principal that `RbacGuard`
 * attaches to the request, and a request naming a different tenant is refused
 * rather than silently honoured.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('stats')
  @RequiresPermission(PERMISSIONS['reports.view'])
  getStats(@Req() req: { user: AnalyticsActor }) {
    return this.analyticsService.getDashboardStats(req.user);
  }

  @Get('branch/:pawnshopId')
  @RequiresPermission(PERMISSIONS['reports.view'])
  async getBranchStats(
    @Req() req: { user: AnalyticsActor },
    @Param('pawnshopId') pawnshopId: string,
  ) {
    return this.analyticsService.getBranchStats(req.user, pawnshopId);
  }

  @Get('branch-stats/batch')
  @RequiresPermission(PERMISSIONS['reports.view'])
  async getBatchBranchStats(
    @Req() req: { user: AnalyticsActor },
    @Query('ids') ids: string,
  ) {
    const requested = (ids ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return this.analyticsService.getBatchBranchStats(req.user, requested);
  }

  /**
   * Ticket and client aggregates for one shop, for the dashboard and the branch
   * analytics panel.
   *
   * These replace five direct browser reads of `ticket` and `customer` that each
   * filtered by a `pawnshop_id` taken from a URL query parameter or localStorage
   * - both client-controlled, so none of them constrained the read. The
   * aggregates are tenant-scoped here and the client cannot widen them.
   */
  @Get('branch-activity')
  @RequiresPermission(PERMISSIONS['reports.view'])
  getBranchActivity(
    @Req() req: { user: AnalyticsActor },
    @Query('branchId') branchId?: string,
  ) {
    return this.analyticsService.getBranchActivity(req.user, branchId);
  }
}
