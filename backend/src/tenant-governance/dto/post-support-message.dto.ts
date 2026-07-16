import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PostSupportMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  message: string;
}
