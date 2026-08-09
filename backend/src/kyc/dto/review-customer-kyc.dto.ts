import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewCustomerKycDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  decision: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
