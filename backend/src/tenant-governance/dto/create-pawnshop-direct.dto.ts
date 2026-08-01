import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePawnshopDirectDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsEmail()
  ownerEmail: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  ownerName?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  address?: string;

  @IsBoolean()
  @IsOptional()
  activateTrial?: boolean;
}
