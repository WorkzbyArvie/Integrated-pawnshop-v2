import { IsInt, IsNumber, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class AppraiseItemDto {
  /**
   * Purity, as a percentage of pure metal: 100 for 24K, 75 for 18K, 925 for
   * sterling.
   *
   * Optional because not every collateral is metal, and a diamond has no
   * karat. Where it is supplied it scales the appraised value, which is the
   * single largest source of error in a per-gram appraisal: an 18K chain and a
   * 24K one of identical weight differ by 25%, and no per-gram rate can express
   * that.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  purityPercent?: number;

  /** Did the appraiser inspect the item and confirm it is genuine? */
  @IsOptional()
  authenticityVerified?: boolean;

  /**
   * The appraiser suspects the item is counterfeit - a failed density test, a
   * suspect hallmark, a tungsten-filled bar. This is not a score to be weighed
   * against other factors: it blocks the pawn outright, because proceeding means
   * the branch holds worthless collateral and may face the rightful owner.
   */
  @IsOptional()
  authenticitySuspect?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  appraiserNotes?: string;
}

export class RedemptionQuoteDto {
  @IsInt()
  ticketId: number;
}

/**
 * A valuation quote for a prospective pawn. No ticket exists yet - the appraisal
 * precedes the pawn, so this creates nothing.
 */
export class QuoteAppraisalDto extends AppraiseItemDto {
  @IsString()
  itemCategory: string;

  @IsNumber()
  @Min(0)
  weight: number;

  /** The pawner's KYC state, which is a risk input. */
  @IsOptional()
  @IsString()
  kycStatus?: string;

  @IsOptional()
  idVerified?: boolean;
}
