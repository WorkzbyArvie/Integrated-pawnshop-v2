import { Test, TestingModule } from '@nestjs/testing';
import { FinanceService } from './finance.service';
import { PrismaService } from '../prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LedgerEntryType, LedgerCategory } from '@prisma/client';

describe('FinanceService', () => {
  let service: FinanceService;
  let prisma: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      cashLedgerEntry: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      dailyReconciliation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      pawnshop: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      profile: {
        findFirst: jest.fn(),
      },
    };

    prisma.profile.findFirst.mockResolvedValue({
      id: 'staff-uuid-1',
      role: 'OWNER',
      fullName: 'Owner User',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // createEntry()
  // ──────────────────────────────────────────────────────────────────────
  describe('createEntry', () => {
    const baseDto = {
      branchId: 1,
      entryType: LedgerEntryType.CREDIT,
      category: LedgerCategory.LOAN_REPAYMENT,
      amount: 5000,
      description: 'Loan repayment from customer',
      performedBy: 'staff-uuid-1',
    };

    it('should create a CREDIT entry and increase balance', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({
        balanceAfter: 10000,
      }); // last entry
      prisma.cashLedgerEntry.count.mockResolvedValue(42);
      prisma.cashLedgerEntry.create.mockImplementation(({ data }) => ({
        id: 'entry-1',
        ...data,
      }));

      const result = await service.createEntry(PAWNSHOP_ID, baseDto);

      expect(result.balanceBefore).toBe(10000);
      expect(result.balanceAfter).toBe(15000);
      expect(result.entryNumber).toBe('LEDGER-2026-00043');
    });

    it('should create a DEBIT entry and decrease balance', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({
        balanceAfter: 10000,
      });
      prisma.cashLedgerEntry.count.mockResolvedValue(0);
      prisma.cashLedgerEntry.create.mockImplementation(({ data }) => ({
        id: 'entry-1',
        ...data,
      }));

      const result = await service.createEntry(PAWNSHOP_ID, {
        ...baseDto,
        entryType: LedgerEntryType.DEBIT,
        amount: 3000,
      });

      expect(result.balanceBefore).toBe(10000);
      expect(result.balanceAfter).toBe(7000);
    });

    it('should start from zero when no previous entries exist', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue(null);
      prisma.cashLedgerEntry.count.mockResolvedValue(0);
      prisma.cashLedgerEntry.create.mockImplementation(({ data }) => ({
        id: 'entry-1',
        ...data,
      }));

      const result = await service.createEntry(PAWNSHOP_ID, baseDto);

      expect(result.balanceBefore).toBe(0);
      expect(result.balanceAfter).toBe(5000);
    });

    it('should reject DEBIT that causes negative balance (except ADJUSTMENT)', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({
        balanceAfter: 1000,
      });

      await expect(
        service.createEntry(PAWNSHOP_ID, {
          ...baseDto,
          entryType: LedgerEntryType.DEBIT,
          amount: 5000,
          category: LedgerCategory.LOAN_DISBURSEMENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow ADJUSTMENT entries to go negative', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({
        balanceAfter: 1000,
      });
      prisma.cashLedgerEntry.count.mockResolvedValue(0);
      prisma.cashLedgerEntry.create.mockImplementation(({ data }) => ({
        id: 'entry-1',
        ...data,
      }));

      const result = await service.createEntry(PAWNSHOP_ID, {
        ...baseDto,
        entryType: LedgerEntryType.DEBIT,
        amount: 5000,
        category: LedgerCategory.ADJUSTMENT,
      });

      expect(result.balanceAfter).toBe(-4000);
    });

    it('should generate sequential entry numbers per year', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue(null);
      prisma.cashLedgerEntry.count.mockResolvedValue(999);
      prisma.cashLedgerEntry.create.mockImplementation(({ data }) => ({
        id: 'entry-1',
        ...data,
      }));

      const result = await service.createEntry(PAWNSHOP_ID, baseDto);

      expect(result.entryNumber).toBe('LEDGER-2026-01000');
    });

    it('should require manager/owner approval for non-manager performer', async () => {
      prisma.profile.findFirst.mockResolvedValueOnce({
        id: 'staff-uuid-1',
        role: 'STAFF',
        fullName: 'Staff User',
      });
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({ balanceAfter: 10000 });

      await expect(
        service.createEntry(PAWNSHOP_ID, baseDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ledger request queue', () => {
    it('should create a pending ledger request', async () => {
      prisma.pawnshop.findUnique.mockResolvedValue({ settings: {} });
      prisma.pawnshop.update.mockResolvedValue({ id: PAWNSHOP_ID });

      const req = await service.createEntryRequest(PAWNSHOP_ID, {
        branchId: 1,
        entryType: LedgerEntryType.CREDIT,
        category: LedgerCategory.LOAN_REPAYMENT,
        amount: 1000,
        description: 'Pending entry',
        performedBy: 'staff-uuid-1',
      });

      expect(req.status).toBe('PENDING');
      expect(req.payload.amount).toBe(1000);
      expect(prisma.pawnshop.update).toHaveBeenCalled();
    });

    it('should filter requests by status', async () => {
      prisma.pawnshop.findUnique.mockResolvedValue({
        settings: {
          ledgerApprovalRequests: [
            { id: 'r1', status: 'PENDING' },
            { id: 'r2', status: 'APPROVED' },
          ],
        },
      });

      const pending = await service.getEntryRequests(PAWNSHOP_ID, 'PENDING');
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('r1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // findAll()
  // ──────────────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('should return paginated entries with correct metadata', async () => {
      const entries = [{ id: 'e1' }, { id: 'e2' }];
      prisma.cashLedgerEntry.findMany.mockResolvedValue(entries);
      prisma.cashLedgerEntry.count.mockResolvedValue(50);

      const result = await service.findAll(PAWNSHOP_ID, {
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(50);
    });

    it('should filter by category', async () => {
      prisma.cashLedgerEntry.findMany.mockResolvedValue([]);
      prisma.cashLedgerEntry.count.mockResolvedValue(0);

      await service.findAll(PAWNSHOP_ID, {
        category: LedgerCategory.AUCTION_PAYMENT,
        limit: 20,
        offset: 0,
      });

      expect(prisma.cashLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: LedgerCategory.AUCTION_PAYMENT,
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // findOne()
  // ──────────────────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('should return entry when found', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({ id: 'e1' });
      const result = await service.findOne(PAWNSHOP_ID, 'e1');
      expect(result.id).toBe('e1');
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue(null);
      await expect(service.findOne(PAWNSHOP_ID, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getCurrentBalance()
  // ──────────────────────────────────────────────────────────────────────
  describe('getCurrentBalance', () => {
    it('should return balanceAfter from the last entry', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({
        balanceAfter: 45000,
      });

      const balance = await service.getCurrentBalance(PAWNSHOP_ID);
      expect(balance).toBe(45000);
    });

    it('should return 0 when no entries exist', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue(null);

      const balance = await service.getCurrentBalance(PAWNSHOP_ID);
      expect(balance).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getSummary()
  // ──────────────────────────────────────────────────────────────────────
  describe('getSummary', () => {
    it('should aggregate debit/credit totals by category', async () => {
      prisma.cashLedgerEntry.findFirst.mockResolvedValue({
        balanceAfter: 20000,
      });
      prisma.cashLedgerEntry.groupBy.mockResolvedValue([
        {
          entryType: LedgerEntryType.CREDIT,
          category: LedgerCategory.LOAN_REPAYMENT,
          _sum: { amount: 8000 },
          _count: 4,
        },
        {
          entryType: LedgerEntryType.DEBIT,
          category: LedgerCategory.LOAN_DISBURSEMENT,
          _sum: { amount: 3000 },
          _count: 2,
        },
      ]);

      const summary = await service.getSummary(PAWNSHOP_ID);

      expect(summary.currentBalance).toBe(20000);
      expect(summary.totalCredit).toBe(8000);
      expect(summary.totalDebit).toBe(3000);
      expect(summary.transactionCount).toBe(6);
      expect(summary.byCategory[LedgerCategory.LOAN_REPAYMENT].credit).toBe(
        8000,
      );
      expect(summary.byCategory[LedgerCategory.LOAN_DISBURSEMENT].debit).toBe(
        3000,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // createDailyReconciliation()
  // ──────────────────────────────────────────────────────────────────────
  describe('createDailyReconciliation', () => {
    it('should create a reconciliation with correct computed values', async () => {
      prisma.dailyReconciliation.findFirst
        .mockResolvedValueOnce(null) // no existing today
        .mockResolvedValueOnce({ closingBalance: 10000 }); // yesterday
      prisma.cashLedgerEntry.findMany.mockResolvedValue([
        { entryType: LedgerEntryType.CREDIT, amount: 5000 },
        { entryType: LedgerEntryType.CREDIT, amount: 3000 },
        { entryType: LedgerEntryType.DEBIT, amount: 2000 },
      ]);
      prisma.dailyReconciliation.create.mockImplementation(({ data }) => ({
        id: 'recon-1',
        ...data,
      }));

      const result = await service.createDailyReconciliation(
        PAWNSHOP_ID,
        1,
        16500, // physical cash
      );

      expect(result.openingBalance).toBe(10000);
      expect(result.totalCredit).toBe(8000);
      expect(result.totalDebit).toBe(2000);
      expect(result.systemBalance).toBe(16000); // 10000 + 8000 - 2000
      expect(result.variance).toBe(500); // 16500 - 16000
      expect(result.transactionCount).toBe(3);
    });

    it('should reject duplicate reconciliation for the same day', async () => {
      prisma.dailyReconciliation.findFirst.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.createDailyReconciliation(PAWNSHOP_ID, 1),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // completeReconciliation()
  // ──────────────────────────────────────────────────────────────────────
  describe('completeReconciliation', () => {
    it('should mark reconciliation as complete', async () => {
      prisma.dailyReconciliation.findFirst.mockResolvedValue({ id: 'recon-1' });
      prisma.dailyReconciliation.update.mockResolvedValue({
        id: 'recon-1',
        isReconciled: true,
      });

      const result = await service.completeReconciliation(
        PAWNSHOP_ID,
        'recon-1',
        'staff-1',
      );

      expect(result.isReconciled).toBe(true);
    });

    it('should throw NotFoundException for unknown reconciliation', async () => {
      prisma.dailyReconciliation.findFirst.mockResolvedValue(null);

      await expect(
        service.completeReconciliation(PAWNSHOP_ID, 'bad-id', 'staff-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
