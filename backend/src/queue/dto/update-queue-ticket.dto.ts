import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { QueueStatus } from '@prisma/client';

export class UpdateQueueTicketDto {
  @IsOptional()
  @IsEnum(QueueStatus)
  status?: QueueStatus;

  @IsOptional()
  @IsString()
  assignedStaffId?: string;

  @IsOptional()
  @IsString()
  counterNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  calledAt?: Date;

  @IsOptional()
  @IsDateString()
  servedAt?: Date;

  @IsOptional()
  @IsDateString()
  completedAt?: Date;
}
