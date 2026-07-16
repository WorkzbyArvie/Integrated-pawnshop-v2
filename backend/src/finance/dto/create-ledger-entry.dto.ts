import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { LedgerEntryType, LedgerCategory } from '@prisma/client';

export class CreateLedgerEntryDto {
  @IsNotEmpty()
  @IsEnum(LedgerEntryType)
  entryType: LedgerEntryType;

  @IsNotEmpty()
  @IsEnum(LedgerCategory)
  category: LedgerCategory;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount: number;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @IsString()
  performedBy: string;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  counterparty?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  receiptNumber?: string;


  @IsOptional()
  @IsString()
  approvalNotes?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
