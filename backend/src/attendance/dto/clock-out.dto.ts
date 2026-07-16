import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ClockOutDto {
  @IsNotEmpty()
  @IsString()
  staffId: string;

  @IsOptional()
  @IsString()
  clockOutLocation?: string; // "lat,lng"
}
