import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class MfaDisableDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  challengeId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code?: string;
}
