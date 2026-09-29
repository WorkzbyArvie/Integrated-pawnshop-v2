import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
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
import { TierService } from '../tier/tier.service';
import {
  GRACE_PERIOD_DAYS,
  PAWN_TERM_DAYS,
  gracePeriodEndFrom,
  maturityDateFrom,
  toTermMonths,
} from './loan-terms';
import {
  interestFor,
  isBelowStatutoryMinimum,
  resolveRates,
  serviceFeeFor,
  statutoryMinimumLoan,
  STATUTORY_MIN_LTV,
  toCentavos,
} from '../finance/interest';
import {
  HIGH_RISK_THRESHOLD,
  appraise,
  assessRisk,
  normalizePurity,
  resolveAppraisalRates,
} from './appraisal';
import { QuoteAppraisalDto, RedemptionQuoteDto } from './dto/appraise-item.dto';
import { LedgerEntryType, LedgerCategory, NotificationChannel, NotificationType, PaymentMethod, Prisma, TicketLifecycleStatus } from '@prisma/client';

export function assertCustomerKycVerified(
  customer: { kycStatus?: string } | null | undefined,
): void {
  if (!customer || customer.kycStatus !== 'VERIFIED') {
    throw new ConflictException('Customer KYC must be VERIFIED before this action');
  }
}

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
    private tierService: TierService,
  ) {}

  /**
   * Price a prospective pawn without creating anything.
   *
   * The POS screen used to compute all of this in the browser from a table
   * hardcoded in the component, with no record of the rates and no way for a
   * branch to price to its own market. The response carries the rates that
   * produced the figures so the appraisal is reproducible later - a per-gram
   * constant that changes should not silently change what a past ticket says
   * it was worth.
   */
  async quoteAppraisal(dto: QuoteAppraisalDto, requestedBy: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: requestedBy },
      select: { pawnshopId: true },
    });

    const pawnshopId = profile?.pawnshopId ?? null;
    if (!pawnshopId) {
      throw new BadRequestException(
        'No pawnshop associated with your account. Select a shop before appraising.',
      );
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    const rates = resolveAppraisalRates(pawnshop?.settings);
    const moneyRates = resolveRates(pawnshop?.settings);

    // Purity scales the per-gram rate, and is the largest single source of
    // error in a per-gram appraisal: an 18K chain and a 24K one of the same
    // weight differ by a quarter. A 925-standard field (sterling) is normalised
    // to a percentage first, because "925" and "92.5" mean the same thing and a
    // pawner who writes 925 in a purity field should not get a 10x value.
    const purity = normalizePurity(dto.purityPercent);
    const appraisal = appraise(dto.itemCategory, dto.weight, rates);

    const scaledAppraised = toCentavos(appraisal.appraisedValue * (purity ?? 1));
    const loanAtLtv = toCentavos(scaledAppraised * appraisal.ltvRatio);

    const risk = assessRisk({
      authenticityVerified: dto.authenticityVerified,
      authenticitySuspect: dto.authenticitySuspect,
      idVerified: dto.idVerified,
      kycStatus: dto.kycStatus,
      weight: dto.weight,
      appraisedValue: scaledAppraised,
    });

    if (risk.blocking) {
      throw new BadRequestException(
        'This item cannot be pawned: the appraiser has flagged it as suspected counterfeit. ' +
          'Holding it would leave the branch with worthless collateral and a claim from the rightful owner.',
      );
    }

    // The statutory floor, P.D. 114 Section 9. A loan below 30% of appraised
    // value needs the pawner's written request on file, so it is surfaced here
    // rather than discovered at disbursement.
    const belowStatutoryMinimum =
      loanAtLtv < scaledAppraised * STATUTORY_MIN_LTV;

    return {
      itemCategory: dto.itemCategory,
      collateralClass: appraisal.collateralClass,
      weight: appraisal.weight,
      purityPercent: purity,
      gramRate: appraisal.gramRate,
      gramRateBasis: 'pawn/melt value, not spot',
      ltvRatio: appraisal.ltvRatio,
      appraisedValue: scaledAppraised,
      recommendedLoanAmount: loanAtLtv,
      money: {
        interest: interestFor(loanAtLtv, moneyRates),
        serviceFee: serviceFeeFor(loanAtLtv, moneyRates),
        interestRate: moneyRates.monthlyInterestRate,
        serviceFeeNote: 'P.D. 114 s.10: the fee is the lesser of 1% of principal and PHP 5.',
      },
      termDays: PAWN_TERM_DAYS,
      maturityDate: maturityDateFrom(PAWN_TERM_DAYS).toISOString(),
      gracePeriodDays: GRACE_PERIOD_DAYS,
      gracePeriodEnds: gracePeriodEndFrom(
        maturityDateFrom(PAWN_TERM_DAYS),
      ).toISOString(),
      risk,
      compliance: {
        statutoryMinLtv: STATUTORY_MIN_LTV,
        belowStatutoryMinimum,
        note: belowStatutoryMinimum
          ? 'P.D. 114 Section 9 permits a loan below 30% of appraised value only where the pawner manifests in writing the desire to borrow less.'
          : undefined,
      },
      ratesUsed: rates,
      appraiserNotes: dto.appraiserNotes ?? null,
    };
  }

  /**
   * The full cost to settle an existing ticket.
   *
   * Derived from the loan's own recorded rate, not from whatever the client
   * asks for. The redemption screen used to compute `principal * 0.03` and send
   * that as `amountPaid`, while loans were issued at 3.5%, so the branch
   * silently absorbed the difference on every redemption.
   */
  async quoteRedemption(dto: RedemptionQuoteDto, requestedBy: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: dto.ticketId },
      include: { customer: true, loans: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!ticket.pawnshopId) throw new BadRequestException('Ticket has no pawnshop');

    const loan = ticket.loans?.[0];
    if (!loan) {
      throw new BadRequestException(
        `No loan is recorded for ticket ${ticket.ticketNumber}, so there is nothing to settle.`,
      );
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: ticket.pawnshopId },
      select: { settings: true },
    });
    const moneyRates = resolveRates(pawnshop?.settings);

    // The loan's recorded rate wins. A shop that has since changed its pricing
    // must still settle the loan it issued at the rate it issued it under.
    const rateForLoan =
      typeof loan.interestRate === 'number' && loan.interestRate > 0
        ? {
            ...moneyRates,
            monthlyInterestRate: loan.interestRate,
          }
        : moneyRates;

    const principal = loan.principalAmount ?? ticket.loanAmount ?? 0;
    const interest = interestFor(principal, rateForLoan);
    const serviceFee = serviceFeeFor(principal, rateForLoan);

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      // Carried so the screen can offer a renewal against the same loan without
      // a second lookup, and so the settlement panel can name the record it is
      // pricing rather than only the ticket it is displayed under.
      loanId: loan.id,
      customerName: ticket.customer?.fullName ?? null,
      principal: toCentavos(principal),
      interest,
      serviceFee,
      total: toCentavos(principal + interest + serviceFee),
      interestRate: rateForLoan.monthlyInterestRate,
      serviceFeeNote: 'P.D. 114 s.10: the fee is the lesser of 1% of principal and PHP 5.',
      lifecycleStatus: ticket.lifecycleStatus,
      expiryDate: ticket.expiryDate,
      gracePeriodEnd: ticket.gracePeriodEnd,
      forfeitedAt: ticket.forfeitureDate,
      // The redemption right, so the screen can say why a ticket is still
      // redeemable rather than making staff count days themselves.
      daysUntilForfeiture: ticket.forfeitureDate
        ? Math.ceil((ticket.forfeitureDate.getTime() - Date.now()) / 86_400_000)
        : null,
      quotedFor: requestedBy,
    };
  }

  async createTicket(dto: CreatePawnTicketDto, createdBy: string) {
    let customerId: string;

    try {
      customerId = await this.resolveCustomerId(dto, createdBy);
    } catch (err: any) {
      throw new Error(`resolveCustomerId failed: ${err.message}`);
    }

    const ticketNumber = `TKT-${Math.floor(Date.now() / 1000)}`;
    const expiryDate = new Date(dto.appraisalDeadline);

    // The shop's own rates, so the rate written on the ticket is the one the
    // branch actually prices at rather than a platform constant.
    const shop = await this.prisma.pawnshop.findUnique({
      where: { id: dto.pawnshopId },
      select: { settings: true },
    });
    const moneyRates = resolveRates(shop?.settings);

    if (isNaN(expiryDate.getTime())) {
      throw new Error(`Invalid appraisalDeadline date: ${dto.appraisalDeadline}`);
    }

    const descriptionWithPhotos = dto.photoUrls?.length
      ? `${dto.itemDescription}\n\n[PHOTO_URLS] ${JSON.stringify(dto.photoUrls)}`
      : dto.itemDescription;

    // The scorer publishes these thresholds; a bare 40 here was a second,
    // silently divergent copy of the same boundary.
    const isHighRisk = (dto.riskScore ?? 0) >= HIGH_RISK_THRESHOLD;

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
          // The shop's configured rate, as a FRACTION. This was hardcoded to 3.5
          // — a percentage — into a column that stores a fraction, so every POS
          // ticket recorded 350% interest and a redemption priced off that
          // column would have demanded 3.5x principal. The per-shop rate is
          // resolved the same way as everywhere else; see
          // DEFAULT_MONTHLY_INTEREST_RATE for the units.
          interestRate: moneyRates.monthlyInterestRate,
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

    await this.prisma.approvalRecord.create({
      data: {
        pawnshopId: this.assertPawnshopId(ticket),
        targetType: 'APPRAISAL',
        targetId: String(ticket.id),
        status: 'PENDING',
        amount: ticket.loanAmount,
        requestedById: userId,
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          appraisedValue: ticket.loanAmount,
          riskScore: ticket.isHighRisk ? 60 : 0,
          recommendedLoanAmount: ticket.loanAmount,
          itemCondition: null,
          appraisalNotes: `Submitted for approval via appraisal workflow for ticket ${ticket.ticketNumber}`,
        } as Prisma.InputJsonValue,
      },
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

    // Rates are the shop's own. A pawnshop on this platform may quote different
    // terms from its neighbour, and a branch changing its pricing should not
    // require a code change.
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: this.assertPawnshopId(ticket) },
      select: { settings: true },
    });
    const rates = resolveRates(pawnshop?.settings);

    const loanApp = await this.prisma.loanApplication.create({
      data: {
        customerId: ticket.customerId,
        pawnshopId: this.assertPawnshopId(ticket),
        loanAmount: ticket.loanAmount,
        loanType: 'PAWN',
        // Was a bare `1`, meaning "one month", while the application DTO
        // accepted up to 60 and the renewal worked in days. Derived from the
        // shared term so the stored value, the contract and the renewal cannot
        // disagree.
        termMonths: toTermMonths(PAWN_TERM_DAYS),
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
        // Was `Math.round(ticket.loanAmount * 0.035)`, which disagreed with the
        // column default the redemption screen quoted from. The rate is read
        // from the shop's own settings so two shops on this platform may quote
        // different terms, and is written explicitly rather than left to the
        // column default - a default nobody sets is a default nobody means.
        interestAmount: interestFor(ticket.loanAmount, rates),
        interestRate: rates.monthlyInterestRate,
        // P.D. 114 s.10 caps the fee at the lesser of 1% and PHP 5, so this is
        // not `principal * rate` - see serviceFeeFor.
        serviceFeeAmount: serviceFeeFor(ticket.loanAmount, rates),
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

    const existingPending = await this.prisma.approvalRecord.findFirst({
      where: {
        pawnshopId,
        targetType: 'REDEMPTION',
        targetId: String(ticket.id),
        status: 'PENDING',
      },
    });
    if (existingPending) {
      throw new BadRequestException(
        'Redemption for this ticket is already pending approval',
      );
    }

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
          previousLifecycleStatus: ticket.lifecycleStatus,
        } as Prisma.InputJsonValue,
      },
    });

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'REDEMPTION_PENDING_APPROVAL',
      { userRole },
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL', updatedAt: new Date() },
    });

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      lifecycleStatus: 'REDEMPTION_PENDING_APPROVAL',
      requiresApproval: true,
      approvalId: approvalRecord?.id,
      approvalStatus: 'PENDING',
      message: 'Redemption requires owner approval before the item is released',
    };
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
        customerId: ticket.customerId ?? undefined,
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
        await this.tierService.recomputeCustomerTier(ticket.customerId, processedBy);
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

    // P.D. 114 Section 9.
    //
    //   "the amount of loan shall, in no case, be less than thirty per cent (30%)
    //    of the appraised value of the security offered for the loan unless the
    //    pawner manifests in writing the desire to borrow a lesser amount."
    //
    // Checked here rather than at disbursement because this is where an appraiser
    // sets the loan against a valuation, which is the only point the ratio is
    // knowable. Nothing enforced it before, so a typo in the appraisal could
    // produce a sub-statutory loan with no objection recorded anywhere.
    //
    // The appraisal record does not yet carry the borrower's written consent
    // flag, so a sub-minimum loan is refused rather than assumed to be
    // permitted. The exception is real and a pawnshop may rely on it, but it has
    // to be evidenced - which is the whole of what Section 9 asks for.
    if (
      Number.isFinite(appraised) &&
      appraised > 0 &&
      isBelowStatutoryMinimum(appraised, finalAmount, false)
    ) {
      throw new BadRequestException(
        `A loan of ${finalAmount} is below the statutory minimum of ` +
          `${statutoryMinimumLoan(appraised)}, which is 30% of the appraised value of ` +
          `${appraised} (P.D. 114 Section 9). Either raise the loan to the minimum ` +
          `or record the pawner's written request to borrow less.`,
      );
    }

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

    const redeemableStates = ['REDEMPTION_PENDING_APPROVAL', 'ACTIVE', 'GRACE_PERIOD'];
    if (!redeemableStates.includes(ticket.lifecycleStatus)) {
      throw new BadRequestException(
        `Cannot release redemption for ticket in status: ${ticket.lifecycleStatus}. Must be REDEMPTION_PENDING_APPROVAL, ACTIVE, or GRACE_PERIOD.`,
      );
    }

    const loan = ticket.loans?.[0];
    if (!loan) throw new BadRequestException('No loan found for this ticket');

    return this.performRedemptionRelease(ticket, loan, dto, decidedBy, userRole);
  }

  async rejectRedemption(ticketId: number, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.lifecycleStatus !== 'REDEMPTION_PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot reject redemption in status: ${ticket.lifecycleStatus}. Must be REDEMPTION_PENDING_APPROVAL.`,
      );
    }

    let previousStatus: TicketLifecycleStatus = 'ACTIVE';
    if (ticket.pawnshopId) {
      const pending = await this.prisma.approvalRecord.findFirst({
        where: {
          pawnshopId: ticket.pawnshopId,
          targetType: 'REDEMPTION',
          targetId: String(ticket.id),
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });
      const payload = (pending?.payload ?? {}) as Record<string, unknown>;
      if (payload.previousLifecycleStatus === 'GRACE_PERIOD') {
        previousStatus = 'GRACE_PERIOD';
      }
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      previousStatus,
      { userRole },
    );

    const updatedTicket = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { lifecycleStatus: previousStatus, updatedAt: new Date() },
    });

    return {
      id: updatedTicket.id,
      ticketNumber: updatedTicket.ticketNumber,
      lifecycleStatus: previousStatus,
      message: 'Redemption request rejected; ticket status restored',
    };
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

    const byContact = await this.prisma.customer.findFirst({
      where: {
        contactNumber: dto.customerContact,
        pawnshopId: dto.pawnshopId,
      },
      select: { id: true },
    });

    if (byContact) {
      await this.prisma.customer.update({
        where: { id: byContact.id },
        data: {
          fullName: dto.customerName,
          address: dto.customerAddress,
        },
      });
      return byContact.id;
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

  async getCustomerTierInfo(customerId: string) {
    return this.tierService.getCustomerTierInfo(customerId);
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
