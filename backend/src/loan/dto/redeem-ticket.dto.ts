import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RedeemTicketDto {
  @IsNumber()
  @Min(0)
  amountPaid: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
