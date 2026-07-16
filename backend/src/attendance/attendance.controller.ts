import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import { RequestLeaveDto } from './dto/request-leave.dto';

@Controller('attendance')
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private readonly attendanceService: AttendanceService) {}

  /**
   * Get staff list with today's attendance status + schedule
   * GET /attendance/staff-list
   */
  @Get('staff-list')
  async getStaffList(
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendanceService.getStaffList(pawnshopId, branchId);
  }

  /**
   * Get all schedules
   * GET /attendance/schedules
   */
  @Get('schedules')
  async getSchedules(@Headers('pawnshop-id') pawnshopId: string) {
    return this.attendanceService.getSchedules(pawnshopId);
  }

  /**
   * Upsert schedule for a single staff member
   * PUT /attendance/schedules/:staffId
   */
  @Put('schedules/:staffId')
  async upsertSchedule(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('staffId') staffId: string,
    @Body()
    body: {
      shiftStart: string;
      shiftEnd: string;
      workingDays: number;
      lateThreshold?: number;
    },
  ) {
    return this.attendanceService.upsertSchedule(pawnshopId, staffId, body);
  }

  /**
   * Bulk-save schedules (apply the same schedule to many staff)
   * POST /attendance/schedules/bulk
   */
  @Post('schedules/bulk')
  async bulkUpsertSchedules(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body()
    body: {
      staffIds: string[];
      shiftStart: string;
      shiftEnd: string;
      workingDays: number;
      lateThreshold?: number;
    },
  ) {
    return this.attendanceService.bulkUpsertSchedules(
      pawnshopId,
      body.staffIds,
      body,
    );
  }

  /**
   * Clock in
   * POST /attendance/clock-in
   */
  @Post('clock-in')
  @HttpCode(HttpStatus.OK)
  async clockIn(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: ClockInDto,
  ) {
    return this.attendanceService.clockIn(pawnshopId, dto);
  }

  /**
   * Clock out
   * POST /attendance/clock-out
   */
  @Post('clock-out')
  @HttpCode(HttpStatus.OK)
  async clockOut(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: ClockOutDto,
  ) {
    return this.attendanceService.clockOut(pawnshopId, dto);
  }

  /**
   * Request leave
   * POST /attendance/leave
   */
  @Post('leave')
  @HttpCode(HttpStatus.CREATED)
  async requestLeave(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() dto: RequestLeaveDto,
  ) {
    return this.attendanceService.requestLeave(pawnshopId, dto);
  }

  /**
   * Get attendance records
   * GET /attendance
   */
  @Get()
  async findAll(
    @Headers('pawnshop-id') pawnshopId: string,
    @Query('staffId') staffId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendanceService.findAll(
      pawnshopId,
      staffId,
      dateFrom,
      dateTo,
      branchId,
    );
  }

  /**
   * Get staff statistics
   * GET /attendance/staff/:staffId/statistics
   */
  @Get('staff/:staffId/statistics')
  async getStatistics(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('staffId') staffId: string,
    @Query('monthYear') monthYear?: string,
  ) {
    return this.attendanceService.getStaffStatistics(
      pawnshopId,
      staffId,
      monthYear,
    );
  }

  /**
   * Mark staff as absent
   * POST /attendance/mark-absent
   */
  @Post('mark-absent')
  async markAbsent(
    @Headers('pawnshop-id') pawnshopId: string,
    @Body() body: { staffId: string; date: string; notes?: string },
  ) {
    return this.attendanceService.markAbsent(
      pawnshopId,
      body.staffId,
      body.date,
      body.notes,
    );
  }

  /**
   * Verify attendance record
   * PATCH /attendance/:id/verify
   */
  @Patch(':id/verify')
  async verifyRecord(
    @Headers('pawnshop-id') pawnshopId: string,
    @Param('id') id: string,
    @Body() body: { verifiedBy: string },
  ) {
    return this.attendanceService.verifyRecord(pawnshopId, id, body.verifiedBy);
  }
}
