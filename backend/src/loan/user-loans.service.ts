import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PaymongoService } from '../subscription/paymongo.service';
import { FinanceService } from '../finance/finance.service';
import { LegalProofService } from './legal-proof.service';
import { ReceiptService } from '../receipt/receipt.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { LedgerCategory, LedgerEntryType } from '@prisma/client';

@Injectable()
export class UserLoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymongoService: PaymongoService,
    private readonly financeService: FinanceService,
    private readonly legalProofService: LegalProofService,
    private readonly receiptService: ReceiptService,
    private readonly stateMachine: StateMachineService,
  ) {}

  async getMyLoanItems(userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        customerId: userId,
        status: { in: ['ACTIVE', 'PENDING', 'OVERDUE'] },
      },
      include: {
        loans: {
          where: { status: 'ACTIVE' },
          select: {
            principalAmount: true,
            interestAmount: true,
            status: true,
          },
        },
      },
      orderBy: { pawnDate: 'desc' },
    });

    const now = Date.now();
    return tickets.map((ticket) => {
      const pawnMs = new Date(ticket.pawnDate).getTime();
      const expiryMs = new Date(ticket.expiryDate).getTime();
      const totalDays = Math.max(1, Math.ceil((expiryMs - pawnMs) / 86400000));
      const elapsedDays = Math.max(0, Math.ceil((now - pawnMs) / 86400000));
      const daysRemaining = Math.ceil((expiryMs - now) / 86400000);
      const progress = Math.min(1, Math.max(0, elapsedDays / totalDays));

      const firstLoan = ticket.loans?.[0];
      const totalDue = firstLoan
        ? Number(firstLoan.principalAmount || 0) +
          Number(firstLoan.interestAmount || 0)
        : Number(ticket.loanAmount || 0) * 1.035;

      return {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        itemName: ticket.description || ticket.category || 'Pawned Item',
        category: ticket.category,
        loanAmount: Number(ticket.loanAmount || 0),
        totalDue: Math.round(totalDue),
        expiryDate: ticket.expiryDate,
        daysRemaining,
        status: ticket.status,
        progress,
      };
    });
  }

  async getMyPaidItems(userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        customerId: userId,
        status: 'REDEEMED',
      },
      select: {
        id: true,
        ticketNumber: true,
        description: true,
        category: true,
        status: true,
        loanAmount: true,
        interestRate: true,
        updatedAt: true,
        expiryDate: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const ticketIds = tickets.map((t) => t.id);
    const receipts = await this.prisma.receipt.findMany({
      where: {
        referenceType: 'TICKET',
        referenceId: { in: ticketIds.map(String) },
      },
      select: {
        id: true,
        receiptNumber: true,
        referenceId: true,
        amount: true,
        totalAmount: true,
        pdfUrl: true,
        generatedAt: true,
      },
    });

    const receiptByTicketId = new Map<string, typeof receipts[0]>();
    for (const r of receipts) {
      if (!receiptByTicketId.has(r.referenceId)) {
        receiptByTicketId.set(r.referenceId, r);
      }
    }

    return tickets.map((ticket) => {
      const principal = Number(ticket.loanAmount || 0);
      const interest = Math.round(
        principal * (Number(ticket.interestRate || 0) / 100),
      );
      const serviceFee = 100;
      const totalPaid = principal + interest + serviceFee;
      const receipt = receiptByTicketId.get(String(ticket.id));

      return {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        itemName: ticket.description || ticket.category || 'Pawned Item',
        category: ticket.category,
        principal,
        interest,
        serviceFee,
        totalPaid,
        paidAt: ticket.updatedAt,
        expiryDate: ticket.expiryDate,
        status: ticket.status,
        receipt: receipt
          ? {
              id: receipt.id,
              receiptNumber: receipt.receiptNumber,
              amount: receipt.amount,
              totalAmount: receipt.totalAmount,
              pdfUrl: receipt.pdfUrl,
              generatedAt: receipt.generatedAt,
            }
          : null,
      };
    });
  }

  async createPayLinkForTicket(userId: string, ticketId: number) {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        customerId: userId,
        status: { in: ['ACTIVE', 'PENDING', 'OVERDUE'] },
      },
      include: {
        customer: {
          select: {
            fullName: true,
          },
        },
        loans: {
          where: { status: 'ACTIVE' },
          select: {
            principalAmount: true,
            interestAmount: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new Error('Loan item not found');
    }

    if (!this.paymongoService.isEnabled) {
      throw new Error('Checkout provider is not configured on backend');
    }

    const firstLoan = ticket.loans?.[0];
    const totalDue = firstLoan
      ? Number(firstLoan.principalAmount || 0) +
        Number(firstLoan.interestAmount || 0)
      : Number(ticket.loanAmount || 0) * 1.035;
    const amountCentavos = Math.max(1, Math.round(totalDue * 100));

    const link = await this.paymongoService.createPaymentLink({
      amountCentavos,
      description: `PAWN_TICKET:${ticket.id}`,
      remarks: ticket.customer?.fullName || ticket.description || 'Pawn item',
      metadata: {
        referenceType: 'PAWN_TICKET_PAYMENT',
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        userId,
      },
    });

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      amount: Math.round(totalDue),
      checkoutUrl: link.checkoutUrl,
      paymentLinkId: link.linkId,
      checkoutReferenceId: link.linkId,
    };
  }

  async confirmPaymentLinkAndSync(
    userId: string,
    ticketId: number,
    paymentLinkId: string,
  ) {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        customerId: userId,
      },
      include: { customer: true },
    });

    if (!ticket) {
      throw new Error('Loan item not found');
    }

    if (ticket.status === 'REDEEMED') {
      return { status: 'REDEEMED', ticketId: ticket.id };
    }

    if (!this.paymongoService.isEnabled) {
      return { status: 'PENDING', reason: 'checkout_provider_not_configured' };
    }

    const link: unknown =
      await this.paymongoService.retrievePaymentLink(paymentLinkId);
    const isPaid = this.isPaymentLinkPaid(link);
    if (!isPaid) {
      return { status: 'PENDING', ticketId: ticket.id };
    }

    await this.markTicketRedeemed(ticket.id);
    return { status: 'REDEEMED', ticketId: ticket.id };
  }

  async handleProviderPawnWebhook(eventPayload: unknown) {
    const payload =
      eventPayload && typeof eventPayload === 'object'
        ? (eventPayload as Record<string, unknown>)
        : {};

    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : {};
    const attributes =
      data.attributes && typeof data.attributes === 'object'
        ? (data.attributes as Record<string, unknown>)
        : {};

    const eventTypeFromAttributes =
      typeof attributes.type === 'string' ? attributes.type : undefined;
    const eventTypeFromRoot =
      typeof payload.type === 'string'
        ? payload.type
        : typeof payload.event === 'string'
          ? payload.event
          : undefined;
    const eventType = eventTypeFromAttributes || eventTypeFromRoot;

    const payloadData =
      attributes.data && typeof attributes.data === 'object'
        ? (attributes.data as Record<string, unknown>)
        : data;
    const attrs =
      payloadData.attributes && typeof payloadData.attributes === 'object'
        ? (payloadData.attributes as Record<string, unknown>)
        : {};

    const supported = ['link.payment.paid', 'payment.paid', 'invoice.paid'];
    if (!eventType || !supported.includes(eventType)) {
      return { received: true, skipped: true, reason: 'unsupported_event' };
    }

    const metadata =
      attrs.metadata && typeof attrs.metadata === 'object'
        ? (attrs.metadata as Record<string, unknown>)
        : {};
    let ticketId: number | null =
      typeof metadata.ticketId === 'number'
        ? metadata.ticketId
        : Number((metadata.ticketId as string | number | undefined) ?? NaN);

    if (!ticketId || Number.isNaN(ticketId)) {
      const rawDescription =
        attrs.description ??
        (payloadData as Record<string, unknown>).description ??
        (payloadData as Record<string, unknown>).external_id;
      const description =
        typeof rawDescription === 'string' || typeof rawDescription === 'number'
          ? String(rawDescription)
          : '';
      const match = description.match(/PAWN_TICKET:(\d+)/);
      ticketId = match ? Number(match[1]) : null;
    }

    if (!ticketId || Number.isNaN(ticketId)) {
      return {
        received: true,
        skipped: true,
        reason: 'ticket_not_found_in_payload',
      };
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true },
    });
    if (!ticket) {
      return { received: true, skipped: true, reason: 'ticket_not_found' };
    }

    if (ticket.status === 'REDEEMED') {
      return { received: true, skipped: true, reason: 'already_redeemed' };
    }

    await this.markTicketRedeemed(ticket.id);

    return { received: true, ticketId, status: 'REDEEMED' };
  }

  private isPaymentLinkPaid(linkData: unknown): boolean {
    const data =
      linkData && typeof linkData === 'object'
        ? (linkData as Record<string, unknown>)
        : {};
    const attributes =
      data.attributes && typeof data.attributes === 'object'
        ? (data.attributes as Record<string, unknown>)
        : {};

    const status =
      typeof attributes.status === 'string' ? attributes.status : undefined;
    if (status === 'paid') {
      return true;
    }

    if (attributes.paid === true) {
      return true;
    }

    const payments =
      attributes.payments && typeof attributes.payments === 'object'
        ? (attributes.payments as Record<string, unknown>)
        : {};
    const paymentData = Array.isArray(payments.data) ? payments.data : [];

    return paymentData.length > 0;
  }

  private async markTicketRedeemed(ticketId: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true },
    });
    if (!ticket) {
      throw new Error('Ticket not found');
    }
    if (ticket.status === 'REDEEMED') {
      return;
    }

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'REDEEMED',
    );

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lifecycleStatus: 'REDEEMED',
        status: 'REDEEMED',
        updatedAt: new Date(),
      },
    });

    const principal = Number(ticket.loanAmount || 0);
    const interest = Math.round(
      principal * (Number(ticket.interestRate || 0) / 100),
    );
    const serviceFee = 100;
    const totalDue = principal + interest + serviceFee;
    const customerName = ticket.customer?.fullName || 'Customer';
    const ticketRef = ticket.ticketNumber || String(ticket.id);

    try {
      if (ticket.pawnshopId) {
        await this.financeService.createEntry(ticket.pawnshopId, {
          entryType: LedgerEntryType.CREDIT,
          category: LedgerCategory.LOAN_REPAYMENT,
          amount: principal,
          description: `Loan repayment (online checkout): ${customerName} redeemed Ticket #${ticketRef}`,
          performedBy: ticket.customerId,
          referenceType: 'TICKET',
          referenceId: String(ticket.id),
          counterparty: customerName,
        });

        if (interest > 0) {
          await this.financeService.createEntry(ticket.pawnshopId, {
            entryType: LedgerEntryType.CREDIT,
            category: LedgerCategory.FEE_COLLECTION,
            amount: interest,
            description: `Interest income (online checkout): Ticket #${ticketRef}`,
            performedBy: ticket.customerId,
            referenceType: 'TICKET',
            referenceId: String(ticket.id),
            counterparty: customerName,
          });
        }

        await this.financeService.createEntry(ticket.pawnshopId, {
          entryType: LedgerEntryType.CREDIT,
          category: LedgerCategory.FEE_COLLECTION,
          amount: serviceFee,
          description: `Service fee (online checkout): Ticket #${ticketRef}`,
          performedBy: ticket.customerId,
          referenceType: 'TICKET',
          referenceId: String(ticket.id),
          counterparty: customerName,
        });
      }
    } catch {
      // Do not fail webhook acknowledgement due to non-critical ledger write failure.
    }

    if (ticket.pawnshopId) {
      try {
        await this.legalProofService.createProof({
          pawnshopId: ticket.pawnshopId,
          recordType: 'CONTRACT_PROOF',
          title: `Online redemption — ${ticketRef}`,
          summary: `Ticket ${ticketRef} redeemed online. Total: ₱${totalDue}.`,
          createdBy: ticket.customerId,
          ticketId: ticket.id,
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            customerName,
            principal,
            interest,
            serviceFee,
            totalCollected: totalDue,
            redeemedAt: new Date().toISOString(),
            paymentMethod: 'ONLINE',
          },
        });

        await this.receiptService.generateReceipt({
          pawnshopId: ticket.pawnshopId,
          receiptType: 'REDEMPTION',
          referenceType: 'TICKET',
          referenceId: String(ticket.id),
          amount: totalDue,
          customerName,
          lineItems: [
            { description: 'Principal Repayment', amount: principal },
            { description: 'Interest', amount: interest },
            { description: 'Service Fee', amount: serviceFee },
          ],
          generatedBy: ticket.customerId,
        });
      } catch (err) {
        console.error('Failed to create proof/receipt for online redemption:', err);
      }
    }
  }
}
