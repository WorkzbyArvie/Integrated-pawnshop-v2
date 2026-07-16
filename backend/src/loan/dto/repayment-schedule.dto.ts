import {
  IsInt,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class GenerateRepaymentScheduleDto {
  @IsInt()
  loanId: number;

  @IsNumber()
  loanAmount: number;

  @IsNumber()
  interestRate: number;

  @IsInt()
  termMonths: number;

  @IsDateString()
  startDate: string;
}

export class UpdateSchedulePaymentDto {
  @IsInt()
  scheduleId: number;

  @IsNumber()
  paidAmount: number;

  @IsOptional()
  @IsDateString()
  paidDate?: string;

  @IsEnum(['PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'WAIVED'])
  status: string;

  @IsOptional()
  @IsNumber()
  penaltyAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
