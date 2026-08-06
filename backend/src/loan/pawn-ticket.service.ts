import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LegalProofService } from './legal-proof.service';
import { LoanContractService } from './loan-contract.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { CreatePawnTicketDto } from './dto/create-pawn-ticket.dto';
import { AppraiseTicketDto } from './dto/appraise-ticket.dto';
import { RedeemTicketDto } from './dto/redeem-ticket.dto';
import { ReceiptService } from '../receipt/receipt.service';
import { FinanceService } from '../finance/finance.service';
import { NotificationService } from '../notification/notification.service';
import { LedgerEntryType, LedgerCategory, NotificationChannel, NotificationType, PaymentMethod, Prisma } from '@prisma/client';

@Injectable()
export class PawnTicketService {
  private readonly logger = new Logger(PawnTicketService.name);

  constructor(
    private prisma: PrismaService,
    private legalProofService: LegalProofService,
    private loanContractService: LoanContractService,
    private stateMachine: StateMachineService,
    private receiptService: ReceiptService,
    private financeService: FinanceService,
    private notificationService: NotificationService,
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

    if (customerId) {
      try {
        await this.notificationService.sendNotification({
          recipientId: customerId,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.PAYMENT_DUE,
          title: 'Pawn Ticket Created',
          body: `Your pawn ticket ${ticketNumber} has been created for ₱${dto.loanAmount.toFixed(2)}. Awaiting appraisal.`,
          data: {
            ticketId: ticket.id,
            ticketNumber,
            loanAmount: dto.loanAmount,
          },
        });
      } catch (notifErr) {
        console.error('Failed to send ticket creation notification:', notifErr);
      }
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
      lifecycleStatus: { in: ['PENDING_APPROVAL', 'CONTRACT_SIGNED'] },
    };
    if (branchId) where.branchId = branchId;

    return this.prisma.ticket.findMany({
      where,
      include: {
        customer: {
          select: { id: true, fullName: true, contactNumber: true, address: true, loyaltyTier: true },
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

    if (ticket.customerId) {
      try {
        await this.notificationService.sendNotification({
          recipientId: ticket.customerId,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.PAYMENT_DUE,
          title: 'Loan Offer Ready',
          body: `Your pawn ticket ${ticket.ticketNumber} has been approved. A loan contract for ₱${ticket.loanAmount.toFixed(2)} is ready for signing.`,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            contractId: contract.id,
            loanAmount: ticket.loanAmount,
          },
        });
      } catch (notifErr) {
        console.error('Failed to send approval notification:', notifErr);
      }
    }

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

  async appraiseTicket(ticketId: number, dto: AppraiseTicketDto, appraisedBy: string, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.lifecycleStatus !== 'RECEIVED') {
      throw new BadRequestException(
        `Cannot appraise ticket in status: ${ticket.lifecycleStatus}. Must be RECEIVED.`,
      );
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'PENDING_APPROVAL',
      { userRole },
    );

    const updatedTicket = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'PENDING_APPROVAL',
        isHighRisk: (dto.riskScore ?? 0) > 40,
        updatedAt: new Date(),
      },
    });

    await this.prisma.approvalRecord.create({
      data: {
        pawnshopId: this.assertPawnshopId(ticket),
        targetType: 'APPRAISAL',
        targetId: String(ticket.id),
        status: 'PENDING',
        amount: dto.appraisedValue,
        requestedById: appraisedBy,
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          appraisedValue: dto.appraisedValue,
          riskScore: dto.riskScore ?? 0,
          recommendedLoanAmount: dto.recommendedLoanAmount,
          itemCondition: dto.itemCondition,
          appraisalNotes: dto.appraisalNotes,
        } as Prisma.InputJsonValue,
      },
    });

    await this.legalProofService.createProof({
      pawnshopId: this.assertPawnshopId(ticket),
      recordType: 'APPLICATION_SUBMITTED',
      title: `Item appraised: ${ticket.ticketNumber}`,
      summary: `Ticket ${ticket.ticketNumber} appraised at ₱${dto.appraisedValue.toFixed(2)}. Awaiting approval before a loan offer is made.`,
      createdBy: appraisedBy,
      ticketId: ticket.id,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        appraisedValue: dto.appraisedValue,
        riskScore: dto.riskScore,
        recommendedLoanAmount: dto.recommendedLoanAmount,
        itemCondition: dto.itemCondition,
        appraisalNotes: dto.appraisalNotes,
        appraisedBy,
        previousLoanAmount: ticket.loanAmount,
      },
    });

    try {
      await this.receiptService.generateReceipt({
        pawnshopId: this.assertPawnshopId(ticket),
        receiptType: 'APPRAISAL_CERTIFICATE' as any,
        referenceType: 'TICKET',
        referenceId: String(ticket.id),
        amount: dto.appraisedValue,
        customerName: ticket.customer?.fullName || 'Customer',
        lineItems: [
          { description: `Appraised Value — ${ticket.category}`, amount: dto.appraisedValue },
          { description: `Recommended Loan Amount`, amount: dto.recommendedLoanAmount || ticket.loanAmount },
        ],
        generatedBy: appraisedBy,
      });
    } catch (receiptErr) {
      console.error('Failed to generate appraisal certificate receipt:', receiptErr);
    }

    return {
      id: updatedTicket.id,
      ticketNumber: updatedTicket.ticketNumber,
      lifecycleStatus: 'PENDING_APPROVAL',
      appraisedValue: dto.appraisedValue,
      recommendedLoanAmount: dto.recommendedLoanAmount,
    };
  }

  async redeemTicket(ticketId: number, dto: RedeemTicketDto, processedBy: string, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        customer: true,
        loans: true,
        pawnshop: { select: { settings: true } },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    const redeemableStates = ['ACTIVE', 'GRACE_PERIOD'];
    if (!redeemableStates.includes(ticket.lifecycleStatus)) {
      throw new BadRequestException(
        `Cannot redeem ticket in status: ${ticket.lifecycleStatus}. Must be ACTIVE or GRACE_PERIOD.`,
      );
    }

    const loan = ticket.loans?.[0];
    if (!loan) throw new BadRequestException('No loan found for this ticket');

    const pawnshopId = this.assertPawnshopId(ticket);

    const settings = (ticket.pawnshop?.settings as Record<string, unknown> | null) ?? {};
    const approvalThreshold = Number(settings.redemptionApprovalThreshold ?? 50000);
    if (dto.amountPaid > approvalThreshold) {
      const approvalRecord = await this.prisma.approvalRecord.create({
        data: {
          pawnshopId,
          targetType: 'REDEMPTION',
          targetId: String(ticket.id),
          status: 'PENDING',
          amount: dto.amountPaid,
          requestedById: processedBy,
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            loanId: loan.id,
            amountPaid: dto.amountPaid,
            paymentMethod: dto.paymentMethod || 'CASH',
            referenceNumber: dto.referenceNumber,
            notes: dto.notes,
            processedBy,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        lifecycleStatus: 'PENDING_APPROVAL',
        requiresApproval: true,
        approvalId: approvalRecord.id,
        approvalStatus: 'PENDING',
        message: 'Approval required for high-value redemption',
      };
    }

    return this.performRedemptionRelease(ticket, loan, dto, processedBy, userRole);
  }

  private async performRedemptionRelease(
    ticket: any,
    loan: any,
    dto: RedeemTicketDto,
    processedBy: string,
    userRole?: string,
  ) {
    const pawnshopId = this.assertPawnshopId(ticket);

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'REDEEMED',
      { userRole },
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'REDEEMED',
        status: 'REDEEMED',
        updatedAt: new Date(),
      },
    });

    await this.prisma.loan.update({
      where: { id: loan.id },
      data: { status: 'REDEEMED' },
    });

    const payment = await this.prisma.payment.create({
      data: {
        customerId: ticket.customerId,
        loanId: loan.id,
        amount: dto.amountPaid,
        paymentMethod: (dto.paymentMethod || 'CASH') as PaymentMethod,
        paymentType: 'LOAN_REPAYMENT',
        referenceNumber: dto.referenceNumber,
        status: 'COMPLETED',
        processedBy,
        notes: dto.notes || `In-person redemption for ticket #${ticket.ticketNumber}`,
      },
    });

    try {
      const ledgerEntry = await this.financeService.createEntry(pawnshopId, {
        entryType: LedgerEntryType.CREDIT,
        category: LedgerCategory.LOAN_REPAYMENT,
        amount: dto.amountPaid,
        description: `Redemption payment from ${ticket.customer?.fullName || 'customer'} (Ticket #${ticket.ticketNumber})`,
        performedBy: processedBy,
        referenceType: 'PAYMENT',
        referenceId: payment.id,
        counterparty: ticket.customer?.fullName || undefined,
        paymentMethod: dto.paymentMethod || 'CASH',
      });

      await this.legalProofService.createProof({
        pawnshopId,
        recordType: 'REDEMPTION_PROOF',
        title: `Ticket redeemed: ${ticket.ticketNumber}`,
        summary: `Ticket ${ticket.ticketNumber} redeemed. Payment of ₱${dto.amountPaid.toFixed(2)} received from ${ticket.customer?.fullName || 'customer'}.`,
        createdBy: processedBy,
        ticketId: ticket.id,
        loanId: loan.id,
        paymentId: payment.id,
        ledgerEntryId: ledgerEntry.id,
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          loanId: loan.id,
          paymentId: payment.id,
          amountPaid: dto.amountPaid,
          paymentMethod: (dto.paymentMethod || 'CASH') as PaymentMethod,
          referenceNumber: dto.referenceNumber,
          processedBy,
          redeemedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('Failed to create ledger entry or proof for redemption:', err);
    }

    try {
      await this.receiptService.generateReceipt({
        pawnshopId,
        receiptType: 'REDEMPTION',
        referenceType: 'TICKET',
        referenceId: String(ticket.id),
        amount: dto.amountPaid,
        customerName: ticket.customer?.fullName || 'Customer',
        lineItems: [
          { description: `Pawn Redemption — Ticket #${ticket.ticketNumber}`, amount: dto.amountPaid },
        ],
        generatedBy: processedBy,
      });
    } catch (receiptErr) {
      console.error('Failed to generate redemption receipt:', receiptErr);
    }

    if (ticket.customerId) {
      try {
        await this.calculateAndUpdateCustomerTier(ticket.customerId);
      } catch (tierErr) {
        console.error('Failed to update customer tier:', tierErr);
      }

      try {
        await this.notificationService.sendNotification({
          recipientId: ticket.customerId,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.PAYMENT_DUE,
          title: 'Item Redeemed Successfully',
          body: `Your pawn ticket ${ticket.ticketNumber} has been redeemed. You can collect your item at the pawnshop.`,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            amountPaid: dto.amountPaid,
          },
        });
      } catch (notifErr) {
        console.error('Failed to send redemption notification:', notifErr);
      }
    }

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      lifecycleStatus: 'REDEEMED',
      amountPaid: dto.amountPaid,
      paymentId: payment.id,
      message: 'Ticket redeemed successfully',
    };
  }

  async applyApprovedAppraisal(
    ticketId: number,
    payload: Record<string, unknown>,
    decidedBy: string,
    userRole?: string,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true, pawnshop: { include: { legalEntity: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.lifecycleStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot approve appraisal in status: ${ticket.lifecycleStatus}. Must be PENDING_APPROVAL.`,
      );
    }

    const recommended = Number(payload.recommendedLoanAmount);
    const appraised = Number(payload.appraisedValue);
    const finalAmount =
      Number.isFinite(recommended) && recommended > 0
        ? recommended
        : Number.isFinite(appraised) && appraised > 0
          ? appraised
          : ticket.loanAmount;

    const updatedTicket = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        loanAmount: finalAmount,
        isHighRisk: (Number(payload.riskScore) || 0) > 40,
        updatedAt: new Date(),
      },
    });

    const offer = await this.approveWithContract(ticketId, decidedBy, userRole);

    return {
      ...offer,
      id: updatedTicket.id,
      ticketNumber: updatedTicket.ticketNumber,
      loanAmount: finalAmount,
    };
  }

  async releaseApprovedRedemption(
    ticketId: number,
    dto: RedeemTicketDto,
    decidedBy: string,
    userRole?: string,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        customer: true,
        loans: true,
        pawnshop: { select: { settings: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const redeemableStates = ['ACTIVE', 'GRACE_PERIOD'];
    if (!redeemableStates.includes(ticket.lifecycleStatus)) {
      throw new BadRequestException(
        `Cannot release redemption for ticket in status: ${ticket.lifecycleStatus}. Must be ACTIVE or GRACE_PERIOD.`,
      );
    }

    const loan = ticket.loans?.[0];
    if (!loan) throw new BadRequestException('No loan found for this ticket');

    return this.performRedemptionRelease(ticket, loan, dto, decidedBy, userRole);
  }

  async rejectAppraisal(ticketId: number, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.lifecycleStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot reject appraisal in status: ${ticket.lifecycleStatus}. Must be PENDING_APPROVAL.`,
      );
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'RECEIVED',
      { userRole },
    );

    const updatedTicket = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'RECEIVED',
        updatedAt: new Date(),
      },
    });

    return {
      id: updatedTicket.id,
      ticketNumber: updatedTicket.ticketNumber,
      lifecycleStatus: 'RECEIVED',
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

  async calculateAndUpdateCustomerTier(customerId: string): Promise<string> {
    const redeemedCount = await this.prisma.ticket.count({
      where: {
        customerId,
        OR: [
          { lifecycleStatus: 'REDEEMED' },
          { status: 'REDEEMED' },
        ],
      },
    });

    let tier = 'Standard';
    if (redeemedCount >= 30) tier = 'VIP';
    else if (redeemedCount >= 15) tier = 'Gold';
    else if (redeemedCount >= 5) tier = 'Silver';
    else if (redeemedCount >= 1) tier = 'Bronze';

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { loyaltyTier: tier },
    });

    return tier;
  }

  async getCustomerTierInfo(customerId: string) {
    const count = await this.prisma.ticket.count({
      where: {
        customerId,
        OR: [{ lifecycleStatus: 'REDEEMED' }, { status: 'REDEEMED' }],
      },
    });
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { loyaltyTier: true },
    });
    const tier = customer?.loyaltyTier || 'Standard';
    return { tier, redeemedCount: count };
  }

  async sendToAuction(ticketId: number, userId: string, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== 'ACTIVE') {
      throw new BadRequestException(`Ticket must be ACTIVE to send to auction. Current status: ${ticket.status}`);
    }

    const pawnshopId = this.assertPawnshopId(ticket);

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'AUCTION', lifecycleStatus: 'FORFEITED' },
    });

    try {
      await this.legalProofService.createProof({
        pawnshopId,
        recordType: 'AUCTION_SETTLEMENT_PROOF',
        title: `Ticket sent to auction: ${ticket.ticketNumber}`,
        summary: `Ticket ${ticket.ticketNumber} (${ticket.category}) sent to auction by ${userId}.`,
        createdBy: userId,
        ticketId: ticket.id,
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          category: ticket.category,
          previousStatus: 'ACTIVE',
          action: 'SEND_TO_AUCTION',
        },
      });
    } catch (proofErr) {
      this.logger.warn(`Failed to create auction proof for ticket ${ticketId}: ${(proofErr as Error).message}`);
    }

    return {
      id: updated.id,
      ticketNumber: updated.ticketNumber,
      status: updated.status,
      lifecycleStatus: updated.lifecycleStatus,
    };
  }

  private assertPawnshopId(ticket: { pawnshopId?: string | null }): string {
    if (!ticket.pawnshopId) {
      throw new BadRequestException('Ticket is not associated with any pawnshop');
    }
    return ticket.pawnshopId;
  }
}
