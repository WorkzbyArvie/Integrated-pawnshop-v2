import { IsInt, IsNumber, IsEnum, IsString, IsOptional } from 'class-validator';

export enum PaymentMethodEnum {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  E_WALLET = 'E_WALLET',
  CHECK = 'CHECK',
}

export enum PaymentTypeEnum {
  LOAN_REPAYMENT = 'LOAN_REPAYMENT',
  AUCTION_PAYMENT = 'AUCTION_PAYMENT',
  PENALTY_FEE = 'PENALTY_FEE',
  SERVICE_FEE = 'SERVICE_FEE',
  OTHER = 'OTHER',
}

export class CreatePaymentDto {
  @IsString()
  customerId: string;

  @IsOptional()
  @IsInt()
  loanId?: number;

  @IsOptional()
  @IsInt()
  scheduleId?: number;

  @IsOptional()
  @IsInt()
  auctionListingId?: number;

  @IsNumber()
  amount: number;

  @IsEnum(PaymentMethodEnum)
  paymentMethod: PaymentMethodEnum;

  @IsEnum(PaymentTypeEnum)
  paymentType: PaymentTypeEnum;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  processedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
