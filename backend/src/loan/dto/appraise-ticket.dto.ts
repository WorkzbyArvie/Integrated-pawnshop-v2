import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class AppraiseTicketDto {
  @IsNumber()
  @Min(0)
  appraisedValue: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  riskScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  recommendedLoanAmount?: number;

  @IsOptional()
  @IsString()
  appraisalNotes?: string;

  @IsOptional()
  @IsString()
  itemCondition?: string;
}
