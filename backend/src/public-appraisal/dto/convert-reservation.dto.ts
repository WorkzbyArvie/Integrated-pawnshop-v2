import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * What the appraiser recorded when the pawner arrived.
 *
 * These are **not** the online estimate. The online figure was a remote
 * calculation from a self-reported weight; the appraiser weighed, tested and
 * inspected the item. Their number is the one that goes on the ticket, and the
 * endpoint defaults to it rather than to the snapshot.
 *
 * `weight`, `appraisedValue` and `loanAmount` are all required. A conversion
 * that quietly reused the applicant's own figures would turn a five-step process
 * into a rubber stamp, and the whole reason the appraisal happens in person is
 * that the applicant's number is not trusted.
 */
export class ConvertReservationDto {
  /** Weighed by the appraiser, not self-reported. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  weight: number;

  /** The appraiser's valuation of the item as inspected. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  appraisedValue: number;

  /** What the appraiser agrees to advance. Usually a fraction of the valuation. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  loanAmount: number;

  /** Any correction to the described category, e.g. filed down and re-graded. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  itemCategory?: string;

  /** What the inspection found. Recorded on the ticket as the appraiser's note. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  itemDescription?: string;

  /**
   * The valuation and the loan often disagree once the item is in hand — the
   * purity mark was wrong, or the weight. Recording why keeps the approval trail
   * honest instead of leaving a silent difference between the quote the pawner
   * accepted and the figure on the contract they sign.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  revisionReason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branchId?: number;

  @IsOptional()
  @IsDateString()
  appraisalDeadline?: string;
}