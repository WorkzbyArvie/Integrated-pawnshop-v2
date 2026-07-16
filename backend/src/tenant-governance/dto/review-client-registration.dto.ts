import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewClientRegistrationDto {
  @IsIn(['CONTACTED', 'APPROVED', 'REJECTED'])
  decision: 'CONTACTED' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
