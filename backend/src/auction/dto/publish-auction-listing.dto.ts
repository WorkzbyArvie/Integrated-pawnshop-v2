import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class PublishAuctionListingDto {
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  /** Auction duration in hours (used when endAt is not provided) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  durationHours?: number;
}
