import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('stats')
  getStats() {
    return this.analyticsService.getDashboardStats();
  }

  // Branch-scoped stats endpoint (server-side - uses service role credentials)
  @Get('branch/:pawnshopId')
  async getBranchStats(@Param('pawnshopId') pawnshopId: string) {
    return this.analyticsService.getBranchStats(pawnshopId);
  }

  @Get('branch-stats/batch')
  async getBatchBranchStats(@Query('ids') ids: string) {
    const pawnshopIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
    return this.analyticsService.getBatchBranchStats(pawnshopIds);
  }
}
