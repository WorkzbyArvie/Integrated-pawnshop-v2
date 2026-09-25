import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class MfaLoginChallengeDto {
  @IsString()
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
