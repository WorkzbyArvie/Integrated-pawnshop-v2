import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { KycIdType } from '@prisma/client';

/**
 * The application an applicant submits.
 *
 * Note what is absent: any field asserting that a face matched, that a document
 * was genuine, or that OCR read a name correctly. The server cannot establish
 * any of those, so it does not accept them - see the service, which records only
 * the evidence it actually received.
 */
export class CreateReservationDto {
  @IsString()
  @MinLength(1)
  pawnshopId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branchId?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName: string;

  /** Philippine mobile: 09xxxxxxxxx or +639xxxxxxxx. */
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  contactNumber: string;

  @IsString()
  @MinLength(4)
  @MaxLength(240)
  address: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  itemCategory: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  itemDescription?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  weight: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  purityPercent?: number;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  photoUrls?: string[];

  @IsOptional()
  @IsEnum(KycIdType)
  idType?: KycIdType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  idNumber?: string;

  @IsOptional()
  @IsUrl()
  idFrontUrl?: string;

  @IsOptional()
  @IsUrl()
  idBackUrl?: string;

  @IsOptional()
  @IsUrl()
  selfieUrl?: string;
}
