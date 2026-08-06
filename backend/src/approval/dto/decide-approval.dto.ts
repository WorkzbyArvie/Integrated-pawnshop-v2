import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  decisionComment?: string;
}
