import { IsString, IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class CreateEligibilityCheckDto {
  @IsString()
  applicationId: string;

  @IsString()
  customerId: string;

  @IsOptional()
  @IsNumber()
  creditScore?: number;

  @IsBoolean()
  hasPreviousLoans: boolean;

  @IsNumber()
  previousLoanCount: number;

  @IsBoolean()
  defaultHistory: boolean;

  @IsBoolean()
  incomeVerified: boolean;

  @IsOptional()
  @IsNumber()
  monthlyIncome?: number;

  @IsOptional()
  @IsNumber()
  debtToIncomeRatio?: number;

  @IsOptional()
  @IsString()
  employmentStatus?: string;

  @IsBoolean()
  eligible: boolean;

  @IsOptional()
  @IsString()
  eligibilityNotes?: string;

  @IsString()
  checkedBy: string;
}
