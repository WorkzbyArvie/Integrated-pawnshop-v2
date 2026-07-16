import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReleaseItemDto {
  @IsNotEmpty()
  @IsString()
  releasedBy: string;

  @IsOptional()
  @IsString()
  releaseNotes?: string;
}
