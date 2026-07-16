import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PostClientRegistrationMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  message: string;
}
