import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class InviteOwnerDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  ownerName?: string;

  @IsString()
  @MaxLength(200)
  pawnshopName: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  message?: string;
}
