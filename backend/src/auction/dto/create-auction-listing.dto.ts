import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAuctionListingDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  ticketId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  startingPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  reservePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minBidIncrement?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bidExtensionMin?: number;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  itemCondition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  itemSpecifications?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  provenanceDetails?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  disclosureNotes?: string;
}
