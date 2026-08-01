import { IsEnum, IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';
import { ComplianceDocType } from '@prisma/client';

export class UploadDocumentDto {
  @IsEnum(ComplianceDocType)
  documentType: ComplianceDocType;

  @IsString()
  @MaxLength(500)
  fileUrl: string;

  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsOptional()
  fileSize?: number;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
