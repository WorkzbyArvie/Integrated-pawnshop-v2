import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { LeaveType } from '@prisma/client';

export class RequestLeaveDto {
  @IsNotEmpty()
  @IsString()
  staffId: string;

  @IsNotEmpty()
  @IsDateString()
  date: string;

  @IsNotEmpty()
  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @IsNotEmpty()
  @IsString()
  leaveReason: string;

  @IsOptional()
  @IsString()
  leaveApprovedBy?: string;
}
