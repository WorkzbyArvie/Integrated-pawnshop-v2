import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import { LegalProofService } from './legal-proof.service';
import { ReceiptService } from '../receipt/receipt.service';

@Injectable()
export class LoanForfeitureService {
  private readonly logger = new Logger(LoanForfeitureService.name);

  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
    private legalProofService: LegalProofService,
    private receiptService: ReceiptService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async autoForfeitGracePeriodTickets(): Promise<void> {
    this.logger.log('Running auto-forfeiture check for grace-period tickets...');
    const result = await this.processForfeitures();
    this.logger.log(`Auto-forfeiture complete: ${result.count} ticket(s) forfeited`);
  }

  async processForfeitures(): Promise<{ count: number; tickets: number[] }> {
    const now = new Date();
    const forfeited: number[] = [];

    const expiredGraceTickets = await this.prisma.ticket.findMany({
      where: {
        lifecycleStatus: 'GRACE_PERIOD',
        gracePeriodEnd: { lte: now },
      },
      include: { customer: true },
    });

    for (const ticket of expiredGraceTickets) {
      try {
        await this.stateMachine.transition(
          'TICKET_LIFECYCLE',
          'GRACE_PERIOD',
          'FORFEITED',
        );

        const updated = await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            lifecycleStatus: 'FORFEITED',
            status: 'FORFEITED',
            updatedAt: now,
          },
        });

        await this.prisma.loan.updateMany({
          where: { ticketId: ticket.id },
          data: { status: 'FORFEITED' },
        });

        if (ticket.pawnshopId) {
          try {
            await this.legalProofService.createProof({
              pawnshopId: ticket.pawnshopId,
              recordType: 'FORFEITURE_PROOF',
              title: `Ticket forfeited: ${ticket.ticketNumber}`,
              summary: `Ticket ${ticket.ticketNumber} forfeited after grace period expired. Pawnshop has taken ownership of the item.`,
              createdBy: 'system',
              ticketId: ticket.id,
              payload: {
                ticketId: ticket.id,
                ticketNumber: ticket.ticketNumber,
                customerId: ticket.customerId,
                gracePeriodEnd: ticket.gracePeriodEnd?.toISOString(),
                forfeitureDate: now.toISOString(),
                itemCategory: ticket.category,
                loanAmount: ticket.loanAmount,
              },
            });
          } catch (proofErr) {
            this.logger.warn(`Failed to create forfeiture proof for ticket #${ticket.id}: ${(proofErr as Error).message}`);
          }

          try {
            await this.receiptService.generateReceipt({
              pawnshopId: ticket.pawnshopId,
              receiptType: 'FORFEITURE' as any,
              referenceType: 'TICKET',
              referenceId: String(ticket.id),
              amount: 0,
              customerName: ticket.customer?.fullName || 'Customer',
              lineItems: [
                { description: `Forfeiture — Ticket #${ticket.ticketNumber} (${ticket.category})`, amount: 0 },
                { description: `Outstanding Loan Amount`, amount: ticket.loanAmount },
              ],
              generatedBy: 'system',
            });
          } catch (receiptErr) {
            this.logger.warn(`Failed to create forfeiture receipt for ticket #${ticket.id}: ${(receiptErr as Error).message}`);
          }
        }

        forfeited.push(updated.id);
        this.logger.log(`Ticket #${ticket.id} auto-forfeited`);
      } catch (err) {
        this.logger.warn(`Cannot forfeit ticket #${ticket.id}: ${(err as Error).message}`);
      }
    }

    return { count: forfeited.length, tickets: forfeited };
  }

  async queueForAuction(ticketId: number, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.stateMachine.transition(
      'TICKET_LIFECYCLE',
      ticket.lifecycleStatus,
      'AUCTION_QUEUED',
      { userRole },
    );

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        lifecycleStatus: 'AUCTION_QUEUED',
        status: 'AUCTION_QUEUED',
        updatedAt: new Date(),
      },
    });

    if (ticket.pawnshopId) {
      try {
        await this.legalProofService.createProof({
          pawnshopId: ticket.pawnshopId,
          recordType: 'AUCTION_SELLER_PROOF',
          title: `Ticket queued for auction: ${ticket.ticketNumber}`,
          summary: `Ticket ${ticket.ticketNumber} queued for auction. Item: ${ticket.category}, Loan: ₱${ticket.loanAmount.toFixed(2)}.`,
          createdBy: userRole || 'system',
          ticketId: ticket.id,
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            customerId: ticket.customerId,
            itemCategory: ticket.category,
            loanAmount: ticket.loanAmount,
            queuedAt: new Date().toISOString(),
          },
        });
      } catch (proofErr) {
        this.logger.warn(`Failed to create auction queued proof for ticket #${ticket.id}: ${(proofErr as Error).message}`);
      }
    }

    return { ticketId: updated.id, lifecycleStatus: 'AUCTION_QUEUED' };
  }
}
