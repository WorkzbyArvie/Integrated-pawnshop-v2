import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelClientRegistrationDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;
}
