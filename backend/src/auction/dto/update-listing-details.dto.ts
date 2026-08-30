import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateListingDetailsDto {
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
