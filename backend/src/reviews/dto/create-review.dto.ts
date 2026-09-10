import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  comment: string;
}

export class ModerateReviewDto {
  @IsString()
  @IsIn(['APPROVED', 'HIDDEN'])
  status: 'APPROVED' | 'HIDDEN';
}