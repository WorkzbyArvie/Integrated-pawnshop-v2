import { Controller, Post, Get, Param, Body, Req, Query, HttpCode, HttpStatus, Logger, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import { PawnTicketService } from './pawn-ticket.service';
import { CreatePawnTicketDto } from './dto/create-pawn-ticket.dto';
import { AppraiseTicketDto } from './dto/appraise-ticket.dto';
import { RedeemTicketDto } from './dto/redeem-ticket.dto';
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
    const user = (req as any).user as { pawnshopId?: string } | undefined;
    return this.pawnTicketService.getPendingApprovalTickets(
      pawnshopId || user?.pawnshopId || '',
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
