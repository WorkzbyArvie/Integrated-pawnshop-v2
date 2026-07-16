import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';

@Injectable()
export class LoanForfeitureService {
  private readonly logger = new Logger(LoanForfeitureService.name);

  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
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

        forfeited.push(updated.id);
        this.logger.log(`Ticket #${ticket.id} auto-forfeited`);
      } catch (err) {
        this.logger.warn(`Cannot forfeit ticket #${ticket.id}: ${(err as Error).message}`);
      }
    }

    return { count: forfeited.length, tickets: forfeited };
  }

  async queueForAuction(ticketId: number, userRole?: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
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

    return { ticketId: updated.id, lifecycleStatus: 'AUCTION_QUEUED' };
  }
}
