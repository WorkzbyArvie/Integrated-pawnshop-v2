import {
  IsEnum,
  IsOptional,
  IsInt,
  IsString,
  IsDateString,
} from 'class-validator';
import { QueueStatus, QueueType } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueueFiltersDto {
  @IsOptional()
  @IsEnum(QueueStatus)
  status?: QueueStatus;

  @IsOptional()
  @IsEnum(QueueType)
  queueType?: QueueType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  offset?: number = 0;
}
