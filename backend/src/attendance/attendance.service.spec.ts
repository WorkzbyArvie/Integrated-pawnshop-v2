import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, LeaveType } from '@prisma/client';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: Record<string, any>;

  const PAWNSHOP_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = {
      attendanceRecord: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  // ──────────────────────────────────────────────────────────────────────
  // clockIn()
  // ──────────────────────────────────────────────────────────────────────
  describe('clockIn', () => {
    const dto = {
      staffId: 'staff-1',
      branchId: 1,
      clockInLocation: '14.5995,120.9842',
    };

    it('should create a new attendance record on first clock-in', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockImplementation(({ data }) => ({
        id: 'record-1',
        ...data,
      }));

      const result = await service.clockIn(PAWNSHOP_ID, dto);

      expect(result.staffId).toBe('staff-1');
      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(prisma.attendanceRecord.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException when already clocked in', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        clockIn: new Date(),
      });

      await expect(service.clockIn(PAWNSHOP_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update existing record if exists but has no clockIn', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        clockIn: null,
        status: AttendanceStatus.ABSENT,
      });
      prisma.attendanceRecord.update.mockImplementation(({ data }) => ({
        id: 'record-1',
        ...data,
      }));

      const result = await service.clockIn(PAWNSHOP_ID, dto);

      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(prisma.attendanceRecord.update).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // clockOut()
  // ──────────────────────────────────────────────────────────────────────
  describe('clockOut', () => {
    const dto = {
      staffId: 'staff-1',
      clockOutLocation: '14.5995,120.9842',
    };

    it('should record clock-out and calculate work hours', async () => {
      const clockInTime = new Date();
      clockInTime.setHours(clockInTime.getHours() - 9); // 9 hours ago

      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        clockIn: clockInTime,
        clockOut: null,
      });
      prisma.attendanceRecord.update.mockImplementation(({ data }) => ({
        id: 'record-1',
        ...data,
      }));

      const result = await service.clockOut(PAWNSHOP_ID, dto);

      expect(result.clockOut).toBeInstanceOf(Date);
      expect(result.workHours).toBeGreaterThan(8);
      expect(result.overtimeHours).toBeGreaterThan(0); // > 8 standard hours
    });

    it('should throw NotFoundException when no clock-in record exists', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);

      await expect(service.clockOut(PAWNSHOP_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when already clocked out', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        clockIn: new Date(),
        clockOut: new Date(),
      });

      await expect(service.clockOut(PAWNSHOP_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should calculate zero overtime for standard 8-hour day', async () => {
      const clockInTime = new Date();
      clockInTime.setHours(clockInTime.getHours() - 7); // 7 hours ago

      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
        clockIn: clockInTime,
        clockOut: null,
      });
      prisma.attendanceRecord.update.mockImplementation(({ data }) => ({
        id: 'record-1',
        ...data,
      }));

      const result = await service.clockOut(PAWNSHOP_ID, dto);

      expect(result.overtimeHours).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // requestLeave()
  // ──────────────────────────────────────────────────────────────────────
  describe('requestLeave', () => {
    const dto = {
      staffId: 'staff-1',
      date: '2026-03-15',
      leaveType: LeaveType.SICK_LEAVE,
      leaveReason: 'Flu',
      leaveApprovedBy: 'manager-1',
    };

    it('should create a leave record', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockImplementation(({ data }) => ({
        id: 'record-1',
        ...data,
      }));

      const result = await service.requestLeave(PAWNSHOP_ID, dto);

      expect(result.status).toBe(AttendanceStatus.ON_LEAVE);
      expect(result.leaveType).toBe(LeaveType.SICK_LEAVE);
    });

    it('should reject leave if attendance already exists for date', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'existing',
      });

      await expect(service.requestLeave(PAWNSHOP_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getStaffStatistics()
  // ──────────────────────────────────────────────────────────────────────
  describe('getStaffStatistics', () => {
    it('should compute monthly statistics from attendance records', async () => {
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
          isLate: true,
          workHours: 8.5,
          overtimeHours: 0.5,
          lateMinutes: 20,
        },
        {
          status: AttendanceStatus.ABSENT,
          isLate: false,
          workHours: null,
          overtimeHours: null,
          lateMinutes: null,
        },
        {
          status: AttendanceStatus.ON_LEAVE,
          isLate: false,
          workHours: null,
          overtimeHours: null,
          lateMinutes: null,
        },
      ]);

      const stats = await service.getStaffStatistics(
        PAWNSHOP_ID,
        'staff-1',
        '2026-03',
      );

      expect(stats.totalDays).toBe(4);
      expect(stats.daysPresent).toBe(2);
      expect(stats.daysAbsent).toBe(1);
      expect(stats.daysLate).toBe(1);
      expect(stats.daysOnLeave).toBe(1);
      expect(stats.totalWorkHours).toBe(16.5);
      expect(stats.totalOvertimeHours).toBe(0.5);
      expect(stats.totalLateMinutes).toBe(20);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // markAbsent()
  // ──────────────────────────────────────────────────────────────────────
  describe('markAbsent', () => {
    it('should create new ABSENT record when no record exists', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.attendanceRecord.create.mockImplementation(({ data }) => ({
        id: 'record-1',
        ...data,
      }));

      const result = await service.markAbsent(
        PAWNSHOP_ID,
        'staff-1',
        '2026-03-10',
        'No show, no call',
      );

      expect(result.status).toBe(AttendanceStatus.ABSENT);
    });

    it('should update existing record to ABSENT', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        id: 'record-1',
      });
      prisma.attendanceRecord.update.mockResolvedValue({
        id: 'record-1',
        status: AttendanceStatus.ABSENT,
      });

      const result = await service.markAbsent(
        PAWNSHOP_ID,
        'staff-1',
        '2026-03-10',
      );

      expect(result.status).toBe(AttendanceStatus.ABSENT);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // verifyRecord()
  // ──────────────────────────────────────────────────────────────────────
  describe('verifyRecord', () => {
    it('should set verifiedBy and verifiedAt', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'record-1' });
      prisma.attendanceRecord.update.mockResolvedValue({
        id: 'record-1',
        verifiedBy: 'manager-1',
        verifiedAt: new Date(),
      });

      const result = await service.verifyRecord(
        PAWNSHOP_ID,
        'record-1',
        'manager-1',
      );

      expect(result.verifiedBy).toBe('manager-1');
    });

    it('should throw NotFoundException for unknown record', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyRecord(PAWNSHOP_ID, 'bad-id', 'manager-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
