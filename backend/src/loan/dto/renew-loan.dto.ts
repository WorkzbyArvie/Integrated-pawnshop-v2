import {
  IsInt,
  IsNumber,
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { PaymentMethodEnum } from './payment.dto';

export class RenewLoanDto {
  @IsInt()
  ticketId: number;

  @IsInt()
  loanId: number;

  @IsNumber()
  interestAmount: number;

  @IsEnum(PaymentMethodEnum)
  paymentMethod: PaymentMethodEnum;

  @IsString()
  processedBy: string;

  @IsOptional()
  @IsInt()
  extensionDays?: number;

  @IsOptional()
  @IsString()
  userRole?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
