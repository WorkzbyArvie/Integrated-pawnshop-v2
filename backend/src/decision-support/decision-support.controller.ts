import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { DecisionSupportService } from './decision-support.service';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';

interface Actor {
  pawnshopId: string | null;
  role?: string;
}

/**
 * Tenant-scoped exactly like the analytics reads: the shop comes from the
 * authenticated principal, never from the request. A `branchId` narrows within
 * the caller's own shop and can never reach another one.
 */
@Controller('decision-support')
export class DecisionSupportController {
  constructor(private readonly decisionSupport: DecisionSupportService) {}

  /** Refuses an account with no tenant rather than reporting on the whole
   *  platform, which is the same fail-closed rule the analytics reads use. */
  private tenantOf(actor: Actor): string {
    if (!actor?.pawnshopId) {
      throw new ForbiddenException('This account is not attached to a shop');
    }
    return actor.pawnshopId;
  }

  @Get('report')
  @RequiresPermission(PERMISSIONS['reports.view'])
  getReport(@Req() req: { user: Actor }, @Query('branchId') branchId?: string) {
    const parsed = branchId ? Number(branchId) : NaN;
    return this.decisionSupport.buildReport(
      this.tenantOf(req.user),
      Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    );
  }

  /**
   * The wait estimate for one waiting ticket. Returns a `null` value with a
   * `basis` rather than a guessed number when the shop has no history yet.
   */
  @Get('wait/:ticketId')
  @RequiresPermission(PERMISSIONS['reports.view'])
  getWait(@Req() req: { user: Actor }, @Param('ticketId') ticketId: string) {
    return this.decisionSupport.predictWait(this.tenantOf(req.user), ticketId);
  }
}
