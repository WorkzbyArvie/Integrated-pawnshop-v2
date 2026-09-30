import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PublicQuoteDto {
  /** The shop being priced for. Named by the applicant, not derived from a profile. */
  @IsString()
  @MinLength(1)
  pawnshopId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  itemCategory: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  weight: number;

  /**
   * A percentage (75 for 18K) or a finess mark (925 for sterling). Normalised
   * server-side, because "925" and "92.5" mean the same thing and a value of 925
   * read as a percentage would value the metal ten times over.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  purityPercent?: number;
}
