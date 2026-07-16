import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSupportConversationDto {
  @IsOptional()
  @IsString()
  pawnshopId?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(160)
  subject: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  initialMessage: string;
}
