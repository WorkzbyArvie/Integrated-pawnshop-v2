import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import { RequestLeaveDto } from './dto/request-leave.dto';
import { AttendanceStatus } from '@prisma/client';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly WORK_START_HOUR = 8; // 8 AM
  private readonly LATE_THRESHOLD_MINUTES = 15;
  private readonly STANDARD_WORK_HOURS = 8;

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

  /**
   * Get all staff profiles for a pawnshop (non-BIDDER roles)
   */
  async getStaffList(
    pawnshopId: string,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);

      // For each staff, check today's attendance status
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [profiles, todayRecords, schedules] = await Promise.all([
        this.prisma.profile.findMany({
          where: {
            pawnshopId,
            role: { notIn: ['BIDDER'] },
            ...(normalizedBranchId !== undefined
              ? { branchId: String(normalizedBranchId) }
              : {}),
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
          },
          orderBy: { role: 'asc' },
        }),
        this.prisma.attendanceRecord.findMany({
          where: {
            pawnshopId,
            date: today,
            ...(normalizedBranchId !== undefined
              ? { branchId: normalizedBranchId }
              : {}),
          },
        }),
        this.prisma.staffSchedule.findMany({
          where: { pawnshopId },
        }),
      ]);

      const recordMap = new Map(todayRecords.map((r) => [r.staffId, r]));
      const scheduleMap = new Map(schedules.map((s) => [s.staffId, s]));

      return profiles.map((p) => {
        const record = recordMap.get(p.id);
        const schedule = scheduleMap.get(p.id);
        return {
          ...p,
          todayStatus: record?.status || 'NOT_CLOCKED_IN',
          clockIn: record?.clockIn || null,
          clockOut: record?.clockOut || null,
          isLate: record?.isLate || false,
          lateMinutes: record?.lateMinutes || 0,
          schedule: schedule
            ? {
                shiftStart: schedule.shiftStart,
                shiftEnd: schedule.shiftEnd,
                workingDays: schedule.workingDays,
                lateThreshold: schedule.lateThreshold,
              }
            : null,
        };
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to get staff list: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get all schedules for a pawnshop
   */
  async getSchedules(pawnshopId: string): Promise<any> {
    return this.prisma.staffSchedule.findMany({
      where: { pawnshopId },
    });
  }

  /**
   * Upsert (create or update) a staff schedule
   */
  async upsertSchedule(
    pawnshopId: string,
    staffId: string,
    data: {
      shiftStart: string;
      shiftEnd: string;
      workingDays: number;
      lateThreshold?: number;
    },
  ): Promise<any> {
    return this.prisma.staffSchedule.upsert({
      where: { staffId_pawnshopId: { staffId, pawnshopId } },
      update: {
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        workingDays: data.workingDays,
        lateThreshold: data.lateThreshold ?? 15,
      },
      create: {
        staffId,
        pawnshopId,
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        workingDays: data.workingDays,
        lateThreshold: data.lateThreshold ?? 15,
      },
    });
  }

  /**
   * Bulk-save schedules for all staff—applies the same schedule to everyone
   */
  async bulkUpsertSchedules(
    pawnshopId: string,
    staffIds: string[],
    data: {
      shiftStart: string;
      shiftEnd: string;
      workingDays: number;
      lateThreshold?: number;
    },
  ): Promise<any> {
    const results = [];
    for (const staffId of staffIds) {
      const res = await this.upsertSchedule(pawnshopId, staffId, data);
      results.push(res);
    }
    return results;
  }

  /**
   * Clock in staff member
   */
  async clockIn(pawnshopId: string, dto: ClockInDto): Promise<any> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if already clocked in today
      const existing = await this.prisma.attendanceRecord.findUnique({
        where: {
          staffId_pawnshopId_date: {
            staffId: dto.staffId,
            pawnshopId,
            date: today,
          },
        },
      });

      if (existing && existing.clockIn) {
        throw new BadRequestException('Already clocked in today');
      }

      const now = new Date();
      const clockInHour = now.getHours();
      const clockInMinute = now.getMinutes();

      // Look up per-staff schedule; fall back to global defaults
      const schedule = await this.prisma.staffSchedule.findUnique({
        where: { staffId_pawnshopId: { staffId: dto.staffId, pawnshopId } },
      });

      let scheduledStartMinutes = this.WORK_START_HOUR * 60;
      let threshold = this.LATE_THRESHOLD_MINUTES;

      if (schedule) {
        const [h, m] = schedule.shiftStart.split(':').map(Number);
        scheduledStartMinutes = h * 60 + m;
        threshold = schedule.lateThreshold;
      }

      const actualStart = clockInHour * 60 + clockInMinute;
      const lateMinutes = Math.max(0, actualStart - scheduledStartMinutes);
      const isLate = lateMinutes > threshold;

      if (existing) {
        // Update existing record
        const updated = await this.prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            clockIn: now,
            clockInLocation: dto.clockInLocation,
            isLate,
            lateMinutes: isLate ? lateMinutes : 0,
            status: AttendanceStatus.PRESENT,
          },
        });

        this.logger.log(
          `Staff ${dto.staffId} clocked in at ${now.toISOString()} ${isLate ? '(LATE)' : ''}`,
        );

        return updated;
      } else {
        // Create new record
        const record = await this.prisma.attendanceRecord.create({
          data: {
            staffId: dto.staffId,
            pawnshopId,
            branchId: dto.branchId,
            date: today,
            clockIn: now,
            clockInLocation: dto.clockInLocation,
            isLate,
            lateMinutes: isLate ? lateMinutes : 0,
            status: AttendanceStatus.PRESENT,
          },
        });

        this.logger.log(
          `Staff ${dto.staffId} clocked in at ${now.toISOString()} ${isLate ? '(LATE)' : ''}`,
        );

        return record;
      }
    } catch (error: any) {
      this.logger.error(`Failed to clock in: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Clock out staff member
   */
  async clockOut(pawnshopId: string, dto: ClockOutDto): Promise<any> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const record = await this.prisma.attendanceRecord.findUnique({
        where: {
          staffId_pawnshopId_date: {
            staffId: dto.staffId,
            pawnshopId,
            date: today,
          },
        },
      });

      if (!record) {
        throw new NotFoundException('No clock-in record found for today');
      }

      if (record.clockOut) {
        throw new BadRequestException('Already clocked out today');
      }

      const now = new Date();
      const workDurationMs = now.getTime() - record.clockIn.getTime();
      const workHours = workDurationMs / (1000 * 60 * 60);

      // Calculate overtime (if work hours > standard)
      const overtimeHours = Math.max(0, workHours - this.STANDARD_WORK_HOURS);

      const updated = await this.prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          clockOut: now,
          clockOutLocation: dto.clockOutLocation,
          workHours,
          overtimeHours,
        },
      });

      this.logger.log(
        `Staff ${dto.staffId} clocked out at ${now.toISOString()} - Work hours: ${workHours.toFixed(2)}`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(`Failed to clock out: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Request leave
   */
  async requestLeave(pawnshopId: string, dto: RequestLeaveDto): Promise<any> {
    try {
      const date = new Date(dto.date);
      date.setHours(0, 0, 0, 0);

      // Check if record already exists
      const existing = await this.prisma.attendanceRecord.findUnique({
        where: {
          staffId_pawnshopId_date: {
            staffId: dto.staffId,
            pawnshopId,
            date,
          },
        },
      });

      if (existing) {
        throw new BadRequestException(
          'Attendance record already exists for this date',
        );
      }

      const record = await this.prisma.attendanceRecord.create({
        data: {
          staffId: dto.staffId,
          pawnshopId,
          date,
          status: AttendanceStatus.ON_LEAVE,
          leaveType: dto.leaveType,
          leaveReason: dto.leaveReason,
          leaveApprovedBy: dto.leaveApprovedBy,
        },
      });

      this.logger.log(
        `Leave requested for staff ${dto.staffId} on ${dto.date} - Type: ${dto.leaveType}`,
      );

      return record;
    } catch (error: any) {
      this.logger.error(
        `Failed to request leave: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get attendance records with filters
   */
  async findAll(
    pawnshopId: string,
    staffId?: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: number | string,
  ): Promise<any> {
    try {
      const normalizedBranchId = this.normalizeBranchId(branchId);
      const where: any = { pawnshopId };

      if (staffId) where.staffId = staffId;
      if (normalizedBranchId !== undefined) where.branchId = normalizedBranchId;

      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date.gte = new Date(dateFrom);
        if (dateTo) where.date.lte = new Date(dateTo);
      }

      const records = await this.prisma.attendanceRecord.findMany({
        where,
        orderBy: {
          date: 'desc',
        },
      });

      return records;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch attendance records: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get attendance statistics for a staff member
   */
  async getStaffStatistics(
    pawnshopId: string,
    staffId: string,
    monthYear?: string, // Format: "YYYY-MM"
  ): Promise<any> {
    try {
      let dateFrom: Date;
      let dateTo: Date;

      if (monthYear) {
        const [year, month] = monthYear.split('-').map(Number);
        dateFrom = new Date(year, month - 1, 1);
        dateTo = new Date(year, month, 0, 23, 59, 59);
      } else {
        // Current month
        const now = new Date();
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      }

      const records = await this.prisma.attendanceRecord.findMany({
        where: {
          staffId,
          pawnshopId,
          date: {
            gte: dateFrom,
            lte: dateTo,
          },
        },
      });

      const stats = {
        totalDays: records.length,
        daysPresent: records.filter(
          (r) => r.status === AttendanceStatus.PRESENT,
        ).length,
        daysAbsent: records.filter((r) => r.status === AttendanceStatus.ABSENT)
          .length,
        daysLate: records.filter((r) => r.isLate).length,
        daysOnLeave: records.filter(
          (r) => r.status === AttendanceStatus.ON_LEAVE,
        ).length,
        totalWorkHours: records.reduce((sum, r) => sum + (r.workHours || 0), 0),
        totalOvertimeHours: records.reduce(
          (sum, r) => sum + (r.overtimeHours || 0),
          0,
        ),
        totalLateMinutes: records.reduce(
          (sum, r) => sum + (r.lateMinutes || 0),
          0,
        ),
      };

      return stats;
    } catch (error: any) {
      this.logger.error(
        `Failed to get staff statistics: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Mark staff as absent (admin function)
   */
  async markAbsent(
    pawnshopId: string,
    staffId: string,
    date: string,
    notes?: string,
  ): Promise<any> {
    try {
      const recordDate = new Date(date);
      recordDate.setHours(0, 0, 0, 0);

      const existing = await this.prisma.attendanceRecord.findUnique({
        where: {
          staffId_pawnshopId_date: {
            staffId,
            pawnshopId,
            date: recordDate,
          },
        },
      });

      if (existing) {
        const updated = await this.prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            status: AttendanceStatus.ABSENT,
            notes,
          },
        });
        return updated;
      } else {
        const record = await this.prisma.attendanceRecord.create({
          data: {
            staffId,
            pawnshopId,
            date: recordDate,
            status: AttendanceStatus.ABSENT,
            notes,
          },
        });
        return record;
      }
    } catch (error: any) {
      this.logger.error(`Failed to mark absent: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Verify attendance record (for payroll)
   */
  async verifyRecord(
    pawnshopId: string,
    recordId: string,
    verifiedBy: string,
  ): Promise<any> {
    try {
      const record = await this.prisma.attendanceRecord.findFirst({
        where: {
          id: recordId,
          pawnshopId,
        },
      });

      if (!record) {
        throw new NotFoundException('Attendance record not found');
      }

      const updated = await this.prisma.attendanceRecord.update({
        where: { id: recordId },
        data: {
          verifiedBy,
          verifiedAt: new Date(),
        },
      });

      this.logger.log(
        `Attendance record ${recordId} verified by ${verifiedBy}`,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(
        `Failed to verify record: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
