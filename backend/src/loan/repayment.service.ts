import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';
import {
  GenerateRepaymentScheduleDto,
  UpdateSchedulePaymentDto,
} from './dto/repayment-schedule.dto';

@Injectable()
export class RepaymentService {
  private readonly logger = new Logger(RepaymentService.name);

  constructor(
    private prisma: PrismaService,
    private stateMachine: StateMachineService,
  ) {}

  /**
   * Generate repayment schedule for a loan
   */
  async generateSchedule(dto: GenerateRepaymentScheduleDto) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: dto.loanId },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    // Check if schedule already exists
    const existingSchedules = await this.prisma.repaymentSchedule.findMany({
      where: { loanId: dto.loanId },
    });

    if (existingSchedules.length > 0) {
      throw new BadRequestException(
        'Repayment schedule already exists for this loan',
      );
    }

    // Calculate monthly payment using amortization formula
    const principal = dto.loanAmount;
    const monthlyRate = dto.interestRate / 100 / 12;
    const numPayments = dto.termMonths;

    // Monthly payment formula: P * [r(1+r)^n] / [(1+r)^n - 1]
    const monthlyPayment =
      (principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
      (Math.pow(1 + monthlyRate, numPayments) - 1);

    // Generate schedule for each month
    const schedules = [];
    let remainingPrincipal = principal;
    const startDate = new Date(dto.startDate);

    for (let i = 1; i <= numPayments; i++) {
      const interestPayment = remainingPrincipal * monthlyRate;
      const principalPayment = monthlyPayment - interestPayment;
      remainingPrincipal -= principalPayment;

      // Calculate due date (add i months to start date)
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      schedules.push({
        loanId: dto.loanId,
        installmentNumber: i,
        dueDate,
        principalAmount: Math.round(principalPayment * 100) / 100,
        interestAmount: Math.round(interestPayment * 100) / 100,
        totalAmount: Math.round(monthlyPayment * 100) / 100,
        status: 'PENDING',
      });
    }

    // Create all schedules
    await this.prisma.repaymentSchedule.createMany({
      data: schedules,
    });

    const created = await this.prisma.repaymentSchedule.findMany({
      where: { loanId: dto.loanId },
      orderBy: { installmentNumber: 'asc' },
    });

    return created;
  }

  /**
   * Get repayment schedule for a loan
   */
  async getSchedule(loanId: number) {
    const schedules = await this.prisma.repaymentSchedule.findMany({
      where: { loanId },
      orderBy: { installmentNumber: 'asc' },
      include: {
        payments: true,
      },
    });

    if (schedules.length === 0) {
      throw new NotFoundException('Repayment schedule not found for this loan');
    }

    // Calculate summary
    const totalAmount = schedules.reduce((sum, s) => sum + s.totalAmount, 0);
    const paidAmount = schedules.reduce((sum, s) => sum + s.paidAmount, 0);
    const remainingAmount = totalAmount - paidAmount;
    const overdueCount = schedules.filter((s) => s.status === 'OVERDUE').length;
    const completedCount = schedules.filter((s) => s.status === 'PAID').length;

    return {
      loanId,
      schedules,
      summary: {
        totalInstallments: schedules.length,
        totalAmount,
        paidAmount,
        remainingAmount,
        completedCount,
        overdueCount,
        progress: (completedCount / schedules.length) * 100,
      },
    };
  }

  /**
   * Update schedule payment status
   */
  async updatePayment(dto: UpdateSchedulePaymentDto) {
    const schedule = await this.prisma.repaymentSchedule.findUnique({
      where: { id: dto.scheduleId },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    const updated = await this.prisma.repaymentSchedule.update({
      where: { id: dto.scheduleId },
      data: {
        paidAmount: dto.paidAmount,
        paidDate: dto.paidDate ? new Date(dto.paidDate) : new Date(),
        status: dto.status as any,
        penaltyAmount: dto.penaltyAmount || schedule.penaltyAmount,
        notes: dto.notes,
      },
    });

    return updated;
  }

  /**
   * Check for overdue payments and update status
   * Runs daily at midnight; also exposed as manual trigger via POST /loan/schedule/check-overdue
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkOverduePayments() {
    const now = new Date();

    const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lt: now },
      },
      include: {
        loan: {
          include: {
            ticket: true,
          },
        },
      },
    });

    if (overdueSchedules.length === 0) {
      return { count: 0, schedules: [] };
    }

    const scheduleIds = overdueSchedules.map((s) => s.id);

    await this.prisma.repaymentSchedule.updateMany({
      where: { id: { in: scheduleIds } },
      data: { status: 'OVERDUE' },
    });

    const ticketIds = new Set<number>();
    for (const s of overdueSchedules) {
      const ticket = s.loan?.ticket;
      if (ticket && ticket.lifecycleStatus === 'ACTIVE') {
        ticketIds.add(ticket.id);
      }
    }

    for (const ticketId of ticketIds) {
      try {
        await this.stateMachine.transition(
          'TICKET_LIFECYCLE',
          'ACTIVE',
          'OVERDUE',
        );
        await this.prisma.ticket.update({
          where: { id: ticketId },
          data: { lifecycleStatus: 'OVERDUE', status: 'OVERDUE', updatedAt: now },
        });
        await this.prisma.loan.updateMany({
          where: { ticketId },
          data: { status: 'OVERDUE' },
        });
        this.logger.log(`Ticket #${ticketId} marked OVERDUE`);
      } catch (err) {
        this.logger.warn(`Cannot transition ticket #${ticketId} to OVERDUE: ${(err as Error).message}`);
      }
    }

    return {
      count: overdueSchedules.length,
      schedules: overdueSchedules,
    };
  }

  /**
   * Get upcoming payments (next 7 days)
   */
  async getUpcomingPayments(pawnshopId?: string) {
    const now = new Date();
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const where: any = {
      status: 'PENDING',
      dueDate: {
        gte: now,
        lte: sevenDaysLater,
      },
    };

    const schedules = await this.prisma.repaymentSchedule.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        loan: {
          include: {
            ticket: {
              select: {
                ticketNumber: true,
                pawnshopId: true,
              },
            },
          },
        },
      },
    });

    // Filter by pawnshop if provided
    const filtered = pawnshopId
      ? schedules.filter((s) => s.loan?.ticket?.pawnshopId === pawnshopId)
      : schedules;

    return filtered;
  }
}
