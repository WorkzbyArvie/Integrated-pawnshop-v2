import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { FinanceService } from '../finance/finance.service';
import { GeneratePayslipDto } from './dto/generate-payslip.dto';
import {
  PayslipStatus,
  AttendanceStatus,
  LedgerEntryType,
  LedgerCategory,
} from '@prisma/client';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
  private readonly PAYROLL_SETTINGS_KEY = 'payrollBaseSalaryByPosition';
  private readonly PAYROLL_ALLOWANCE_SETTINGS_KEY =
    'payrollAllowanceByPosition';
  private readonly PAYROLL_FREQUENCY_KEY = 'payrollFrequencyDays';

  // Philippine government mandatory deductions
  private readonly SSS_RATE = 0.045; // Employee SSS contribution rate
  private readonly PHILHEALTH_RATE = 0.025; // Employee PhilHealth rate
  private readonly PAGIBIG_FIXED = 100; // Fixed Pag-IBIG contribution
  private readonly LATE_DEDUCTION_PER_MINUTE = 5; // ₱5 per minute late
  private readonly OVERTIME_MULTIPLIER = 1.25; // 125% for overtime

  constructor(
    private prisma: PrismaService,
    private attendanceService: AttendanceService,
    private financeService: FinanceService,
  ) {}

  private normalizeBranchId(branchId?: number | string | null): number | undefined {
    if (branchId === undefined || branchId === null || branchId === '') {
      return undefined;
    }

    const parsed = typeof branchId === 'string' ? Number(branchId) : branchId;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid branchId');
    }

    return parsed;
  }

  private normalizePosition(position: string): string {
    return position.trim().toUpperCase();
  }

  private async getPayrollSettingsMap(
    pawnshopId: string,
  ): Promise<Record<string, number>> {
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const settings = (pawnshop.settings as Record<string, unknown> | null) || {};
    const rawMap =
      (settings[this.PAYROLL_SETTINGS_KEY] as Record<string, unknown> | undefined) ||
      {};

    const normalized: Record<string, number> = {};

    for (const [key, value] of Object.entries(rawMap)) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      normalized[this.normalizePosition(key)] = amount;
    }

    return normalized;
  }

  private async getPayrollAllowanceSettingsMap(
    pawnshopId: string,
  ): Promise<Record<string, number>> {
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const settings = (pawnshop.settings as Record<string, unknown> | null) || {};
    const rawMap =
      (settings[this.PAYROLL_ALLOWANCE_SETTINGS_KEY] as
        | Record<string, unknown>
        | undefined) || {};

    const normalized: Record<string, number> = {};

    for (const [key, value] of Object.entries(rawMap)) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      normalized[this.normalizePosition(key)] = amount;
    }

    return normalized;
  }

  async getPositionSalarySettings(pawnshopId: string): Promise<{
    salaryByPosition: Record<string, number>;
    allowanceByPosition: Record<string, number>;
    payrollFrequencyDays: 15 | 30;
  }> {
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const settings = (pawnshop.settings as Record<string, unknown> | null) || {};
    const salaryByPosition = await this.getPayrollSettingsMap(pawnshopId);
    const allowanceByPosition = await this.getPayrollAllowanceSettingsMap(
      pawnshopId,
    );
    const rawFrequency = Number(settings[this.PAYROLL_FREQUENCY_KEY]);
    const payrollFrequencyDays: 15 | 30 = rawFrequency === 15 ? 15 : 30;

    return { salaryByPosition, allowanceByPosition, payrollFrequencyDays };
  }

  async upsertPayrollFrequency(
    pawnshopId: string,
    payrollFrequencyDays: number,
  ): Promise<{ payrollFrequencyDays: 15 | 30 }> {
    if (payrollFrequencyDays !== 15 && payrollFrequencyDays !== 30) {
      throw new BadRequestException('Payroll frequency must be either 15 or 30 days');
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const settings =
      (pawnshop.settings as Record<string, unknown> | null) !== null
        ? ((pawnshop.settings as Record<string, unknown>) ?? {})
        : {};

    await this.prisma.pawnshop.update({
      where: { id: pawnshopId },
      data: {
        settings: {
          ...settings,
          [this.PAYROLL_FREQUENCY_KEY]: payrollFrequencyDays,
        },
      },
    });

    return { payrollFrequencyDays: payrollFrequencyDays as 15 | 30 };
  }

  async upsertPositionSalary(
    pawnshopId: string,
    position: string,
    baseSalary: number,
    allowance = 0,
  ): Promise<{
    position: string;
    baseSalary: number;
    allowance: number;
    salaryByPosition: Record<string, number>;
    allowanceByPosition: Record<string, number>;
  }> {
    if (!Number.isFinite(baseSalary) || baseSalary < 0) {
      throw new BadRequestException('Base salary must be a non-negative number');
    }
    if (!Number.isFinite(allowance) || allowance < 0) {
      throw new BadRequestException('Allowance must be a non-negative number');
    }

    const normalizedPosition = this.normalizePosition(position);
    if (!normalizedPosition) {
      throw new BadRequestException('Position is required');
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const settings =
      (pawnshop.settings as Record<string, unknown> | null) !== null
        ? ((pawnshop.settings as Record<string, unknown>) ?? {})
        : {};
    const existingMap =
      (settings[this.PAYROLL_SETTINGS_KEY] as Record<string, unknown> | undefined) ||
      {};
    const existingAllowanceMap =
      (settings[this.PAYROLL_ALLOWANCE_SETTINGS_KEY] as
        | Record<string, unknown>
        | undefined) || {};

    const nextMap: Record<string, number> = {};
    for (const [key, value] of Object.entries(existingMap)) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      nextMap[this.normalizePosition(key)] = amount;
    }

    const nextAllowanceMap: Record<string, number> = {};
    for (const [key, value] of Object.entries(existingAllowanceMap)) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      nextAllowanceMap[this.normalizePosition(key)] = amount;
    }

    nextMap[normalizedPosition] = baseSalary;
    nextAllowanceMap[normalizedPosition] = allowance;

    await this.prisma.pawnshop.update({
      where: { id: pawnshopId },
      data: {
        settings: {
          ...settings,
          [this.PAYROLL_SETTINGS_KEY]: nextMap,
          [this.PAYROLL_ALLOWANCE_SETTINGS_KEY]: nextAllowanceMap,
        },
      },
    });

    return {
      position: normalizedPosition,
      baseSalary,
      allowance,
      salaryByPosition: nextMap,
      allowanceByPosition: nextAllowanceMap,
    };
  }

  /**
   * Generate payslip using attendance data
   */
  async generatePayslip(
    pawnshopId: string,
    dto: GeneratePayslipDto,
  ): Promise<any> {
    try {
      // Check for existing payslip
      const existing = await this.prisma.payslip.findUnique({
        where: {
          staffId_pawnshopId_periodStart_periodEnd: {
            staffId: dto.staffId,
            pawnshopId,
            periodStart: new Date(dto.periodStart),
            periodEnd: new Date(dto.periodEnd),
          },
        },
      });

      if (existing) {
        throw new BadRequestException('Payslip already exists for this period');
      }

      // Get attendance records for the period
      const attendanceRecords = await this.prisma.attendanceRecord.findMany({
        where: {
          staffId: dto.staffId,
          pawnshopId,
          date: {
            gte: new Date(dto.periodStart),
            lte: new Date(dto.periodEnd),
          },
        },
      });

      // Calculate work statistics
      const daysWorked = attendanceRecords.filter(
        (r) => r.status === AttendanceStatus.PRESENT,
      ).length;
      const daysAbsent = attendanceRecords.filter(
        (r) => r.status === AttendanceStatus.ABSENT,
      ).length;
      const daysLate = attendanceRecords.filter((r) => r.isLate).length;
      const totalWorkHours = attendanceRecords.reduce(
        (sum, r) => sum + (r.workHours || 0),
        0,
      );
      const totalOvertimeHours = attendanceRecords.reduce(
        (sum, r) => sum + (r.overtimeHours || 0),
        0,
      );
      const totalLateMinutes = attendanceRecords.reduce(
        (sum, r) => sum + (r.lateMinutes || 0),
        0,
      );

      // Calculate earnings
      const baseSalary = dto.baseSalary;
      const overtimePay =
        totalOvertimeHours * (baseSalary / 160) * this.OVERTIME_MULTIPLIER; // 160 = standard monthly hours
      const allowances = dto.allowances || 0;
      const bonuses = dto.bonuses || 0;
      const grossPay = baseSalary + overtimePay + allowances + bonuses;

      // Calculate deductions
      const tax = this.calculateTax(grossPay);
      const sss = Math.min(baseSalary * this.SSS_RATE, 900); // Max SSS employee share
      const philhealth = baseSalary * this.PHILHEALTH_RATE;
      const pagibig = this.PAGIBIG_FIXED;
      const lateDeductions = totalLateMinutes * this.LATE_DEDUCTION_PER_MINUTE;
      const otherDeductions = dto.otherDeductions || 0;
      const totalDeductions =
        tax + sss + philhealth + pagibig + lateDeductions + otherDeductions;

      // Net pay
      const netPay = grossPay - totalDeductions;

      // Create payslip
      const payslip = await this.prisma.payslip.create({
        data: {
          staffId: dto.staffId,
          pawnshopId,
          branchId: dto.branchId,
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          baseSalary,
          overtimePay,
          allowances,
          bonuses,
          grossPay,
          tax,
          sss,
          philhealth,
          pagibig,
          lateDeductions,
          otherDeductions,
          totalDeductions,
          netPay,
          daysWorked,
          daysAbsent,
          daysLate,
          overtimeHours: totalOvertimeHours,
          status: PayslipStatus.DRAFT,
        },
      });

      this.logger.log(
        `Payslip generated for staff ${dto.staffId} - Net Pay: ₱${netPay.toFixed(2)}`,
      );

      return payslip;
    } catch (error: any) {
      this.logger.error(
        `Failed to generate payslip: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Calculate Philippine income tax (simplified BIR tax table)
   */
  private calculateTax(monthlyIncome: number): number {
    // Monthly income tax brackets (2023 TRAIN law)
    if (monthlyIncome <= 20833) return 0;
    if (monthlyIncome <= 33333) return (monthlyIncome - 20833) * 0.15;
    if (monthlyIncome <= 66667) return 1875 + (monthlyIncome - 33333) * 0.2;
    if (monthlyIncome <= 166667) return 8541.8 + (monthlyIncome - 66667) * 0.25;
    if (monthlyIncome <= 666667)
      return 33541.8 + (monthlyIncome - 166667) * 0.3;
    return 183541.8 + (monthlyIncome - 666667) * 0.35;
  }

  /**
   * Get payslips with filters
   */
  async findAll(
    pawnshopId: string,
    staffId?: string,
    status?: PayslipStatus | string,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const where: any = { pawnshopId };
      if (staffId) where.staffId = staffId;

      const normalizedStatus =
        typeof status === 'string' ? status.trim().toUpperCase() : status;
      if (
        normalizedStatus &&
        Object.values(PayslipStatus).includes(normalizedStatus as PayslipStatus)
      ) {
        where.status = normalizedStatus;
      }

      const normalizedBranchId = this.normalizeBranchId(branchId);
      if (normalizedBranchId !== undefined) {
        where.branchId = normalizedBranchId;
      }

      const payslips = await this.prisma.payslip.findMany({
        where,
        orderBy: {
          periodStart: 'desc',
        },
      });

      return payslips;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch payslips: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get a specific payslip
   */
  async findOne(pawnshopId: string, id: string): Promise<any> {
    const payslip = await this.prisma.payslip.findFirst({
      where: {
        id,
        pawnshopId,
      },
    });

    if (!payslip) {
      throw new NotFoundException('Payslip not found');
    }

    return payslip;
  }

  async getPrintablePayslip(pawnshopId: string, id: string): Promise<any> {
    const payslip = await this.findOne(pawnshopId, id);
    const staff = await this.prisma.profile.findUnique({
      where: { id: payslip.staffId },
      select: { fullName: true, email: true, role: true },
    });

    return {
      ...payslip,
      staffName: staff?.fullName || staff?.email || payslip.staffId,
      staffEmail: staff?.email || null,
      position: staff?.role || null,
      generatedAt: new Date(),
      printable: true,
    };
  }

  /**
   * Approve payslip (manager/owner)
   */
  async approve(
    pawnshopId: string,
    id: string,
    approvedBy: string,
  ): Promise<any> {
    try {
      const payslip = await this.findOne(pawnshopId, id);

      if (
        payslip.status !== PayslipStatus.DRAFT &&
        payslip.status !== PayslipStatus.PENDING_APPROVAL
      ) {
        throw new BadRequestException(
          `Cannot approve payslip in ${payslip.status} status`,
        );
      }

      const updated = await this.prisma.payslip.update({
        where: { id },
        data: {
          status: PayslipStatus.APPROVED,
          approvedBy,
          approvedAt: new Date(),
        },
      });

      this.logger.log(`Payslip ${id} approved by ${approvedBy}`);

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to approve payslip: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Reject payslip
   */
  async reject(
    pawnshopId: string,
    id: string,
    rejectedBy: string,
    reason?: string,
  ): Promise<any> {
    try {
      const payslip = await this.findOne(pawnshopId, id);

      if (payslip.status === PayslipStatus.PAID) {
        throw new BadRequestException('Cannot reject a paid payslip');
      }
      if (payslip.status === PayslipStatus.CANCELLED) {
        throw new BadRequestException('Payslip is already rejected');
      }

      const updated = await this.prisma.payslip.update({
        where: { id },
        data: {
          status: PayslipStatus.CANCELLED,
          notes: reason
            ? `${payslip.notes ? `${payslip.notes}\n` : ''}Rejected by ${rejectedBy}: ${reason}`
            : payslip.notes,
        },
      });

      this.logger.log(`Payslip ${id} rejected by ${rejectedBy}`);
      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to reject payslip: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Mark payslip as paid
   */
  async markAsPaid(
    pawnshopId: string,
    id: string,
    paidBy: string,
  ): Promise<any> {
    try {
      const payslip = await this.findOne(pawnshopId, id);

      if (payslip.status !== PayslipStatus.APPROVED) {
        throw new BadRequestException('Can only pay approved payslips');
      }

      const updated = await this.prisma.payslip.update({
        where: { id },
        data: {
          status: PayslipStatus.PAID,
          paidBy,
          paidAt: new Date(),
          paymentDate: new Date(),
        },
      });

      // Record salary payment in finance ledger
      try {
        const staff = await this.prisma.profile.findUnique({
          where: { id: payslip.staffId },
          select: { fullName: true, email: true },
        });
        const staffLabel = staff?.fullName || staff?.email || payslip.staffId;
        const periodLabel = `${new Date(payslip.periodStart).toLocaleDateString()} - ${new Date(payslip.periodEnd).toLocaleDateString()}`;

        await this.financeService.createEntry(pawnshopId, {
          entryType: LedgerEntryType.DEBIT,
          category: LedgerCategory.SALARY_PAYMENT,
          amount: payslip.netPay,
          description: `Salary payment: ${staffLabel} (${periodLabel}) — Net ₱${payslip.netPay.toLocaleString()}`,
          performedBy: paidBy,
          referenceType: 'PAYSLIP',
          referenceId: payslip.id,
          counterparty: staffLabel,
          paymentMethod: 'CASH',
        });
        this.logger.log(`Finance ledger entry created for payslip ${id}`);
      } catch (finErr: any) {
        this.logger.warn(
          `Payslip ${id} paid but ledger entry failed: ${finErr.message}`,
        );
      }

      this.logger.log(`Payslip ${id} marked as paid by ${paidBy}`);

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to mark payslip as paid: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Generate payslips for all staff in a pawnshop
   */
  async generateBulkPayslips(
    pawnshopId: string,
    periodStart: string,
    periodEnd: string,
    salaryMap: Record<string, number>, // staffId -> baseSalary
  ): Promise<any> {
    try {
      const results = {
        success: [] as string[],
        failed: [] as { staffId: string; error: string }[],
      };

      for (const [staffId, baseSalary] of Object.entries(salaryMap)) {
        try {
          await this.generatePayslip(pawnshopId, {
            staffId,
            periodStart,
            periodEnd,
            baseSalary,
          });
          results.success.push(staffId);
        } catch (error: any) {
          results.failed.push({ staffId, error: error.message });
        }
      }

      this.logger.log(
        `Bulk payslip generation: ${results.success.length} success, ${results.failed.length} failed`,
      );

      return results;
    } catch (error: any) {
      this.logger.error(
        `Failed bulk payslip generation: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async generateAutomaticPayslips(
    pawnshopId: string,
    periodStart: string,
    periodEnd: string,
    branchId?: number | string,
  ): Promise<any> {
    const normalizedBranchId = this.normalizeBranchId(branchId);
    const salaryByPosition = await this.getPayrollSettingsMap(pawnshopId);
    const allowanceByPosition = await this.getPayrollAllowanceSettingsMap(
      pawnshopId,
    );
    const staffList = await this.prisma.profile.findMany({
      where: {
        pawnshopId,
        role: { notIn: ['BIDDER'] },
        ...(normalizedBranchId !== undefined
          ? { branchId: String(normalizedBranchId) }
          : {}),
      },
      select: {
        id: true,
        role: true,
        fullName: true,
        email: true,
      },
    });

    const result = {
      generated: [] as string[],
      skippedNoSalarySetting: [] as string[],
      failed: [] as { staffId: string; error: string }[],
      salaryByPosition,
      allowanceByPosition,
    };

    for (const staff of staffList) {
      const position = this.normalizePosition(staff.role || 'STAFF');
      const baseSalary = salaryByPosition[position];
      const allowances = Number(allowanceByPosition[position] || 0);

      if (!Number.isFinite(baseSalary)) {
        result.skippedNoSalarySetting.push(
          `${staff.fullName || staff.email || staff.id} (${position})`,
        );
        continue;
      }

      try {
        await this.generatePayslip(pawnshopId, {
          staffId: staff.id,
          periodStart,
          periodEnd,
          baseSalary,
          allowances,
          branchId: normalizedBranchId,
        });
        result.generated.push(staff.id);
      } catch (error: any) {
        result.failed.push({
          staffId: staff.id,
          error: error.message,
        });
      }
    }

    return result;
  }

  /**
   * Get payroll summary for a period
   */
  async getPayrollSummary(
    pawnshopId: string,
    periodStart: string,
    periodEnd: string,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);
      const periodStartDate = new Date(periodStart);
      const periodEndDate = new Date(periodEnd);

      if (Number.isNaN(periodStartDate.getTime()) || Number.isNaN(periodEndDate.getTime())) {
        throw new BadRequestException('Invalid payroll period dates');
      }

      const payslips = await this.prisma.payslip.findMany({
        where: {
          pawnshopId,
          ...(normalizedBranchId !== undefined
            ? { branchId: normalizedBranchId }
            : {}),
          // Include payslips that overlap the selected summary window.
          periodStart: { lte: periodEndDate },
          periodEnd: { gte: periodStartDate },
        },
      });

      const summary = {
        totalStaff: payslips.length,
        totalGrossPay: payslips.reduce((sum, p) => sum + p.grossPay, 0),
        totalDeductions: payslips.reduce(
          (sum, p) => sum + p.totalDeductions,
          0,
        ),
        totalNetPay: payslips.reduce((sum, p) => sum + p.netPay, 0),
        totalOvertimePay: payslips.reduce((sum, p) => sum + p.overtimePay, 0),
        totalLateDeductions: payslips.reduce(
          (sum, p) => sum + p.lateDeductions,
          0,
        ),
        totalTax: payslips.reduce((sum, p) => sum + p.tax, 0),
        totalSSS: payslips.reduce((sum, p) => sum + p.sss, 0),
        totalPhilhealth: payslips.reduce((sum, p) => sum + p.philhealth, 0),
        totalPagibig: payslips.reduce((sum, p) => sum + p.pagibig, 0),
        byStatus: {
          draft: payslips.filter((p) => p.status === PayslipStatus.DRAFT)
            .length,
          approved: payslips.filter((p) => p.status === PayslipStatus.APPROVED)
            .length,
          paid: payslips.filter((p) => p.status === PayslipStatus.PAID).length,
        },
      };

      return {
        ...summary,
        // Frontend-friendly aliases
        totalGross: summary.totalGrossPay,
        totalNet: summary.totalNetPay,
        totalPhilHealth: summary.totalPhilhealth,
        totalPagIBIG: summary.totalPagibig,
        payslipCount: summary.totalStaff,
        draftCount: summary.byStatus.draft,
        approvedCount: summary.byStatus.approved,
        paidCount: summary.byStatus.paid,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get payroll summary: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
