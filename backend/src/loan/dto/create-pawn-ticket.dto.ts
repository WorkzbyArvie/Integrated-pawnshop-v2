import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsDateString, Min } from 'class-validator';

export class CreatePawnTicketDto {
  @IsString()
  customerName: string;

  @IsString()
  customerAddress: string;

  @IsString()
  customerContact: string;

  @IsOptional()
  @IsString()
  accountEmail?: string;

  @IsString()
  itemCategory: string;

  @IsString()
  itemDescription: string;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsNumber()
  @Min(0)
  loanAmount: number;

  /**
   * The collateral's valuation, from `POST /loan/quote-appraisal`. Distinct from
   * `loanAmount`, which is only the fraction of this actually advanced.
   *
   * Without it the approval record can only carry the loan, so the valuation is
   * lost and `appraisedValue` and `recommendedLoanAmount` come out equal.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  appraisedValue?: number;

  @IsOptional()
  @IsNumber()
  riskScore?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @IsDateString()
  appraisalDeadline: string;

  @IsOptional()
  @IsBoolean()
  markForAuction?: boolean;

  @IsString()
  pawnshopId: string;

  @IsOptional()
  @IsNumber()
  branchId?: number;
}
