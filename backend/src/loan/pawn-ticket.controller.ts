import { Controller, Post, Get, Param, Body, Req, Query, HttpCode, HttpStatus, Logger, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { PawnTicketService } from './pawn-ticket.service';
import { CreatePawnTicketDto } from './dto/create-pawn-ticket.dto';
import { AppraiseTicketDto } from './dto/appraise-ticket.dto';
import { RedeemTicketDto } from './dto/redeem-ticket.dto';
import {
  AppraiseItemDto,
  RedemptionQuoteDto,
  QuoteAppraisalDto,
} from './dto/appraise-item.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
import { RequiresCompliance } from '../common/decorators/requires-compliance.decorator';

@Controller()
export class PawnTicketController {
  private readonly logger = new Logger(PawnTicketController.name);

  constructor(private readonly pawnTicketService: PawnTicketService) {}

  @RequiresCompliance(40)
  @AuditLog('CREATE_PAWN_TICKET')
  @Post('pawn-tickets')
  @HttpCode(HttpStatus.CREATED)
  @RequiresPermission(PERMISSIONS['pawn_ticket.create'])
  async createTicket(
    @Body() dto: CreatePawnTicketDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    try {
      return await this.pawnTicketService.createTicket(dto, user?.id ?? 'system');
    } catch (error: any) {
      this.logger.error(`[PawnTicketController] createTicket failed: ${error.message}`, error.stack);
      if (error instanceof TypeError) {
        throw new InternalServerErrorException(`TypeError in createTicket: ${error.message}`);
      }
      if (error?.code === 'P2002' || error?.code === 'P2003' || error?.code?.startsWith('P')) {
        throw new InternalServerErrorException(`Database error (${error.code}): ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Appraise an item and return the figures, without creating anything.
   *
   * Read-only, and the reason the POS screen no longer computes money in the
   * browser. The rates, the LTV ratio, the P.D. 114 Section 10 service-fee cap
   * and the risk factors all live on the server, so the number a customer is
   * shown and the number recorded on the ticket come from one evaluation.
   *
   * `POST /pawn-tickets/appraise-items` rather than `/pawn-tickets/:id/...`
   * because there is no ticket yet - a quotation precedes the pawn.
   */
  @AuditLog('APPRAISE_ITEM')
  @Post('appraisal/quote')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.create'])
  async quoteAppraisal(
    @Body() dto: QuoteAppraisalDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    return this.pawnTicketService.quoteAppraisal(dto, user?.id ?? 'system');
  }

  /**
   * The full cost to settle a pawn: interest, service fee and total, at the
   * rate recorded on the loan.
   *
   * The counterpart to the quote above for a ticket that already exists. The
   * redemption screen previously computed `principal * 0.03` in the browser and
   * sent that figure as `amountPaid`; the shop read a total and the system
   * accepted it, so on a PHP 10,000 pawn the branch absorbed PHP 50 on every
   * redemption with no error recorded anywhere. A ticket is money already owed,
   * so the figure comes from the loan, not from the screen asking for it.
   */
  @AuditLog('QUOTE_REDEMPTION')
  @Post('appraisal/redemption-quote')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.redeem'])
  async quoteRedemption(
    @Body() dto: RedemptionQuoteDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    return this.pawnTicketService.quoteRedemption(dto, user?.id ?? 'system');
  }

  @AuditLog('SUBMIT_FOR_APPROVAL')
  @Post('pawn-tickets/:id/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.submit_approval'])
  submitForApproval(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.submitForApproval(
      parseInt(id, 10),
      user?.id ?? '',
      user?.role,
    );
  }

  @AuditLog('MANAGER_APPROVE_TICKET')
  @Post('pawn-tickets/:id/manager-approve')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.approve'])
  managerApproveTicket(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.approveWithContract(
      parseInt(id, 10),
      user?.id ?? '',
      user?.role,
    );
  }

  @AuditLog('MANAGER_DECLINE_TICKET')
  @Post('pawn-tickets/:id/decline')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.decline'])
  declineTicket(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.declineTicket(
      parseInt(id, 10),
      user?.id ?? '',
      reason || 'No reason provided',
      user?.role,
    );
  }

  @Get('pawn-tickets/pending-approval')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.approve'])
  getPendingApproval(
    @Req() req: Request,
    @Query('pawnshopId') pawnshopId?: string,
    @Query('branchId') branchId?: string,
  ) {
    const user = (req as any).user as { role?: string; pawnshopId?: string } | undefined;
    // The caller's own tenant wins. A query param may only *narrow* the read for
    // the platform operator; it used to take precedence outright, which let any
    // account holding `pawn_ticket.approve` read another shop's pending tickets.
    const isPlatform = user?.role === 'SUPER_ADMIN';
    const callerPawnshopId = user?.pawnshopId ?? '';
    const scopedPawnshopId = isPlatform ? pawnshopId || callerPawnshopId : callerPawnshopId;

    if (!scopedPawnshopId) {
      throw new ForbiddenException('A tenant must be identified to read pending approvals');
    }

    return this.pawnTicketService.getPendingApprovalTickets(
      scopedPawnshopId,
      branchId ? parseInt(branchId, 10) : undefined,
    );
  }

  @AuditLog('APPROVE_PAWN_TICKET')
  @Post('pawn-tickets/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.approve'])
  approveTicket(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.approveWithContract(
      parseInt(id, 10),
      user?.id ?? '',
      user?.role,
    );
  }

  @AuditLog('APPRAISE_TICKET')
  @Post('pawn-tickets/:id/appraise')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.appraise'])
  appraiseTicket(
    @Param('id') id: string,
    @Body() dto: AppraiseTicketDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.appraiseTicket(
      parseInt(id, 10),
      dto,
      user?.id ?? '',
      user?.role,
    );
  }

  @AuditLog('REDEEM_TICKET_IN_PERSON')
  @Post('pawn-tickets/:id/redeem')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.redeem'])
  redeemTicket(
    @Param('id') id: string,
    @Body() dto: RedeemTicketDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.redeemTicket(
      parseInt(id, 10),
      dto,
      user?.id ?? '',
      user?.role,
    );
  }

  @Get('pawn-tickets/customers/:customerId/tier')
  @RequiresPermission(PERMISSIONS['pawn_ticket.view'])
  getCustomerTier(@Param('customerId') customerId: string) {
    return this.pawnTicketService.getCustomerTierInfo(customerId);
  }

  @AuditLog('SEND_TO_AUCTION')
  @Post('pawn-tickets/:id/send-to-auction')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(PERMISSIONS['pawn_ticket.send_to_auction'])
  sendToAuction(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { id: string; role: string } | undefined;
    return this.pawnTicketService.sendToAuction(
      parseInt(id, 10),
      user?.id ?? '',
      user?.role,
    );
  }
}
