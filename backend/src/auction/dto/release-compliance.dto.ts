import { IsOptional, IsString } from 'class-validator';

export class ReleaseComplianceDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
