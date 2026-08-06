import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { ApprovalTargetType } from '@prisma/client';

export class ApprovalQueueQueryDto {
  @IsOptional()
  @IsEnum(ApprovalTargetType)
  targetType?: ApprovalTargetType;

  @IsOptional()
  @IsIn(['PENDING', 'DECIDED'])
  status?: 'PENDING' | 'DECIDED';

  @IsOptional()
  @IsString()
  pawnshopId?: string;
}
