import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateLedgerEntryDto } from './dto/create-ledger-entry.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { LedgerEntryType, LedgerCategory } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { calculatePawnCharges } from './pawn-charge-calculator';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);
  private readonly LEDGER_REQUESTS_SETTINGS_KEY = 'ledgerApprovalRequests';
  private readonly SYSTEM_ACTORS = new Set([
    'system',
    'paymongo',
    '00000000-0000-0000-0000-000000000000',
  ]);
  private readonly APPROVER_ROLES = new Set(['MANAGER', 'OWNER']);

  /**
   * Backfill ledger entries for historically redeemed tickets that have no ledger record.
   */
  async backfillRedeemedTickets(): Promise<{
    backfilled: number;
    skipped: number;
    details: any[];
  }> {
    // Find all redeemed tickets
    const redeemedTickets = await this.prisma.ticket.findMany({
      where: { status: 'REDEEMED' },
      include: { customer: true },
    });

    this.logger.log(
      `Found ${redeemedTickets.length} redeemed tickets (pawnshopIds: ${redeemedTickets.map((t) => t.pawnshopId).join(', ')})`,
    );

    // Filter to those with pawnshopId
    const eligible = redeemedTickets.filter((t) => t.pawnshopId);

    // Find existing ledger entries referencing tickets
    const existingEntries =
      eligible.length > 0
        ? await this.prisma.cashLedgerEntry.findMany({
            where: {
              referenceType: 'TICKET',
              referenceId: { in: eligible.map((t) => String(t.id)) },
            },
            select: { referenceId: true },
          })
        : [];
    const alreadyRecorded = new Set(existingEntries.map((e) => e.referenceId));

    // Use a nil UUID for system-generated entries
    const systemActor = '00000000-0000-0000-0000-000000000000';

    let backfilled = 0;
    let skipped = 0;
    const details: any[] = [];

    for (const ticket of eligible) {
      if (alreadyRecorded.has(String(ticket.id))) {
        skipped++;
        continue;
      }

      const charges = calculatePawnCharges({
        principal: ticket.loanAmount,
        monthlyInterestRatePercent: ticket.interestRate || 3,
        serviceFee: 50,
      });
      const customerName = ticket.customer?.fullName || 'Customer';

      try {
        // Loan repayment
        await this.createEntry(ticket.pawnshopId, {
          entryType: LedgerEntryType.CREDIT,
          category: LedgerCategory.LOAN_REPAYMENT,
          amount: charges.principal,
          description: `[Backfill] Loan repayment: ${customerName} redeemed Ticket #${ticket.ticketNumber}`,
          performedBy: systemActor,
          referenceType: 'TICKET',
          referenceId: String(ticket.id),
          counterparty: customerName,
          paymentMethod: 'CASH',
        });

        // Interest
        if (charges.interest > 0) {
          await this.createEntry(ticket.pawnshopId, {
            entryType: LedgerEntryType.CREDIT,
            category: LedgerCategory.FEE_COLLECTION,
            amount: charges.interest,
            description: `[Backfill] Interest (${ticket.interestRate}%): ${customerName} - Ticket #${ticket.ticketNumber}`,
            performedBy: systemActor,
            referenceType: 'TICKET',
            referenceId: String(ticket.id),
            counterparty: customerName,
            paymentMethod: 'CASH',
          });
        }

        // Service fee
        await this.createEntry(ticket.pawnshopId, {
          entryType: LedgerEntryType.CREDIT,
          category: LedgerCategory.FEE_COLLECTION,
          amount: charges.serviceFee,
          description: `[Backfill] Service fee: ${customerName} - Ticket #${ticket.ticketNumber}`,
          performedBy: systemActor,
          referenceType: 'TICKET',
          referenceId: String(ticket.id),
          counterparty: customerName,
          paymentMethod: 'CASH',
        });

        backfilled++;
        details.push({
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          principal: charges.principal,
          interest: charges.interest,
          serviceFee: charges.serviceFee,
          total: charges.totalDue,
        });
      } catch (err: any) {
        this.logger.error(
          `Backfill failed for ticket ${ticket.id}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `Backfill complete: ${backfilled} tickets backfilled, ${skipped} skipped`,
    );
    return { backfilled, skipped, details };
  }

  constructor(private prisma: PrismaService) {}

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

  private async getPawnshopSettings(pawnshopId: string): Promise<{
    settings: Record<string, unknown>;
  }> {
    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { settings: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const settings =
      (pawnshop.settings as Record<string, unknown> | null) || {};

    return { settings };
  }

  private async savePawnshopSettings(
    pawnshopId: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.pawnshop.update({
      where: { id: pawnshopId },
      data: { settings: settings as any },
    });
  }

  async createEntryRequest(
    pawnshopId: string,
    dto: CreateLedgerEntryDto,
  ): Promise<any> {
    const { settings } = await this.getPawnshopSettings(pawnshopId);
    const existing =
      (settings[this.LEDGER_REQUESTS_SETTINGS_KEY] as any[] | undefined) || [];

    const request = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'PENDING',
      requestedAt: new Date().toISOString(),
      requestedBy: dto.performedBy,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      payload: {
        entryType: dto.entryType,
        category: dto.category,
        amount: dto.amount,
        description: dto.description,
        performedBy: dto.performedBy,
        branchId: dto.branchId,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        counterparty: dto.counterparty,
        paymentMethod: dto.paymentMethod,
        // Receipt number will be auto-generated after approval
        receiptNumber: undefined,
      },
    };

    const next = [request, ...existing].slice(0, 500);
    await this.savePawnshopSettings(pawnshopId, {
      ...settings,
      [this.LEDGER_REQUESTS_SETTINGS_KEY]: next,
    });

    return request;
  }

  async getEntryRequests(
    pawnshopId: string,
    status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ): Promise<any[]> {
    const { settings } = await this.getPawnshopSettings(pawnshopId);
    const list =
      (settings[this.LEDGER_REQUESTS_SETTINGS_KEY] as any[] | undefined) || [];

    if (!status) return list;
    return list.filter((r) => String(r.status || '').toUpperCase() === status);
  }

  async approveEntryRequest(
    pawnshopId: string,
    requestId: string,
    approvedBy: string,
    approvalNotes?: string,
  ): Promise<any> {
    const approver = await this.prisma.profile.findFirst({
      where: { id: approvedBy, pawnshopId },
      select: { id: true, role: true },
    });

    const approverRole = String(approver?.role || '').toUpperCase();
    if (!approver || !this.APPROVER_ROLES.has(approverRole)) {
      throw new BadRequestException('Only manager/owner can approve requests');
    }

    const { settings } = await this.getPawnshopSettings(pawnshopId);
    const list =
      (settings[this.LEDGER_REQUESTS_SETTINGS_KEY] as any[] | undefined) || [];
    const target = list.find((r) => r.id === requestId);

    if (!target) {
      throw new NotFoundException('Ledger request not found');
    }
    if (String(target.status).toUpperCase() !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be approved');
    }

    const payload = target.payload || {};
    const entry = await this.createEntry(pawnshopId, {
      ...payload,
      approvedBy,
      approvalNotes,
    });

    const updated = list.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'APPROVED',
            approvedBy,
            approvedAt: new Date().toISOString(),
            approvalNotes: approvalNotes || null,
            ledgerEntryId: entry.id,
          }
        : r,
    );

    await this.savePawnshopSettings(pawnshopId, {
      ...settings,
      [this.LEDGER_REQUESTS_SETTINGS_KEY]: updated,
    });

    return {
      requestId,
      status: 'APPROVED',
      ledgerEntry: entry,
    };
  }

  async rejectEntryRequest(
    pawnshopId: string,
    requestId: string,
    rejectedBy: string,
    reason?: string,
  ): Promise<any> {
    const approver = await this.prisma.profile.findFirst({
      where: { id: rejectedBy, pawnshopId },
      select: { id: true, role: true },
    });

    const approverRole = String(approver?.role || '').toUpperCase();
    if (!approver || !this.APPROVER_ROLES.has(approverRole)) {
      throw new BadRequestException('Only manager/owner can reject requests');
    }

    const { settings } = await this.getPawnshopSettings(pawnshopId);
    const list =
      (settings[this.LEDGER_REQUESTS_SETTINGS_KEY] as any[] | undefined) || [];
    const target = list.find((r) => r.id === requestId);

    if (!target) {
      throw new NotFoundException('Ledger request not found');
    }
    if (String(target.status).toUpperCase() !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be rejected');
    }

    const updated = list.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'REJECTED',
            rejectedBy,
            rejectedAt: new Date().toISOString(),
            rejectionReason: reason || null,
          }
        : r,
    );

    await this.savePawnshopSettings(pawnshopId, {
      ...settings,
      [this.LEDGER_REQUESTS_SETTINGS_KEY]: updated,
    });

    return {
      requestId,
      status: 'REJECTED',
    };
  }

  /**
   * Create an immutable ledger entry
   * This is the ONLY way to record financial transactions
   */
  async createEntry(
    pawnshopId: string,
    dto: CreateLedgerEntryDto,
  ): Promise<any> {
    try {
      const performedBy = String(dto.performedBy || '').trim();
      if (!performedBy) {
        throw new BadRequestException('performedBy is required');
      }

      const isSystemActor = this.SYSTEM_ACTORS.has(performedBy.toLowerCase());
      if (!isSystemActor) {
        const performer = await this.prisma.profile.findFirst({
          where: { id: performedBy, pawnshopId },
          select: { id: true, role: true, fullName: true },
        });

        if (!performer) {
          throw new BadRequestException('performer profile not found');
        }

        const performerRole = String(performer.role || '').toUpperCase();
        const isPerformerApprover = this.APPROVER_ROLES.has(performerRole);

        if (!isPerformerApprover) {




            throw new BadRequestException('Ledger entry requires manager/owner approval');
        }
      }

      // Get current balance (last entry's balance)
      const lastEntry = await this.prisma.cashLedgerEntry.findFirst({
        where: {
          pawnshopId,
          branchId: dto.branchId,
        },
        orderBy: {
          recordedAt: 'desc',
        },
      });

      const balanceBefore = lastEntry?.balanceAfter || 0;

      // Calculate new balance based on entry type
      let balanceAfter: number;
      if (dto.entryType === LedgerEntryType.CREDIT) {
        balanceAfter = balanceBefore + dto.amount;
      } else {
        balanceAfter = balanceBefore - dto.amount;
      }

      // Prevent negative balance for operational cash (configurable)
      if (balanceAfter < 0 && dto.category !== LedgerCategory.ADJUSTMENT) {
        throw new BadRequestException(
          `Insufficient balance. Current: ₱${balanceBefore.toFixed(2)}, Requested: ₱${dto.amount.toFixed(2)}`,
        );
      }

      // Generate sequential entry number
      const entryNumber = await this.generateEntryNumber(pawnshopId);

      // Create immutable entry
      const entry = await this.prisma.cashLedgerEntry.create({
        data: {
          pawnshopId,
          branchId: dto.branchId,
          entryNumber,
          entryType: dto.entryType,
          category: dto.category,
          amount: dto.amount,
          balanceBefore,
          balanceAfter,
          description: dto.description,
          performedBy: isSystemActor
            ? '00000000-0000-0000-0000-000000000000'
            : performedBy,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          counterparty: dto.counterparty,
          paymentMethod: dto.paymentMethod,
          // Receipt number will be auto-generated after approval
          receiptNumber: undefined,
          ipAddress: dto.ipAddress,
          deviceInfo: dto.deviceInfo,
        },
      });

      this.logger.log(
        `Ledger entry ${entryNumber} created: ${dto.entryType} ₱${dto.amount} - Balance: ₱${balanceAfter}`,
      );

      return entry;
    } catch (error: any) {
      this.logger.error(
        `Failed to create ledger entry: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Generate sequential entry number
   * Format: LEDGER-YYYY-NNNNN
   */
  private async generateEntryNumber(pawnshopId: string): Promise<string> {
    const year = new Date().getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year + 1, 0, 1);

    const count = await this.prisma.cashLedgerEntry.count({
      where: {
        pawnshopId,
        recordedAt: {
          gte: startOfYear,
          lt: endOfYear,
        },
      },
    });

    const sequential = (count + 1).toString().padStart(5, '0');
    return `LEDGER-${year}-${sequential}`;
  }

  /**
   * Get ledger entries with filters
   */
  async findAll(pawnshopId: string, query: LedgerQueryDto): Promise<any> {
    try {
      const where: any = { pawnshopId };

      if (query.branchId) where.branchId = query.branchId;
      if (query.category) where.category = query.category;
      if (query.referenceType) where.referenceType = query.referenceType;

      if (query.dateFrom || query.dateTo) {
        where.transactionDate = {};
        if (query.dateFrom)
          where.transactionDate.gte = new Date(query.dateFrom);
        if (query.dateTo) where.transactionDate.lte = new Date(query.dateTo);
      }

      const [entries, total] = await Promise.all([
        this.prisma.cashLedgerEntry.findMany({
          where,
          orderBy: {
            transactionDate: 'desc',
          },
          skip: query.offset,
          take: query.limit,
        }),
        this.prisma.cashLedgerEntry.count({ where }),
      ]);

      return {
        data: entries,
        meta: {
          total,
          limit: query.limit,
          offset: query.offset,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch ledger entries: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get a specific ledger entry (read-only)
   */
  async findOne(pawnshopId: string, id: string): Promise<any> {
    const entry = await this.prisma.cashLedgerEntry.findFirst({
      where: {
        id,
        pawnshopId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Ledger entry not found');
    }

    return entry;
  }

  /**
   * Get current balance
   */
  async getCurrentBalance(
    pawnshopId: string,
    branchId?: number | string,
  ): Promise<number> {
    const normalizedBranchId = this.normalizeBranchId(branchId);
    const lastEntry = await this.prisma.cashLedgerEntry.findFirst({
      where: {
        pawnshopId,
        ...(normalizedBranchId !== undefined
          ? { branchId: normalizedBranchId }
          : {}),
      },
      orderBy: {
        recordedAt: 'desc',
      },
    });

    return lastEntry?.balanceAfter || 0;
  }

  /**
   * Get financial summary
   */
  async getSummary(
    pawnshopId: string,
    dateFrom?: Date,
    dateTo?: Date,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);
      const where: any = { pawnshopId };
      if (normalizedBranchId !== undefined) where.branchId = normalizedBranchId;

      if (dateFrom || dateTo) {
        where.transactionDate = {};
        if (dateFrom) where.transactionDate.gte = dateFrom;
        if (dateTo) where.transactionDate.lte = dateTo;
      }

      const [currentBalance, totals] = await Promise.all([
        this.getCurrentBalance(pawnshopId, normalizedBranchId),
        this.prisma.cashLedgerEntry.groupBy({
          by: ['entryType', 'category'],
          where,
          _sum: {
            amount: true,
          },
          _count: true,
        }),
      ]);

      const summary = {
        currentBalance,
        totalDebit: 0,
        totalCredit: 0,
        transactionCount: 0,
        byCategory: {} as Record<string, any>,
      };

      for (const item of totals) {
        const amount = item._sum.amount || 0;
        const count = item._count;

        if (item.entryType === LedgerEntryType.DEBIT) {
          summary.totalDebit += amount;
        } else {
          summary.totalCredit += amount;
        }

        summary.transactionCount += count;

        if (!summary.byCategory[item.category]) {
          summary.byCategory[item.category] = {
            debit: 0,
            credit: 0,
            count: 0,
          };
        }

        if (item.entryType === LedgerEntryType.DEBIT) {
          summary.byCategory[item.category].debit += amount;
        } else {
          summary.byCategory[item.category].credit += amount;
        }
        summary.byCategory[item.category].count += count;
      }

      return summary;
    } catch (error: any) {
      this.logger.error(`Failed to get summary: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Initiate daily reconciliation
   */
  async createDailyReconciliation(
    pawnshopId: string,
    branchId: number | null,
    physicalCash?: number,
  ): Promise<any> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if reconciliation already exists for today
      const existing = await this.prisma.dailyReconciliation.findFirst({
        where: {
          pawnshopId,
          branchId,
          reconciliationDate: today,
        },
      });

      if (existing) {
        throw new BadRequestException(
          'Reconciliation already exists for this date',
        );
      }

      // Get opening balance (closing balance of previous day)
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const previousRecon = await this.prisma.dailyReconciliation.findFirst({
        where: {
          pawnshopId,
          branchId,
          reconciliationDate: yesterday,
        },
      });

      const openingBalance = previousRecon?.closingBalance || 0;

      // Calculate today's transactions
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayTransactions = await this.prisma.cashLedgerEntry.findMany({
        where: {
          pawnshopId,
          branchId,
          transactionDate: {
            gte: today,
            lt: tomorrow,
          },
        },
      });

      const totalDebit = todayTransactions
        .filter((t) => t.entryType === LedgerEntryType.DEBIT)
        .reduce((sum, t) => sum + t.amount, 0);

      const totalCredit = todayTransactions
        .filter((t) => t.entryType === LedgerEntryType.CREDIT)
        .reduce((sum, t) => sum + t.amount, 0);

      const systemBalance = openingBalance + totalCredit - totalDebit;
      const variance =
        physicalCash !== undefined ? physicalCash - systemBalance : null;

      const reconciliation = await this.prisma.dailyReconciliation.create({
        data: {
          pawnshopId,
          branchId,
          reconciliationDate: today,
          openingBalance,
          closingBalance: systemBalance,
          systemBalance,
          physicalCash,
          variance,
          totalDebit,
          totalCredit,
          transactionCount: todayTransactions.length,
        },
      });

      this.logger.log(
        `Daily reconciliation created for ${today.toISOString().split('T')[0]} - Variance: ${variance !== null ? '₱' + variance.toFixed(2) : 'N/A'}`,
      );

      return reconciliation;
    } catch (error: any) {
      this.logger.error(
        `Failed to create reconciliation: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Mark reconciliation as complete
   */
  async completeReconciliation(
    pawnshopId: string,
    reconciliationId: string,
    reconciledBy: string,
    notes?: string,
  ): Promise<any> {
    const reconciliation = await this.prisma.dailyReconciliation.findFirst({
      where: {
        id: reconciliationId,
        pawnshopId,
      },
    });

    if (!reconciliation) {
      throw new NotFoundException('Reconciliation not found');
    }

    const updated = await this.prisma.dailyReconciliation.update({
      where: { id: reconciliationId },
      data: {
        isReconciled: true,
        reconciledBy,
        reconciledAt: new Date(),
        notes,
      },
    });

    this.logger.log(
      `Reconciliation ${reconciliationId} completed by ${reconciledBy}`,
    );

    return updated;
  }

  /**
   * Auto-create daily reconciliations at end of day
   * Runs at 11:59 PM daily
   */
  @Cron('59 23 * * *')
  async autoCreateDailyReconciliations(): Promise<void> {
    try {
      // Get all active pawnshops
      const pawnshops = await this.prisma.pawnshop.findMany({
        where: { isActive: true },
        include: { branches: true },
      });

      for (const pawnshop of pawnshops) {
        // Reconcile main pawnshop
        try {
          await this.createDailyReconciliation(pawnshop.id, null);
        } catch (error: any) {
          this.logger.warn(
            `Skipping reconciliation for pawnshop ${pawnshop.id}: ${error.message}`,
          );
        }

        // Reconcile each branch
        for (const branch of pawnshop.branches) {
          try {
            await this.createDailyReconciliation(pawnshop.id, branch.id);
          } catch (error: any) {
            this.logger.warn(
              `Skipping reconciliation for branch ${branch.id}: ${error.message}`,
            );
          }
        }
      }

      this.logger.log('Auto-created daily reconciliations completed');
    } catch (error: any) {
      this.logger.error(
        `Failed to auto-create reconciliations: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Treasury dashboard: combines balance, ledger summary, payroll totals, attendance overview
   */
  async getTreasuryDashboard(
    pawnshopId: string,
    dateFrom?: Date,
    dateTo?: Date,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);
      const now = new Date();
      const monthStart =
        dateFrom || new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd =
        dateTo ||
        new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      // 1. Current balance
      const currentBalance = await this.getCurrentBalance(
        pawnshopId,
        normalizedBranchId,
      );

      // 2. Ledger entries for the period grouped by category
      const ledgerEntries = await this.prisma.cashLedgerEntry.findMany({
        where: {
          pawnshopId,
          ...(normalizedBranchId !== undefined
            ? { branchId: normalizedBranchId }
            : {}),
          transactionDate: { gte: monthStart, lte: monthEnd },
        },
        orderBy: { transactionDate: 'desc' },
      });

      let totalInflow = 0;
      let totalOutflow = 0;
      const byCategory: Record<
        string,
        { inflow: number; outflow: number; count: number }
      > = {};

      for (const entry of ledgerEntries) {
        const cat = entry.category;
        if (!byCategory[cat])
          byCategory[cat] = { inflow: 0, outflow: 0, count: 0 };
        byCategory[cat].count++;

        if (entry.entryType === LedgerEntryType.CREDIT) {
          totalInflow += entry.amount;
          byCategory[cat].inflow += entry.amount;
        } else {
          totalOutflow += entry.amount;
          byCategory[cat].outflow += entry.amount;
        }
      }

      // 3. Payroll totals for the period
      const payslips = await this.prisma.payslip.findMany({
        where: {
          pawnshopId,
          ...(normalizedBranchId !== undefined
            ? { branchId: normalizedBranchId }
            : {}),
          periodStart: { gte: monthStart },
          periodEnd: { lte: monthEnd },
        },
      });

      const payroll = {
        totalGrossPay: payslips.reduce((s, p) => s + p.grossPay, 0),
        totalNetPay: payslips.reduce((s, p) => s + p.netPay, 0),
        totalDeductions: payslips.reduce((s, p) => s + p.totalDeductions, 0),
        totalTax: payslips.reduce((s, p) => s + p.tax, 0),
        totalSSS: payslips.reduce((s, p) => s + p.sss, 0),
        totalPhilhealth: payslips.reduce((s, p) => s + p.philhealth, 0),
        totalPagibig: payslips.reduce((s, p) => s + p.pagibig, 0),
        totalLateDeductions: payslips.reduce((s, p) => s + p.lateDeductions, 0),
        totalOvertimePay: payslips.reduce((s, p) => s + p.overtimePay, 0),
        payslipCount: payslips.length,
        paidCount: payslips.filter((p) => p.status === 'PAID').length,
        pendingCount: payslips.filter(
          (p) => p.status !== 'PAID' && p.status !== 'CANCELLED',
        ).length,
      };

      // 4. Attendance stats for the month
      const attendanceRecords = await this.prisma.attendanceRecord.findMany({
        where: {
          pawnshopId,
          ...(normalizedBranchId !== undefined
            ? { branchId: normalizedBranchId }
            : {}),
          date: { gte: monthStart, lte: monthEnd },
        },
      });

      const attendance = {
        totalRecords: attendanceRecords.length,
        present: attendanceRecords.filter((r) => r.status === 'PRESENT').length,
        absent: attendanceRecords.filter((r) => r.status === 'ABSENT').length,
        late: attendanceRecords.filter((r) => r.isLate).length,
        onLeave: attendanceRecords.filter((r) => r.status === 'ON_LEAVE')
          .length,
        totalWorkHours: attendanceRecords.reduce(
          (s, r) => s + (r.workHours || 0),
          0,
        ),
        totalOvertimeHours: attendanceRecords.reduce(
          (s, r) => s + (r.overtimeHours || 0),
          0,
        ),
        totalLateMinutes: attendanceRecords.reduce(
          (s, r) => s + (r.lateMinutes || 0),
          0,
        ),
      };

      // 5. Loan stats for the period
      const loans = await this.prisma.loan.findMany({
        where: {
          pawnshopId,
          createdAt: { gte: monthStart, lte: monthEnd },
          ...(normalizedBranchId !== undefined
            ? { ticket: { is: { branchId: normalizedBranchId } } }
            : {}),
        },
        select: { principalAmount: true, interestAmount: true, status: true },
      });

      const loanStats = {
        totalDisbursed: loans.reduce((s, l) => s + l.principalAmount, 0),
        totalInterest: loans.reduce((s, l) => s + l.interestAmount, 0),
        activeLoans: loans.filter((l) => l.status === 'ACTIVE').length,
        totalLoans: loans.length,
      };

      // 6. Active tickets (inventory value)
      const activeTickets = await this.prisma.ticket.aggregate({
        where: {
          pawnshopId,
          status: 'ACTIVE',
          ...(normalizedBranchId !== undefined
            ? { branchId: normalizedBranchId }
            : {}),
        },
        _sum: { loanAmount: true },
        _count: true,
      });

      const inventory = {
        activeTicketCount: activeTickets._count,
        totalPawnValue: activeTickets._sum.loanAmount || 0,
      };

      // 7. Recent ledger transactions (last 20)
      const recentTransactions = ledgerEntries.slice(0, 20).map((e) => ({
        id: e.id,
        entryNumber: e.entryNumber,
        entryType: e.entryType,
        category: e.category,
        amount: e.amount,
        balanceAfter: e.balanceAfter,
        description: e.description,
        counterparty: e.counterparty,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        transactionDate: e.transactionDate,
      }));

      return {
        currentBalance,
        period: { from: monthStart, to: monthEnd },
        cashFlow: {
          totalInflow,
          totalOutflow,
          net: totalInflow - totalOutflow,
        },
        byCategory,
        payroll,
        attendance,
        loanStats,
        inventory,
        recentTransactions,
        transactionCount: ledgerEntries.length,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to get treasury dashboard: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
