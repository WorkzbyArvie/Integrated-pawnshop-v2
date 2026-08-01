import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ComplianceDocStatus } from '@prisma/client';

export class VerifyDocumentDto {
  @IsEnum(ComplianceDocStatus)
  status: ComplianceDocStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}
