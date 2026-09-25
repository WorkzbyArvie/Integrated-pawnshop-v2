import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @IsUUID()
  challengeId: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code: string;
}
