import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LegalProofService } from './legal-proof.service';
import { LoanContractService } from './loan-contract.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { CreatePawnTicketDto } from './dto/create-pawn-ticket.dto';

@Injectable()
export class PawnTicketService {
  constructor(
    private prisma: PrismaService,
    private legalProofService: LegalProofService,
    private loanContractService: LoanContractService,
    private stateMachine: StateMachineService,
  ) {}

  async createTicket(dto: CreatePawnTicketDto, createdBy: string) {
    let customerId: string;

    try {
      customerId = await this.resolveCustomerId(dto, createdBy);
    } catch (err: any) {
      throw new Error(`resolveCustomerId failed: ${err.message}`);
    }

    const ticketNumber = `TKT-${Math.floor(Date.now() / 1000)}`;
    const expiryDate = new Date(dto.appraisalDeadline);

    if (isNaN(expiryDate.getTime())) {
      throw new Error(`Invalid appraisalDeadline date: ${dto.appraisalDeadline}`);
    }

    const descriptionWithPhotos = dto.photoUrls?.length
      ? `${dto.itemDescription}\n\n[PHOTO_URLS] ${JSON.stringify(dto.photoUrls)}`
      : dto.itemDescription;

    const isHighRisk = (dto.riskScore ?? 0) > 40;

    let ticket: any;
    try {
      ticket = await this.prisma.ticket.create({
        data: {
          ticketNumber,
          customerId,
          pawnshopId: dto.pawnshopId,
          branchId: dto.branchId ?? null,
          category: dto.itemCategory,
          description: descriptionWithPhotos,
          weight: dto.weight,
          loanAmount: dto.loanAmount,
          expiryDate,
          status: 'PENDING',
          lifecycleStatus: 'RECEIVED',
          isHighRisk,
          interestRate: 3.5,
        },
      });
    } catch (err: any) {
      throw new Error(
        `prisma.ticket.create failed: ${err.message} (code: ${err.code || 'N/A'}). ` +
        `ticketNumber=${ticketNumber}, customerId=${customerId}, pawnshopId=${dto.pawnshopId}`,
      );
    }

    try {
      await this.legalProofService.createProof({
        pawnshopId: dto.pawnshopId,
        recordType: 'APPLICATION_SUBMITTED',
        title: `Pawn ticket created: ${ticketNumber}`,
        summary: `Ticket ${ticketNumber} for ₱${dto.loanAmount.toFixed(2)} — ${dto.itemCategory}`,
        createdBy,
        ticketId: ticket.id,
        payload: {
          ticketId: ticket.id,
          ticketNumber,
          customerId,
          itemCategory: dto.itemCategory,
          weight: dto.weight,
          loanAmount: dto.loanAmount,
          riskScore: dto.riskScore,
          pawnshopId: dto.pawnshopId,
        },
      });
    } catch (err: any) {
      throw new Error(
        `legalProofService.createProof failed: ${err.message} (code: ${err.code || 'N/A'})`,
      );
    }

    return {
      id: ticket.id,
      ticketNumber,
      customerId,
      status: 'PENDING',
      lifecycleStatus: 'RECEIVED',
    };
  }

  async submitForApproval(ticketId: number, userId: string, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true, pawnshop: { include: { legalEntity: true } } },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.lifecycleStatus !== 'RECEIVED') {
      throw new BadRequestException(
        `Cannot submit ticket in status: ${ticket.lifecycleStatus}. Must be RECEIVED.`,
      );
    }

    const isOwner = userRole === 'OWNER';

    if (isOwner) {
      await this.stateMachine.transition(
        'TICKET_LIFECYCLE',
        ticket.lifecycleStatus,
        'OFFER_MADE',
        { userRole },
      );

      const loanApp = await this.prisma.loanApplication.create({
        data: {
          customerId: ticket.customerId,
          pawnshopId: this.assertPawnshopId(ticket),
          loanAmount: ticket.loanAmount,
          loanType: 'PAWN',
          termMonths: 1,
          purpose: ticket.description || ticket.category,
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });

      const loan = await this.prisma.loan.create({
        data: {
          ticketId: ticket.id,
          applicationId: loanApp.id,
          pawnshopId: this.assertPawnshopId(ticket),
          customerName: ticket.customer?.fullName || 'Customer',
          principalAmount: ticket.loanAmount,
          interestAmount: Math.round(ticket.loanAmount * 0.035),
          category: ticket.category,
          weight: ticket.weight,
          status: 'RECEIVED',
        },
      });

      const contract = await this.loanContractService.generateContractForApplication(
        loanApp.id,
        userId,
      );

      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { lifecycleStatus: 'OFFER_MADE', contractId: contract.id },
      });

      await this.legalProofService.createProof({
        pawnshopId: this.assertPawnshopId(ticket),
        recordType: 'CONTRACT_PROOF',
        title: `Owner auto-approved ticket with contract — ${ticket.ticketNumber}`,
        summary: `Owner auto-approved ticket ${ticket.ticketNumber}. Contract ${contract.contractNumber} generated for ₱${ticket.loanAmount.toFixed(2)}.`,
        createdBy: userId,
        ticketId: ticket.id,
        loanId: loan.id,
        applicationId: loanApp.id,
        contractId: contract.id,
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          lifecycleStatus: 'OFFER_MADE',
          approvedBy: userId,
          autoApproved: true,
        },
      });

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        lifecycleStatus: 'OFFER_MADE',
        applicationId: loanApp.id,
        loanId: loan.id,
        contractId: contract.id,
      };
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'PENDING_APPROVAL',
      { userRole },
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { lifecycleStatus: 'PENDING_APPROVAL' },
    });

    await this.legalProofService.createProof({
      pawnshopId: this.assertPawnshopId(ticket),
      recordType: 'APPLICATION_SUBMITTED',
      title: `Ticket submitted for approval: ${ticket.ticketNumber}`,
      summary: `Ticket ${ticket.ticketNumber} moved to PENDING_APPROVAL for manager review.`,
      createdBy: userId,
      ticketId: ticket.id,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        lifecycleStatus: 'PENDING_APPROVAL',
        submittedBy: userId,
      },
    });

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      lifecycleStatus: 'PENDING_APPROVAL',
    };
  }

  async getPendingApprovalTickets(pawnshopId: string, branchId?: number) {
    const where: any = {
      pawnshopId,
      lifecycleStatus: 'PENDING_APPROVAL',
    };
    if (branchId) where.branchId = branchId;

    return this.prisma.ticket.findMany({
      where,
      include: {
        customer: {
          select: { id: true, fullName: true, contactNumber: true, address: true },
        },
      },
      orderBy: { pawnDate: 'desc' },
    });
  }

  async declineTicket(ticketId: number, userId: string, reason: string, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.lifecycleStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot decline ticket in status: ${ticket.lifecycleStatus}. Must be PENDING_APPROVAL.`,
      );
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'CANCELLED',
      { userRole },
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'CANCELLED',
        status: 'CANCELLED',
        description: ticket.description
          ? `${ticket.description}\n\n[DECLINED] ${reason}`
          : `[DECLINED] ${reason}`,
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: this.assertPawnshopId(ticket),
      recordType: 'APPLICATION_SUBMITTED',
      title: `Ticket declined: ${ticket.ticketNumber}`,
      summary: `Ticket ${ticket.ticketNumber} was declined. Reason: ${reason}`,
      createdBy: userId,
      ticketId: ticket.id,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        lifecycleStatus: 'CANCELLED',
        declinedBy: userId,
        reason,
      },
    });

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      lifecycleStatus: 'CANCELLED',
      status: 'CANCELLED',
    };
  }

  async approveWithContract(ticketId: number, approvedBy: string, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true, pawnshop: { include: { legalEntity: true } } },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.lifecycleStatus !== 'APPRAISED' && ticket.lifecycleStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot approve ticket in status: ${ticket.lifecycleStatus}. Must be APPRAISED or PENDING_APPROVAL.`,
      );
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'OFFER_MADE',
      { userRole },
    );

    const loanApp = await this.prisma.loanApplication.create({
      data: {
        customerId: ticket.customerId,
        pawnshopId: this.assertPawnshopId(ticket),
        loanAmount: ticket.loanAmount,
        loanType: 'PAWN',
        termMonths: 1,
        purpose: ticket.description || ticket.category,
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
      },
    });

    const loan = await this.prisma.loan.create({
      data: {
        ticketId: ticket.id,
        applicationId: loanApp.id,
        pawnshopId: this.assertPawnshopId(ticket),
        customerName: ticket.customer?.fullName || 'Customer',
        principalAmount: ticket.loanAmount,
        interestAmount: Math.round(ticket.loanAmount * 0.035),
        category: ticket.category,
        weight: ticket.weight,
        status: 'RECEIVED',
      },
    });

    const contract = await this.loanContractService.generateContractForApplication(
      loanApp.id,
      approvedBy,
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'OFFER_MADE',
        contractId: contract.id,
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: this.assertPawnshopId(ticket),
      recordType: 'CONTRACT_PROOF',
      title: `Ticket approved with contract — ${ticket.ticketNumber}`,
      summary: `Ticket ${ticket.ticketNumber} approved. Contract ${contract.contractNumber} generated for ₱${ticket.loanAmount.toFixed(2)}.`,
      createdBy: approvedBy,
      ticketId: ticket.id,
      loanId: loan.id,
      applicationId: loanApp.id,
      contractId: contract.id,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        applicationId: loanApp.id,
        loanId: loan.id,
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        loanAmount: ticket.loanAmount,
        approvedBy,
        lifecycleStatus: 'OFFER_MADE',
      },
    });

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      applicationId: loanApp.id,
      loanId: loan.id,
      contractId: contract.id,
      contract,
      lifecycleStatus: 'OFFER_MADE',
    };
  }

  private async resolveCustomerId(dto: CreatePawnTicketDto, createdBy: string): Promise<string> {
    if (dto.accountEmail) {
      const profile = await this.prisma.profile.findFirst({
        where: { email: dto.accountEmail.toLowerCase(), role: 'BIDDER' },
        select: { id: true },
      });

      if (profile) {
        const existing = await this.prisma.customer.findUnique({
          where: { id: profile.id },
          select: { id: true },
        });

        if (existing) {
          await this.prisma.customer.update({
            where: { id: profile.id },
            data: {
              fullName: dto.customerName,
              contactNumber: dto.customerContact,
              address: dto.customerAddress,
              pawnshopId: dto.pawnshopId,
            },
          });
          return profile.id;
        }

        const created = await this.prisma.customer.create({
          data: {
            id: profile.id,
            fullName: dto.customerName,
            contactNumber: dto.customerContact,
            address: dto.customerAddress,
            pawnshopId: dto.pawnshopId,
          },
        });
        return created.id;
      }
    }

    const existing = await this.prisma.customer.findFirst({
      where: { fullName: dto.customerName, pawnshopId: dto.pawnshopId },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.customer.update({
        where: { id: existing.id },
        data: {
          address: dto.customerAddress,
          contactNumber: dto.customerContact,
        },
      });
      return existing.id;
    }

    const customer = await this.prisma.customer.create({
      data: {
        id: randomUUID(),
        fullName: dto.customerName,
        contactNumber: dto.customerContact,
        address: dto.customerAddress,
        pawnshopId: dto.pawnshopId,
      },
    });
    return customer.id;
  }

  private assertPawnshopId(ticket: { pawnshopId?: string | null }): string {
    if (!ticket.pawnshopId) {
      throw new BadRequestException('Ticket is not associated with any pawnshop');
    }
    return ticket.pawnshopId;
  }
}
