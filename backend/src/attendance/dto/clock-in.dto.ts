import {
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsString,
  IsEnum,
  IsNumber,
} from 'class-validator';
import { AttendanceStatus, LeaveType } from '@prisma/client';

export class ClockInDto {
  @IsNotEmpty()
  @IsString()
  staffId: string;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @IsString()
  clockInLocation?: string; // "lat,lng"
}
