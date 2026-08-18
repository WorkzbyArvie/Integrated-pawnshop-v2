import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApprovalTargetType } from '@prisma/client';

export class ApprovalQueueQueryDto {
  @IsOptional()
  @IsEnum(ApprovalTargetType)
  type?: ApprovalTargetType;

  @IsOptional()
  @IsEnum(ApprovalTargetType)
  targetType?: ApprovalTargetType;

  @IsOptional()
  @IsIn(['PENDING', 'DECIDED'])
  status?: 'PENDING' | 'DECIDED';

  @IsOptional()
  @IsString()
  pawnshopId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
