import { Test, TestingModule } from '@nestjs/testing';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { FinanceService } from '../finance/finance.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayslipStatus, AttendanceStatus } from '@prisma/client';

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: Record<string, any>;
  let attendanceService: Record<string, any>;
  let financeService: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      payslip: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      attendanceRecord: {
        findMany: jest.fn(),
      },
      profile: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      pawnshop: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    attendanceService = {};
    financeService = { createEntry: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: prisma },
        { provide: AttendanceService, useValue: attendanceService },
        { provide: FinanceService, useValue: financeService },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // generatePayslip()
  // ──────────────────────────────────────────────────────────────────────
  describe('generatePayslip', () => {
    const baseDto = {
      staffId: 'staff-1',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      baseSalary: 25000,
      branchId: 1,
      allowances: 2000,
      bonuses: 0,
    };

    it('should generate payslip with correct calculations from attendance', async () => {
      prisma.payslip.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: AttendanceStatus.PRESENT,
          isLate: false,
          workHours: 8,
          overtimeHours: 0,
          lateMinutes: 0,
        },
        {
          status: AttendanceStatus.PRESENT,
          isLate: false,
          workHours: 8,
          overtimeHours: 0,
          lateMinutes: 0,
        },
        {
          status: AttendanceStatus.PRESENT,
          isLate: true,
          workHours: 9,
          overtimeHours: 1,
          lateMinutes: 30,
        },
        {
          status: AttendanceStatus.PRESENT,
          isLate: false,
          workHours: 10,
          overtimeHours: 2,
          lateMinutes: 0,
        },
        {
          status: AttendanceStatus.ABSENT,
          isLate: false,
          workHours: null,
          overtimeHours: null,
          lateMinutes: null,
        },
      ]);
      prisma.payslip.create.mockImplementation(({ data }) => ({
        id: 'payslip-1',
        ...data,
      }));

      const result = await service.generatePayslip(PAWNSHOP_ID, baseDto);

      // Work stats
      expect(result.daysWorked).toBe(4);
      expect(result.daysAbsent).toBe(1);
      expect(result.daysLate).toBe(1);
      expect(result.overtimeHours).toBe(3);

      // Earnings
      const overtimePay = 3 * (25000 / 160) * 1.25; // OT hours × hourly rate × 1.25
      expect(result.baseSalary).toBe(25000);
      expect(result.overtimePay).toBeCloseTo(overtimePay, 2);
      expect(result.allowances).toBe(2000);
      expect(result.grossPay).toBeCloseTo(25000 + overtimePay + 2000, 2);

      // Deductions
      expect(result.sss).toBeCloseTo(Math.min(25000 * 0.045, 900), 2); // SSS cap
      expect(result.philhealth).toBeCloseTo(25000 * 0.025, 2);
      expect(result.pagibig).toBe(100);
      expect(result.lateDeductions).toBe(30 * 5); // 30 min × ₱5

      // Net pay
      expect(result.netPay).toBeCloseTo(
        result.grossPay - result.totalDeductions,
        2,
      );
    });

    it('should throw BadRequestException for duplicate payslip', async () => {
      prisma.payslip.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.generatePayslip(PAWNSHOP_ID, baseDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // calculateTax() – Philippine TRAIN law brackets
  // ──────────────────────────────────────────────────────────────────────
  describe('calculateTax (via generatePayslip)', () => {
    beforeEach(() => {
      prisma.payslip.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: AttendanceStatus.PRESENT,
          isLate: false,
          workHours: 8,
          overtimeHours: 0,
          lateMinutes: 0,
        },
      ]);
    });

    it('should apply 0% tax for income ≤ ₱20,833', async () => {
      prisma.payslip.create.mockImplementation(({ data }) => ({
        id: 'p1',
        ...data,
      }));

      const result = await service.generatePayslip(PAWNSHOP_ID, {
        staffId: 's1',
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
        baseSalary: 18000,
      });

      expect(result.tax).toBe(0);
    });

    it('should apply 15% bracket for income ₱20,834-₱33,333', async () => {
      prisma.payslip.create.mockImplementation(({ data }) => ({
        id: 'p1',
        ...data,
      }));

      const result = await service.generatePayslip(PAWNSHOP_ID, {
        staffId: 's1',
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
        baseSalary: 30000,
      });

      // grossPay = 30000 (no OT, no allowances, no bonuses)
      const expectedTax = (30000 - 20833) * 0.15;
      expect(result.tax).toBeCloseTo(expectedTax, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // approve()
  // ──────────────────────────────────────────────────────────────────────
  describe('approve', () => {
    it('should approve a DRAFT payslip', async () => {
      prisma.payslip.findFirst.mockResolvedValue({
        id: 'payslip-1',
        status: PayslipStatus.DRAFT,
      });
      prisma.payslip.update.mockResolvedValue({
        id: 'payslip-1',
        status: PayslipStatus.APPROVED,
        approvedBy: 'manager-1',
      });

      const result = await service.approve(
        PAWNSHOP_ID,
        'payslip-1',
        'manager-1',
      );

      expect(result.status).toBe(PayslipStatus.APPROVED);
    });

    it('should reject approval of PAID payslip', async () => {
      prisma.payslip.findFirst.mockResolvedValue({
        id: 'payslip-1',
        status: PayslipStatus.PAID,
      });

      await expect(
        service.approve(PAWNSHOP_ID, 'payslip-1', 'manager-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markAsPaid()
  // ──────────────────────────────────────────────────────────────────────
  describe('markAsPaid', () => {
    it('should mark APPROVED payslip as paid', async () => {
      prisma.payslip.findFirst.mockResolvedValue({
        id: 'payslip-1',
        status: PayslipStatus.APPROVED,
      });
      prisma.payslip.update.mockResolvedValue({
        id: 'payslip-1',
        status: PayslipStatus.PAID,
      });

      const result = await service.markAsPaid(
        PAWNSHOP_ID,
        'payslip-1',
        'owner-1',
      );

      expect(result.status).toBe(PayslipStatus.PAID);
    });

    it('should reject payment of non-APPROVED payslip', async () => {
      prisma.payslip.findFirst.mockResolvedValue({
        id: 'payslip-1',
        status: PayslipStatus.DRAFT,
      });

      await expect(
        service.markAsPaid(PAWNSHOP_ID, 'payslip-1', 'owner-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // generateBulkPayslips()
  // ──────────────────────────────────────────────────────────────────────
  describe('generateBulkPayslips', () => {
    it('should return success/failed counts for bulk generation', async () => {
      // First staff succeeds, second fails
      prisma.payslip.findUnique
        .mockResolvedValueOnce(null) // staff-1: no existing
        .mockResolvedValueOnce({ id: 'existing' }); // staff-2: duplicate

      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: AttendanceStatus.PRESENT,
          isLate: false,
          workHours: 8,
          overtimeHours: 0,
          lateMinutes: 0,
        },
      ]);

      prisma.payslip.create.mockImplementation(({ data }) => ({
        id: 'new-payslip',
        ...data,
      }));

      const result = await service.generateBulkPayslips(
        PAWNSHOP_ID,
        '2026-02-01',
        '2026-02-28',
        { 'staff-1': 25000, 'staff-2': 30000 },
      );

      expect(result.success).toContain('staff-1');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].staffId).toBe('staff-2');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getPayrollSummary()
  // ──────────────────────────────────────────────────────────────────────
  describe('getPayrollSummary', () => {
    it('should aggregate all payslip values for the period', async () => {
      prisma.payslip.findMany.mockResolvedValue([
        {
          grossPay: 30000,
          totalDeductions: 5000,
          netPay: 25000,
          overtimePay: 2000,
          lateDeductions: 100,
          tax: 1500,
          sss: 900,
          philhealth: 625,
          pagibig: 100,
          status: PayslipStatus.DRAFT,
        },
        {
          grossPay: 45000,
          totalDeductions: 8000,
          netPay: 37000,
          overtimePay: 5000,
          lateDeductions: 200,
          tax: 3000,
          sss: 900,
          philhealth: 750,
          pagibig: 100,
          status: PayslipStatus.APPROVED,
        },
      ]);

      const summary = await service.getPayrollSummary(
        PAWNSHOP_ID,
        '2026-02-01',
        '2026-02-28',
      );

      expect(summary.totalStaff).toBe(2);
      expect(summary.totalGrossPay).toBe(75000);
      expect(summary.totalDeductions).toBe(13000);
      expect(summary.totalNetPay).toBe(62000);
      expect(summary.byStatus.draft).toBe(1);
      expect(summary.byStatus.approved).toBe(1);
    });
  });

  describe('generateAutomaticPayslips', () => {
    it('should generate payslips using salary by position settings', async () => {
      prisma.pawnshop.findUnique.mockResolvedValue({
        settings: { payrollBaseSalaryByPosition: { STAFF: 22000 } },
      });
      prisma.profile.findMany.mockResolvedValue([
        { id: 'staff-1', role: 'STAFF', fullName: 'Staff One', email: 's1@test.com' },
      ]);
      prisma.payslip.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      prisma.payslip.create.mockImplementation(({ data }) => ({ id: 'payslip-1', ...data }));

      const result = await service.generateAutomaticPayslips(
        PAWNSHOP_ID,
        '2026-02-01',
        '2026-02-28',
      );

      expect(result.generated).toContain('staff-1');
      expect(result.skippedNoSalarySetting).toHaveLength(0);
    });
  });

  describe('getPrintablePayslip', () => {
    it('should return payslip with staff fields for printing', async () => {
      prisma.payslip.findFirst.mockResolvedValue({
        id: 'payslip-1',
        staffId: 'staff-1',
        pawnshopId: PAWNSHOP_ID,
      });
      prisma.profile.findUnique.mockResolvedValue({
        fullName: 'Staff One',
        email: 'staff1@test.com',
        role: 'STAFF',
      });

      const printable = await service.getPrintablePayslip(PAWNSHOP_ID, 'payslip-1');

      expect(printable.staffName).toBe('Staff One');
      expect(printable.printable).toBe(true);
    });
  });
});
