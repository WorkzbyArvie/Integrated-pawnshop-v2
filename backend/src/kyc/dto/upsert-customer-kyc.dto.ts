import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { KycIdType } from '@prisma/client';

export class UpsertCustomerKycDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  contactNumber: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsEnum(KycIdType)
  idType: KycIdType;

  @IsString()
  @IsNotEmpty()
  idNumber: string;

  @IsString()
  @IsNotEmpty()
  idFrontUrl: string;

  @IsOptional()
  @IsString()
  idBackUrl?: string;

  @IsOptional()
  @IsString()
  selfieUrl?: string;

  @IsOptional()
  @IsObject()
  verificationData?: Record<string, unknown>;
}
