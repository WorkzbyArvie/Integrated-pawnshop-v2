import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PenaltyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate and apply penalties for overdue payments
   */
  async calculatePenalties(loanId: number) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        schedules: {
          where: {
            status: 'OVERDUE',
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    const penalties = [];
    const now = new Date();

    for (const schedule of loan.schedules || []) {
      // Calculate days overdue
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(schedule.dueDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysOverdue > 0) {
        // Check if penalty already exists for this schedule
        const existingPenalty = await this.prisma.penalty.findFirst({
          where: {
            loanId,
            scheduleId: schedule.id,
            waived: false,
          },
        });

        if (!existingPenalty) {
          // Calculate penalty amount (e.g., 2% of total amount per day, max 10%)
          const dailyPenaltyRate = 0.02;
          const maxPenaltyRate = 0.1;
          const penaltyRate = Math.min(
            daysOverdue * dailyPenaltyRate,
            maxPenaltyRate,
          );
          const penaltyAmount = schedule.totalAmount * penaltyRate;

          // Create penalty record
          const penalty = await this.prisma.penalty.create({
            data: {
              loanId,
              scheduleId: schedule.id,
              penaltyType: 'LATE_PAYMENT',
              amount: penaltyAmount,
              reason: `Payment overdue by ${daysOverdue} days`,
            },
          });

          // Update schedule with penalty amount
          await this.prisma.repaymentSchedule.update({
            where: { id: schedule.id },
            data: {
              penaltyAmount: schedule.penaltyAmount + penaltyAmount,
            },
          });

          penalties.push(penalty);
        }
      }
    }

    return {
      loanId,
      penaltiesApplied: penalties.length,
      penalties,
    };
  }

  /**
   * Get all penalties for a loan
   */
  async getLoanPenalties(loanId: number) {
    const penalties = await this.prisma.penalty.findMany({
      where: { loanId },
      orderBy: { appliedDate: 'desc' },
    });

    const totalPenalty = penalties
      .filter((p) => !p.waived)
      .reduce((sum, p) => sum + p.amount, 0);

    const waivedPenalty = penalties
      .filter((p) => p.waived)
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      loanId,
      penalties,
      summary: {
        totalPenalty,
        waivedPenalty,
        activePenalty: totalPenalty,
        count: penalties.length,
        waivedCount: penalties.filter((p) => p.waived).length,
      },
    };
  }

  /**
   * Waive a penalty
   */
  async waivePenalty(penaltyId: string, waivedBy: string, reason: string) {
    const penalty = await this.prisma.penalty.findUnique({
      where: { id: penaltyId },
      include: {
        loan: {
          include: {
            schedules: true,
          },
        },
      },
    });

    if (!penalty) {
      throw new NotFoundException('Penalty not found');
    }

    // Update penalty
    const waived = await this.prisma.penalty.update({
      where: { id: penaltyId },
      data: {
        waived: true,
        waivedBy,
        waivedAt: new Date(),
        waivedReason: reason,
      },
    });

    // Update schedule to remove penalty amount
    if (penalty.scheduleId) {
      const schedule = await this.prisma.repaymentSchedule.findUnique({
        where: { id: penalty.scheduleId },
      });

      if (schedule) {
        await this.prisma.repaymentSchedule.update({
          where: { id: penalty.scheduleId },
          data: {
            penaltyAmount: Math.max(0, schedule.penaltyAmount - penalty.amount),
          },
        });
      }
    }

    return waived;
  }

  /**
   * Apply manual penalty
   */
  async applyManualPenalty(data: {
    loanId: number;
    penaltyType: string;
    amount: number;
    reason: string;
    scheduleId?: number;
  }) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: data.loanId },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    const penalty = await this.prisma.penalty.create({
      data: {
        loanId: data.loanId,
        scheduleId: data.scheduleId || null,
        penaltyType: data.penaltyType as any,
        amount: data.amount,
        reason: data.reason,
      },
    });

    // Update schedule if specified
    if (data.scheduleId) {
      const schedule = await this.prisma.repaymentSchedule.findUnique({
        where: { id: data.scheduleId },
      });

      if (schedule) {
        await this.prisma.repaymentSchedule.update({
          where: { id: data.scheduleId },
          data: {
            penaltyAmount: schedule.penaltyAmount + data.amount,
          },
        });
      }
    }

    return penalty;
  }
}
