import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

export class GeneratePayslipDto {
  @IsNotEmpty()
  @IsString()
  staffId: string;

  @IsNotEmpty()
  @IsDateString()
  periodStart: string;

  @IsNotEmpty()
  @IsDateString()
  periodEnd: string;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  baseSalary: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  allowances?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonuses?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherDeductions?: number;
}
