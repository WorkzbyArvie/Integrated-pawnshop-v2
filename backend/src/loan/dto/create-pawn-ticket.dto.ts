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
