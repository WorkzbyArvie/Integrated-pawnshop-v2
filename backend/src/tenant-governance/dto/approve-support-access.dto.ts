import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ApproveSupportAccessDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  approvedHours?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
