import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export class VerifyComplianceDto {
  @IsNotEmpty()
  @IsString()
  paymentProofUrl: string;

  @IsNotEmpty()
  @IsString()
  paymentReference: string;

  @IsOptional()
  @IsNumber()
  paidAmount?: number;
}
