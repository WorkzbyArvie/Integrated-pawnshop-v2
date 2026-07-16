import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import { CreateLedgerEntryDto } from './dto/create-ledger-entry.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { AuthUserService } from '../common/auth-user.service';
import { PrismaService } from '../prisma.service';

@Controller('finance')
export class FinanceController {
  private readonly logger = new Logger(FinanceController.name);

  constructor(
    private readonly financeService: FinanceService,
    private readonly authUserService: AuthUserService,
    private readonly prisma: PrismaService,
  ) {}

  private normalizeRole(role?: string | null): string {
    return (role || '').toUpperCase();
  }

  private async assertTenantAccess(
    authHeader: string | undefined,
    pawnshopId: string,
    action: string,
  ): Promise<string> {
    if (!pawnshopId) {
      throw new BadRequestException('pawnshop-id header is required');
    }

    const actorUserId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: {
        role: true,
        pawnshopId: true,
      },
    });

    if (!profile) {
      throw new ForbiddenException('Profile not found for authenticated user');
    }

    const role = this.normalizeRole(profile.role);
    if (role === 'SUPER_ADMIN') {
      const grants = await this.prisma.$queryRaw<
        Array<{ id: string; expires_at: Date }>
      >`
        SELECT id, expires_at
        FROM public.support_access_grants
        WHERE pawnshop_id = ${pawnshopId}::uuid
          AND granted_to = ${actorUserId}::uuid
          AND status = 'ACTIVE'
          AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1
      `;

      const grant = grants[0];
      if (!grant) {
        throw new ForbiddenException(
          'No active approved support-access grant for this pawnshop.',
        );
      }

      await this.prisma.$executeRaw`
        INSERT INTO public.tenant_audit_logs
        (pawnshop_id, actor_user_id, action, metadata)
        VALUES (
          ${pawnshopId}::uuid,
          ${actorUserId}::uuid,
          'SUPPORT_ACCESS_USED',
          ${JSON.stringify({
            grantId: grant.id,
            requestedAction: action,
            expiresAt: grant.expires_at,
          })}::jsonb
        )
      `;

      return actorUserId;
    }

    if (!profile.pawnshopId || profile.pawnshopId !== pawnshopId) {
      throw new ForbiddenException(
        'You can only access finance data for your own pawnshop.',
      );
    }

    return actorUserId;
  }

  /**
   * Create a ledger entry (immutable)
   * POST /finance/ledger
   */
  @Post('ledger')
  @HttpCode(HttpStatus.CREATED)
  async createEntry(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: CreateLedgerEntryDto,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_CREATE_ENTRY');
    return this.financeService.createEntry(pawnshopId, dto);
  }

  /**
   * Submit ledger entry for approval queue
   * POST /finance/ledger/requests
   */
  @Post('ledger/requests')
  @HttpCode(HttpStatus.CREATED)
  async createEntryRequest(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: CreateLedgerEntryDto,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_CREATE_ENTRY_REQUEST');
    try {
      return await this.financeService.createEntryRequest(pawnshopId, dto);
    } catch (err: any) {
      console.error('❌ [LedgerRequest] Error:', err.message, err.stack, { pawnshopId, dto });
      throw err;
    }
  }

  /**
   * List ledger entry requests
   * GET /finance/ledger/requests
   */
  @Get('ledger/requests')
  async getEntryRequests(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_LIST_ENTRY_REQUESTS');
    return this.financeService.getEntryRequests(pawnshopId, status);
  }

  /**
   * Approve ledger entry request
   * POST /finance/ledger/requests/:id/approve
   */
  @Post('ledger/requests/:id/approve')
  async approveEntryRequest(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { approvalNotes?: string },
  ) {
    const actorUserId = await this.assertTenantAccess(
      authHeader,
      pawnshopId,
      'FINANCE_APPROVE_ENTRY_REQUEST',
    );
    return this.financeService.approveEntryRequest(
      pawnshopId,
      id,
      actorUserId,
      body.approvalNotes,
    );
  }

  /**
   * Reject ledger entry request
   * POST /finance/ledger/requests/:id/reject
   */
  @Post('ledger/requests/:id/reject')
  async rejectEntryRequest(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const actorUserId = await this.assertTenantAccess(
      authHeader,
      pawnshopId,
      'FINANCE_REJECT_ENTRY_REQUEST',
    );
    return this.financeService.rejectEntryRequest(
      pawnshopId,
      id,
      actorUserId,
      body.reason,
    );
  }

  /**
   * Get ledger entries
   * GET /finance/ledger
   */
  @Get('ledger')
  async findAll(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query() query: LedgerQueryDto,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_LIST_LEDGER');
    return this.financeService.findAll(pawnshopId, query);
  }

  /**
   * Get a specific ledger entry
   * GET /finance/ledger/:id
   */
  @Get('ledger/:id')
  async findOne(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_GET_LEDGER_ENTRY');
    return this.financeService.findOne(pawnshopId, id);
  }

  /**
   * Get current balance
   * GET /finance/balance
   */
  @Get('balance')
  async getCurrentBalance(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('branchId') branchId?: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_GET_BALANCE');
    const balance = await this.financeService.getCurrentBalance(
      pawnshopId,
      branchId,
    );
    return { balance };
  }

  /**
   * Get financial summary
   * GET /finance/summary
   */
  @Get('summary')
  async getSummary(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('branchId') branchId?: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_GET_SUMMARY');
    return this.financeService.getSummary(
      pawnshopId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
      branchId,
    );
  }

  /**
   * Create daily reconciliation
   * POST /finance/reconciliation
   */
  @Post('reconciliation')
  @HttpCode(HttpStatus.CREATED)
  async createReconciliation(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() body: { branchId?: number; physicalCash?: number },
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_CREATE_RECONCILIATION');
    return this.financeService.createDailyReconciliation(
      pawnshopId,
      body.branchId ?? null,
      body.physicalCash,
    );
  }

  /**
   * Complete reconciliation
   * POST /finance/reconciliation/:id/complete
   */
  @Post('reconciliation/:id/complete')
  async completeReconciliation(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    const actorUserId = await this.assertTenantAccess(
      authHeader,
      pawnshopId,
      'FINANCE_COMPLETE_RECONCILIATION',
    );
    return this.financeService.completeReconciliation(
      pawnshopId,
      id,
      actorUserId,
      body.notes,
    );
  }

  /**
   * Treasury dashboard — aggregated view of balance, cash-flow, payroll, attendance
   * GET /finance/treasury-dashboard
   */
  @Get('treasury-dashboard')
  async getTreasuryDashboard(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('branchId') branchId?: string,
  ) {
    await this.assertTenantAccess(authHeader, pawnshopId, 'FINANCE_GET_TREASURY_DASHBOARD');
    return this.financeService.getTreasuryDashboard(
      pawnshopId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
      branchId,
    );
  }

  /**
   * Backfill ledger entries for historically redeemed tickets
   * POST /finance/backfill-redeemed
   */
  @Post('backfill-redeemed')
  @HttpCode(HttpStatus.OK)
  async backfillRedeemed(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const actorUserId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const profile = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });

    if (!profile || this.normalizeRole(profile.role) !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can run this operation');
    }

    return this.financeService.backfillRedeemedTickets();
  }
}
