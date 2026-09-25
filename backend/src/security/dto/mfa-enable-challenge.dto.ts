import { IsNotEmpty, IsString } from 'class-validator';

export class MfaEnableChallengeDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;
}
