import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class RequestSupportAccessDto {
  @IsNotEmpty()
  @IsString()
  pawnshopId: string;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  requestedHours?: number;
}
