import { Controller, Post, Get, Param, Body, Req, Query, HttpCode, HttpStatus, Logger, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import { PawnTicketService } from './pawn-ticket.service';
import { CreatePawnTicketDto } from './dto/create-pawn-ticket.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller()
export class PawnTicketController {
  private readonly logger = new Logger(PawnTicketController.name);

  constructor(private readonly pawnTicketService: PawnTicketService) {}

  @AuditLog('CREATE_PAWN_TICKET')
  @Post('pawn-tickets')
  @HttpCode(HttpStatus.CREATED)
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

  @Roles('OWNER', 'MANAGER')
  @AuditLog('MANAGER_APPROVE_TICKET')
  @Post('pawn-tickets/:id/manager-approve')
  @HttpCode(HttpStatus.OK)
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

  @Roles('OWNER', 'MANAGER')
  @AuditLog('MANAGER_DECLINE_TICKET')
  @Post('pawn-tickets/:id/decline')
  @HttpCode(HttpStatus.OK)
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

  @Roles('OWNER', 'MANAGER')
  @Get('pawn-tickets/pending-approval')
  @HttpCode(HttpStatus.OK)
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
}
