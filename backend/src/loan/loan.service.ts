import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import { CreatePaymentDto } from './dto/payment.dto';
import { RenewLoanDto } from './dto/renew-loan.dto';
import { LedgerEntryType, LedgerCategory, NotificationChannel, NotificationType } from '@prisma/client';
import { LegalProofService } from './legal-proof.service';
import { ReceiptService } from '../receipt/receipt.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { NotificationService } from '../notification/notification.service';
import { TierService } from '../tier/tier.service';

@Injectable()
export class LoanService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private legalProofService: LegalProofService,
    private receiptService: ReceiptService,
    private stateMachine: StateMachineService,
    private notificationService: NotificationService,
    private tierService: TierService,
  ) {}

  async recordPayment(dto: CreatePaymentDto) {
    const payment = await this.prisma.payment.create({
      data: {
        customerId: dto.customerId,
        loanId: dto.loanId,
        scheduleId: dto.scheduleId,
        auctionListingId: dto.auctionListingId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        paymentType: dto.paymentType,
        referenceNumber: dto.referenceNumber,
        transactionId: dto.transactionId,
        status: 'COMPLETED',
        processedBy: dto.processedBy,
        notes: dto.notes,
      },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            contactNumber: true,
          },
        },
        schedule: true,
      },
    });

    // If payment is for a schedule, update schedule status
    if (dto.scheduleId) {
      const schedule = await this.prisma.repaymentSchedule.findUnique({
        where: { id: dto.scheduleId },
      });

      if (schedule) {
        const newPaidAmount = schedule.paidAmount + dto.amount;
        const totalDue = schedule.totalAmount + schedule.penaltyAmount;

        let status: 'PARTIAL' | 'PAID' = 'PARTIAL';
        if (newPaidAmount >= totalDue) {
          status = 'PAID';
        }

        await this.prisma.repaymentSchedule.update({
          where: { id: dto.scheduleId },
          data: {
            paidAmount: newPaidAmount,
            paidDate: new Date(),
            status: status,
          },
        });
      }
    }

    if (dto.customerId) {
      try {
        await this.tierService.recomputeCustomerTier(
          dto.customerId,
          dto.processedBy || 'system',
        );
      } catch (tierErr) {
        console.error('Failed to update customer tier after payment:', tierErr);
      }
    }

    // Record in finance ledger
    try {
      const loan = dto.loanId
        ? await this.prisma.loan.findUnique({
            where: { id: dto.loanId },
            select: { pawnshopId: true, customerName: true },
          })
        : null;
      const pawnshopId = loan?.pawnshopId;
      if (pawnshopId) {
        const category =
          dto.paymentType === 'PENALTY_FEE'
            ? LedgerCategory.PENALTY_COLLECTION
            : LedgerCategory.LOAN_REPAYMENT;
        const ledgerEntry = await this.financeService.createEntry(pawnshopId, {
          entryType: LedgerEntryType.CREDIT,
          category,
          amount: dto.amount,
          description: `Loan repayment from ${loan?.customerName || 'customer'} (Loan #${dto.loanId})`,
          performedBy: dto.processedBy || 'system',
          referenceType: 'PAYMENT',
          referenceId: payment.id,
          counterparty: loan?.customerName || undefined,
          paymentMethod: dto.paymentMethod,
        });

        await this.legalProofService.createProof({
          pawnshopId,
          recordType:
            dto.paymentType === 'PENALTY_FEE'
              ? 'PENALTY_PROOF'
              : 'PAYMENT_PROOF',
          title: `Payment proof for payment ${payment.id}`,
          summary: `Payment ${payment.id} of ₱${dto.amount.toFixed(2)} was recorded for ${loan?.customerName || 'customer'}.`,
          createdBy: dto.processedBy || 'system',
          loanId: dto.loanId,
          paymentId: payment.id,
          ledgerEntryId: ledgerEntry.id,
          payload: {
            paymentId: payment.id,
            loanId: dto.loanId,
            scheduleId: dto.scheduleId,
            auctionListingId: dto.auctionListingId,
            amount: dto.amount,
            paymentMethod: dto.paymentMethod,
            paymentType: dto.paymentType,
            referenceNumber: dto.referenceNumber,
            transactionId: dto.transactionId,
            ledgerEntryId: ledgerEntry.id,
            status: payment.status,
          },
        });

        try {
          await this.receiptService.generateReceipt({
            pawnshopId,
            receiptType:
              dto.paymentType === 'PENALTY_FEE'
                ? 'PENALTY'
                : 'PAYMENT',
            referenceType: 'PAYMENT',
            referenceId: payment.id,
            amount: dto.amount,
            customerName: loan?.customerName || 'Customer',
            lineItems: [
              {
                description:
                  dto.paymentType === 'PENALTY_FEE'
                    ? 'Late Penalty Fee'
                    : 'Loan Repayment',
                amount: dto.amount,
              },
            ],
            generatedBy: dto.processedBy || 'system',
          });
        } catch (receiptErr) {
          console.error('Failed to generate receipt for payment:', receiptErr);
        }
      }
    } catch (err) {
      // Don't fail the payment if ledger entry fails
      console.error(
        'Failed to create finance ledger entry for loan payment:',
        err,
      );
    }

    if (dto.customerId) {
      try {
        const loanForNotif = dto.loanId
          ? await this.prisma.loan.findUnique({
              where: { id: dto.loanId },
              select: { ticket: { select: { ticketNumber: true } } },
            })
          : null;
        await this.notificationService.sendNotification({
          recipientId: dto.customerId,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.PAYMENT_DUE,
          title: 'Payment Recorded',
          body: `Your payment of ₱${dto.amount.toFixed(2)} has been recorded${loanForNotif?.ticket ? ` for ticket #${loanForNotif.ticket.ticketNumber}` : ''}.`,
          data: {
            paymentId: payment.id,
            loanId: dto.loanId,
            amount: dto.amount,
          },
        });
      } catch (notifErr) {
        console.error('Failed to send payment notification:', notifErr);
      }
    }

    return payment;
  }

  /**
   * Get payment history for a loan
   */
  async getPaymentHistory(loanId: number) {
    const payments = await this.prisma.payment.findMany({
      where: { loanId },
      orderBy: { processedAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
          },
        },
        schedule: {
          select: {
            id: true,
            installmentNumber: true,
            dueDate: true,
          },
        },
      },
    });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    return {
      loanId,
      payments,
      summary: {
        totalPaid,
        paymentCount: payments.length,
      },
    };
  }

  /**
   * Get payment history for a customer
   */
  async getCustomerPaymentHistory(customerId: string) {
    const resolvedId = await this.resolveCustomerIdentifier(customerId);
    const payments = await this.prisma.payment.findMany({
      where: { customerId: resolvedId },
      orderBy: { processedAt: 'desc' },
      include: {
        loan: {
          select: {
            id: true,
            principalAmount: true,
          },
        },
        schedule: {
          select: {
            installmentNumber: true,
            dueDate: true,
          },
        },
      },
    });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    return {
      customerId: resolvedId,
      payments,
      summary: {
        totalPaid,
        paymentCount: payments.length,
      },
    };
  }

  /**
   * Get single payment details
   */
  async getPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        customer: true,
        loan: true,
        schedule: true,
        auctionListing: true,
      },
    });

    return payment;
  }

  async getProofsForPayment(paymentId: string) {
    return this.legalProofService.listByPayment(paymentId);
  }

  async getProofsForLoan(loanId: number) {
    return this.legalProofService.listByLoan(loanId);
  }

  async getLoanStatus(loanId: string) {
    const resolvedId = await this.resolveLoanIdentifier(loanId);
    const loan = await this.prisma.loan.findUnique({
      where: { id: resolvedId },
      include: {
        ticket: true,
        application: { select: { id: true, status: true } },
      },
    });
    if (!loan) throw new NotFoundException(`Loan ${resolvedId} not found`);

    const lifecycleStatus = loan.ticket?.lifecycleStatus || loan.status;
    const validTransitions = this.stateMachine.getValidTransitions(
      'TICKET_LIFECYCLE',
      lifecycleStatus,
    );

    const lifecycleOrder = [
      'RECEIVED',
      'APPRAISED',
      'OFFER_MADE',
      'CONTRACT_SIGNED',
      'DISBURSED',
      'ACTIVE',
      'GRACE_PERIOD',
      'OVERDUE',
      'REDEEMED',
      'FORFEITED',
      'AUCTION_QUEUED',
      'AUCTION_SOLD',
      'AUCTION_UNSOLD',
      'CANCELLED',
    ];
    const currentIndex = lifecycleOrder.indexOf(lifecycleStatus);
    const progress =
      currentIndex >= 0
        ? Math.round((currentIndex / (lifecycleOrder.length - 1)) * 100)
        : 0;

    const daysElapsed = loan.createdAt
      ? Math.floor(
          (Date.now() - loan.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    return {
      loanId: loan.id,
      loanStatus: loan.status,
      lifecycleStatus,
      applicationStatus: loan.application?.status || null,
      validTransitions,
      progress: {
        percentage: progress,
        currentStep: lifecycleStatus,
        totalSteps: lifecycleOrder.length - 1,
        currentStepIndex: currentIndex >= 0 ? currentIndex : -1,
      },
      timing: {
        daysElapsed,
        createdAt: loan.createdAt,
        expiryDate: loan.ticket?.expiryDate || null,
        forfeitureDate: loan.ticket?.forfeitureDate || null,
        gracePeriodEnd: loan.ticket?.gracePeriodEnd || null,
      },
    };
  }

  /**
   * Get full history for a single loan: payments, contract, and all proofs
   */
  async getLoanFullHistory(loanId: string) {
    const resolvedId = await this.resolveLoanIdentifier(loanId);
    const [loan, paymentRows] = await Promise.all([
      this.prisma.loan.findUnique({
        where: { id: resolvedId },
        include: {
          application: {
            include: {
              contract: true,
            },
          },
          ticket: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { loanId: resolvedId },
        select: { id: true },
      }),
    ]);

    if (!loan) {
      throw new NotFoundException(`Loan ${resolvedId} not found`);
    }

    const paymentIds = paymentRows.map((p) => p.id);

    const [
      payments,
      contractProofs,
      loanProofs,
      disbursements,
      penalties,
      receipts,
    ] = await Promise.all([
      this.prisma.payment.findMany({
        where: { loanId: resolvedId },
        orderBy: { processedAt: 'desc' },
        include: {
          customer: { select: { id: true, fullName: true } },
          schedule: {
            select: { id: true, installmentNumber: true, dueDate: true },
          },
        },
      }),
      loan.application?.contract
        ? this.legalProofService.listByContract(loan.application.contract.id)
        : [],
      this.legalProofService.listByLoan(resolvedId),
      this.prisma.loanDisbursement.findMany({
        where: { loanId: resolvedId },
        orderBy: { disbursedAt: 'desc' },
      }),
      this.prisma.penalty.findMany({
        where: { loanId: resolvedId },
        orderBy: { appliedDate: 'desc' },
      }),
      paymentIds.length > 0
        ? this.prisma.receipt.findMany({
            where: {
              referenceType: 'PAYMENT',
              referenceId: { in: paymentIds },
            },
            orderBy: { generatedAt: 'desc' },
          })
        : [],
    ]);

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    const timeline = this.buildTimeline([
      ...payments.map((p) => ({
        eventType: 'PAYMENT',
        timestamp: p.processedAt || new Date(),
        data: { id: p.id, amount: p.amount, method: p.paymentMethod },
      })),
      ...(loan.application?.contract
        ? [
            {
              eventType: 'CONTRACT_SIGNED',
              timestamp:
                loan.application.contract.staffSignedAt ||
                loan.application.contract.customerSignedAt ||
                new Date(),
              data: {
                contractId: loan.application.contract.id,
                number: loan.application.contract.contractNumber,
              },
            },
          ]
        : []),
      ...loanProofs.map((p) => ({
        eventType: 'PROOF_RECORD',
        timestamp: p.createdAt,
        data: { proofNumber: p.proofNumber, recordType: p.recordType },
      })),
      ...disbursements.map((d) => ({
        eventType: 'DISBURSEMENT',
        timestamp: d.disbursedAt,
        data: {
          amount: d.amount,
          method: d.disbursementMethod,
          disbursedBy: d.disbursedBy,
        },
      })),
      ...penalties.map((p) => ({
        eventType: 'PENALTY',
        timestamp: p.appliedDate,
        data: {
          id: p.id,
          amount: p.amount,
          type: p.penaltyType,
          waived: p.waived,
        },
      })),
      ...receipts.map((r) => ({
        eventType: 'RECEIPT',
        timestamp: r.generatedAt,
        data: {
          receiptNumber: r.receiptNumber,
          type: r.receiptType,
          amount: r.totalAmount,
        },
      })),
      {
        eventType: 'LIFECYCLE_STATUS',
        timestamp: loan.ticket?.updatedAt || loan.createdAt,
        data: { status: loan.ticket?.lifecycleStatus || loan.status },
      },
    ]);

    return {
      loanId: resolvedId,
      loan: {
        id: loan.id,
        principalAmount: loan.principalAmount,
        status: loan.status,
        lifecycleStatus: loan.ticket?.lifecycleStatus || loan.status,
        createdAt: loan.createdAt,
      },
      contract: loan.application?.contract || null,
      payments: {
        records: payments,
        summary: {
          totalPaid,
          paymentCount: payments.length,
        },
      },
      proofs: {
        contractProofs,
        loanProofs,
        count: loanProofs.length,
      },
      timeline,
    };
  }

  async getCustomerDashboard(customerId: string) {
    const resolvedId = await this.resolveCustomerIdentifier(customerId);
    const [loans, payments, recentProofs, customer, tierInfo] =
      await Promise.all([
        this.prisma.loan.findMany({
        where: { application: { customerId: resolvedId } },
        include: {
          ticket: {
            select: {
              lifecycleStatus: true,
              expiryDate: true,
              forfeitureDate: true,
              gracePeriodEnd: true,
              updatedAt: true,
            },
          },
          schedules: {
            where: { status: { in: ['PENDING', 'PARTIAL'] } },
            orderBy: { dueDate: 'asc' },
            take: 1,
          },
        },
      }),
      this.prisma.payment.findMany({
        where: { customerId: resolvedId },
        orderBy: { processedAt: 'desc' },
        include: {
          loan: { select: { id: true, principalAmount: true } },
        },
      }),
      this.prisma.legalProof.findMany({
        where: { loan: { application: { customerId: resolvedId } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          recordType: true,
          title: true,
          createdAt: true,
          loanId: true,
        },
      }),
      this.prisma.customer.findUnique({
        where: { id: resolvedId },
        select: { loyaltyTier: true, tier: true },
      }),
      this.tierService.getCustomerTierInfo(resolvedId),
    ]);

    const activeLoans = loans.filter(
      (l) => l.status === 'ACTIVE' || l.ticket?.lifecycleStatus === 'ACTIVE',
    );
    const overdueLoans = loans.filter(
      (l) => l.status === 'OVERDUE' || l.ticket?.lifecycleStatus === 'OVERDUE',
    );
    const gracePeriodLoans = loans.filter(
      (l) =>
        l.status === 'GRACE_PERIOD' ||
        l.ticket?.lifecycleStatus === 'GRACE_PERIOD',
    );

    const totalOutstanding = activeLoans.reduce(
      (sum, l) => sum + l.principalAmount,
      0,
    );
    const totalOverdue = overdueLoans.reduce(
      (sum, l) => sum + l.principalAmount,
      0,
    );
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    const nextDuePayment =
      loans
        .flatMap((l) =>
          (l.schedules || []).map((s) => ({
            ...s,
            loanId: l.id,
            principalAmount: l.principalAmount,
          })),
        )
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0] || null;

    return {
      customerId: resolvedId,
      tier: customer?.loyaltyTier || 'Standard',
      tierCode: customer?.tier || tierInfo?.tierCode,
      transactionVolume: tierInfo?.transactionVolume ?? 0,
      transactionCount: tierInfo?.transactionCount ?? 0,
      tierHistory: tierInfo?.history ?? [],
      summary: {
        totalLoans: loans.length,
        activeLoanCount: activeLoans.length,
        overdueCount: overdueLoans.length,
        gracePeriodCount: gracePeriodLoans.length,
        totalOutstanding,
        totalOverdue,
        totalPaid,
        totalPayments: payments.length,
      },
      nextDuePayment: nextDuePayment
        ? {
            loanId: nextDuePayment.loanId,
            dueDate: nextDuePayment.dueDate,
            amount:
              nextDuePayment.totalAmount - (nextDuePayment.paidAmount || 0),
            status: nextDuePayment.status,
          }
        : null,
      recentActivity: recentProofs,
    };
  }

  async disburseLoan(loanId: number, processedBy: string, userRole?: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        ticket: { include: { customer: true } },
        application: { select: { pawnshopId: true } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!loan.ticket)
      throw new BadRequestException('Loan has no linked ticket');

    const pawnshopId = loan.application?.pawnshopId || loan.ticket.pawnshopId;
    if (!pawnshopId) throw new BadRequestException('Loan has no pawnshop');

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      loan.ticket.lifecycleStatus,
      'DISBURSED',
      { userRole },
    );

    await this.prisma.ticket.update({
      where: { id: loan.ticket.id },
      data: { lifecycleStatus: 'DISBURSED', updatedAt: new Date() },
    });

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      'DISBURSED',
      'ACTIVE',
    );

    await this.prisma.ticket.update({
      where: { id: loan.ticket.id },
      data: {
        lifecycleStatus: 'ACTIVE',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    });

    await this.prisma.loan.update({
      where: { id: loan.id },
      data: { status: 'ACTIVE' },
    });

    if (loan.ticket?.customerId) {
      try {
        await this.tierService.recomputeCustomerTier(loan.ticket.customerId, processedBy);
      } catch (tierErr) {
        console.error('Failed to update customer tier after disbursement:', tierErr);
      }
    }

    const customerName = loan.ticket.customer?.fullName || loan.customerName || 'Customer';

    await this.legalProofService.createProof({
      pawnshopId,
      recordType: 'CONTRACT_PROOF',
      title: `Loan disbursed — Loan #${loanId}`,
      summary: `Loan #${loanId} for ${customerName} was disbursed at ₱${loan.principalAmount.toFixed(2)} and activated.`,
      createdBy: processedBy,
      loanId: loan.id,
      ticketId: loan.ticket.id,
      payload: {
        loanId: loan.id,
        ticketId: loan.ticket.id,
        ticketNumber: loan.ticket.ticketNumber,
        principalAmount: loan.principalAmount,
        interestAmount: loan.interestAmount,
        customerName,
        processedBy,
        disbursedAt: new Date().toISOString(),
      },
    });

    try {
      await this.receiptService.generateReceipt({
        pawnshopId,
        receiptType: 'DISBURSEMENT',
        referenceType: 'LOAN',
        referenceId: String(loanId),
        amount: loan.principalAmount,
        taxAmount: loan.interestAmount,
        customerName,
        customerId: loan.ticket.customer?.id ?? undefined,
        lineItems: [
          { description: 'Principal Loan Amount', amount: loan.principalAmount },
          { description: 'Interest (prepaid)', amount: loan.interestAmount },
        ],
        generatedBy: processedBy,
      });
    } catch (receiptErr) {
      console.error('Failed to generate disbursement receipt:', receiptErr);
    }

    if (loan.ticket?.customerId) {
      try {
        await this.notificationService.sendNotification({
          recipientId: loan.ticket.customerId,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.PAYMENT_DUE,
          title: 'Loan Disbursed',
          body: `Your loan of ₱${loan.principalAmount.toFixed(2)} for ticket #${loan.ticket.ticketNumber} has been disbursed and is now active.`,
          data: {
            loanId: loan.id,
            ticketId: loan.ticket.id,
            ticketNumber: loan.ticket.ticketNumber,
            principalAmount: loan.principalAmount,
          },
        });
      } catch (notifErr) {
        console.error('Failed to send disbursement notification:', notifErr);
      }
    }

    try {
      const approvalRecord = await this.prisma.approvalRecord.findFirst({
        where: {
          pawnshopId,
          targetType: 'APPRAISAL',
          targetId: String(loan.ticket.id),
          status: 'PENDING',
        },
      });
      if (approvalRecord) {
        await this.prisma.approvalRecord.update({
          where: { id: approvalRecord.id },
          data: { status: 'APPROVED', decidedById: processedBy, decidedAt: new Date() },
        });
        await this.notificationService.sendNotification({
          recipientId: approvalRecord.requestedById,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.SYSTEM_ANNOUNCEMENT,
          title: 'Approval granted',
          body: `Your APPRAISAL approval request was approved and the loan has been disbursed.`,
          data: {
            approvalRecordId: approvalRecord.id,
            targetType: 'APPRAISAL',
            status: 'APPROVED',
          },
        });
      }
    } catch (approvalErr) {
      console.error('Failed to finalize appraisal approval on disbursement:', approvalErr);
    }

    return {
      loanId,
      status: 'ACTIVE',
      message: 'Loan disbursed and activated',
      principalAmount: loan.principalAmount,
      interestAmount: loan.interestAmount,
    };
  }

  async renewLoan(dto: RenewLoanDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: dto.ticketId },
      include: { customer: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!ticket.pawnshopId)
      throw new BadRequestException('Ticket has no pawnshop');

    const loan = await this.prisma.loan.findUnique({
      where: { id: dto.loanId },
    });
    if (!loan) throw new NotFoundException('Loan not found');

    const renewableStates = ['ACTIVE', 'OVERDUE', 'GRACE_PERIOD'];
    if (!renewableStates.includes(ticket.lifecycleStatus)) {
      throw new BadRequestException(
        `Ticket ${ticket.ticketNumber} (${ticket.lifecycleStatus}) cannot be renewed. Only ACTIVE, OVERDUE, or GRACE_PERIOD tickets can be renewed.`,
      );
    }

    const extensionDays = dto.extensionDays || 30;
    const now = new Date();
    const newExpiry = new Date(now);
    newExpiry.setDate(newExpiry.getDate() + extensionDays);
    const newGracePeriodEnd = new Date(newExpiry);
    newGracePeriodEnd.setDate(newGracePeriodEnd.getDate() + 30);
    const newForfeitureDate = new Date(newGracePeriodEnd);
    newForfeitureDate.setDate(newForfeitureDate.getDate() + 15);

    if (
      ticket.lifecycleStatus === 'OVERDUE' ||
      ticket.lifecycleStatus === 'GRACE_PERIOD'
    ) {
      await this.stateMachine.transition(
        'TICKET_LIFECYCLE',
        ticket.lifecycleStatus,
        'ACTIVE',
        { userRole: dto.userRole },
      );
    }

    const updatedTicket = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'ACTIVE',
        status: 'ACTIVE',
        expiryDate: newExpiry,
        gracePeriodEnd: newGracePeriodEnd,
        forfeitureDate: newForfeitureDate,
        updatedAt: now,
      },
    });

    await this.prisma.loan.update({
      where: { id: loan.id },
      data: { status: 'ACTIVE' },
    });

    const payment = await this.prisma.payment.create({
      data: {
        customerId: ticket.customerId,
        loanId: loan.id,
        amount: dto.interestAmount,
        paymentMethod: dto.paymentMethod,
        paymentType: 'LOAN_REPAYMENT',
        status: 'COMPLETED',
        processedBy: dto.processedBy,
        notes: dto.notes || `Pawn renewal for ticket #${ticket.ticketNumber}`,
      },
    });

    let ledgerEntry = null;
    try {
      ledgerEntry = await this.financeService.createEntry(ticket.pawnshopId, {
        entryType: LedgerEntryType.CREDIT,
        category: LedgerCategory.LOAN_REPAYMENT,
        amount: dto.interestAmount,
        description: `Renewal interest payment for ticket #${ticket.ticketNumber}`,
        performedBy: dto.processedBy,
        referenceType: 'PAYMENT',
        referenceId: payment.id,
        counterparty: ticket.customer?.fullName || undefined,
        paymentMethod: dto.paymentMethod,
      });
    } catch (_err) {
      // Don't fail if ledger entry fails
    }

    await this.legalProofService.createProof({
      pawnshopId: ticket.pawnshopId,
      recordType: 'PAYMENT_PROOF',
      title: `Renewal proof for ticket #${ticket.ticketNumber}`,
      summary: `Loan renewal: interest \u20B1${dto.interestAmount.toFixed(2)} paid, expiry extended to ${newExpiry.toLocaleDateString()}`,
      createdBy: dto.processedBy,
      loanId: loan.id,
      paymentId: payment.id,
      ticketId: ticket.id,
      ledgerEntryId: ledgerEntry?.id,
      payload: {
        ticketId: ticket.id,
        loanId: loan.id,
        paymentId: payment.id,
        interestAmount: dto.interestAmount,
        paymentMethod: dto.paymentMethod,
        previousExpiry: ticket.expiryDate,
        newExpiry,
        extensionDays,
        renewedBy: dto.processedBy,
        renewedAt: now,
      },
    });

    try {
      await this.receiptService.generateReceipt({
        pawnshopId: ticket.pawnshopId,
        receiptType: 'RENEWAL',
        referenceType: 'PAYMENT',
        referenceId: payment.id,
        amount: dto.interestAmount,
        customerName: ticket.customer?.fullName || 'Customer',
        lineItems: [
          {
            description: `Pawn Renewal Interest (Ticket #${ticket.ticketNumber})`,
            amount: dto.interestAmount,
          },
        ],
        generatedBy: dto.processedBy,
      });
    } catch (_receiptErr) {
      // Don't fail if receipt creation fails
    }

    return {
      ticketId: updatedTicket.id,
      loanId: loan.id,
      ticketNumber: ticket.ticketNumber,
      status: 'ACTIVE',
      previousStatus: ticket.lifecycleStatus,
      newExpiry,
      interestPaid: dto.interestAmount,
      extensionDays,
      message: 'Loan renewed successfully',
    };
  }

  /**
   * Get full history for a customer: all loans, payments, contracts, and proofs
   */
  async getCustomerFullHistory(customerId: string) {
    const resolvedId = await this.resolveCustomerIdentifier(customerId);
    const [loans, payments, allProofs] = await Promise.all([
      this.prisma.loan.findMany({
        where: { application: { customerId: resolvedId } },
        include: {
          application: {
            include: {
              contract: true,
            },
          },
          ticket: { select: { lifecycleStatus: true, updatedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.findMany({
        where: { customerId: resolvedId },
        orderBy: { processedAt: 'desc' },
        include: {
          loan: { select: { id: true, principalAmount: true } },
          schedule: { select: { installmentNumber: true, dueDate: true } },
        },
      }),
      this.prisma.legalProof.findMany({
        where: {
          loan: { application: { customerId: resolvedId } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    const loanIds = loans.map((l) => l.id);
    const paymentMap = new Map<number, typeof payments>();
    for (const p of payments) {
      const arr = paymentMap.get(p.loanId) || [];
      arr.push(p);
      paymentMap.set(p.loanId, arr);
    }

    const [allDisbursements, allPenalties, allReceipts, customerReceipts] =
      await Promise.all([
        loanIds.length > 0
          ? this.prisma.loanDisbursement.findMany({
              where: { loanId: { in: loanIds } },
            })
          : [],
        loanIds.length > 0
          ? this.prisma.penalty.findMany({ where: { loanId: { in: loanIds } } })
          : [],
        payments.length > 0
          ? this.prisma.receipt.findMany({
              where: {
                referenceType: 'PAYMENT',
                referenceId: { in: payments.map((p) => p.id) },
              },
            })
          : [],
        this.prisma.receipt.findMany({
          where: {
            customerId: resolvedId,
            receiptType: { in: ['REDEMPTION', 'AUCTION_SALE', 'LOAN_DISBURSEMENT'] },
          },
          orderBy: { generatedAt: 'desc' },
        }),
      ]);

    const loansWithHistory = loans.map((loan) => {
      const loanPayments = paymentMap.get(loan.id) || [];
      const loanProofs = allProofs.filter((p) => p.loanId === loan.id);

      return {
        loanId: loan.id,
        status: loan.status,
        lifecycleStatus: loan.ticket?.lifecycleStatus || loan.status,
        principalAmount: loan.principalAmount,
        contract: loan.application?.contract || null,
        paymentCount: loanPayments.length,
        totalPaid: loanPayments.reduce((sum, p) => sum + p.amount, 0),
        proofCount: loanProofs.length,
      };
    });

    const customerTimeline = this.buildTimeline([
      ...payments.map((p) => ({
        eventType: 'PAYMENT',
        timestamp: p.processedAt || new Date(),
        data: { id: p.id, amount: p.amount, loanId: p.loanId },
      })),
      ...loans.map((l) => ({
        eventType: 'LOAN_CREATED',
        timestamp: l.createdAt,
        data: { loanId: l.id, amount: l.principalAmount },
      })),
      ...allProofs.map((p) => ({
        eventType: 'PROOF_RECORD',
        timestamp: p.createdAt,
        data: { proofNumber: p.proofNumber, recordType: p.recordType },
      })),
      ...allDisbursements.map((d) => ({
        eventType: 'DISBURSEMENT',
        timestamp: d.disbursedAt,
        data: { loanId: d.loanId, amount: d.amount },
      })),
      ...allPenalties.map((p) => ({
        eventType: 'PENALTY',
        timestamp: p.appliedDate,
        data: { loanId: p.loanId, amount: p.amount, type: p.penaltyType },
      })),
      ...allReceipts.map((r) => ({
        eventType: 'RECEIPT',
        timestamp: r.generatedAt,
        data: {
          receiptNumber: r.receiptNumber,
          type: r.receiptType,
          amount: r.totalAmount,
        },
      })),
      ...customerReceipts.map((r) => ({
        eventType: 'RECEIPT',
        timestamp: r.generatedAt,
        data: {
          receiptNumber: r.receiptNumber,
          type: r.receiptType,
          amount: r.totalAmount,
        },
      })),
      ...loans.map((l) => ({
        eventType: 'LIFECYCLE_STATUS',
        timestamp: l.ticket?.updatedAt || l.createdAt,
        data: { loanId: l.id, status: l.ticket?.lifecycleStatus || l.status },
      })),
    ]);

    return {
      customerId: resolvedId,
      summary: {
        totalLoans: loans.length,
        totalPaid,
        paymentCount: payments.length,
        proofCount: allProofs.length,
      },
      loansWithHistory,
      payments: {
        records: payments,
        count: payments.length,
      },
      proofs: {
        records: allProofs,
        count: allProofs.length,
      },
      receipts: {
        records: [...allReceipts, ...customerReceipts].sort(
          (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime(),
        ),
        count: allReceipts.length + customerReceipts.length,
      },
      timeline: customerTimeline,
    };
  }

  /**
   * Helper: resolve a customer identifier to a valid UUID.
   * Accepts a raw UUID, or a searchable term (full name / contact number /
   * partial customer id) and returns the matching customer's UUID.
   */
  private async resolveCustomerIdentifier(identifier: string): Promise<string> {
    const raw = (identifier || '').trim();
    if (!raw) {
      throw new BadRequestException('Customer identifier is required');
    }

    const isUuid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        raw,
      );

    if (isUuid) {
      const existing = await this.prisma.customer.findUnique({
        where: { id: raw },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException(`Customer ${raw} not found`);
      }
      return existing.id;
    }

    const byLookup = await this.prisma.customer.findFirst({
      where: {
        OR: [
          { fullName: { contains: raw, mode: 'insensitive' } },
          { contactNumber: { contains: raw } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true },
    });

    if (!byLookup) {
      throw new NotFoundException(
        `Customer not found for "${raw}". Try a full name, contact number, or customer ID.`,
      );
    }

    return byLookup.id;
  }

  /**
   * Helper: resolve a loan identifier to a numeric loan id.
   * Accepts a numeric loan id, or an application UUID (via loan.applicationId),
   * so both the "By Loan ID" search and clicks from the recent-applications
   * list resolve to the same loan row.
   */
  private async resolveLoanIdentifier(identifier: string): Promise<number> {
    const raw = (identifier || '').trim();
    if (!raw) {
      throw new BadRequestException('Loan identifier is required');
    }

    const isUuid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        raw,
      );

    if (isUuid) {
      const byApplication = await this.prisma.loan.findUnique({
        where: { applicationId: raw },
        select: { id: true },
      });
      if (byApplication) return byApplication.id;
      throw new NotFoundException(`Loan for application ${raw} not found`);
    }

    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;

    throw new NotFoundException(`Loan ${raw} not found`);
  }

  /**
   * Helper: build chronological timeline from mixed events
   */
  private buildTimeline(
    events: Array<{ eventType: string; timestamp: Date; data: any }>,
  ) {
    return events
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .map((event, index) => ({
        sequenceNumber: index + 1,
        eventType: event.eventType,
        timestamp: event.timestamp,
        ...event.data,
      }));
  }
}
