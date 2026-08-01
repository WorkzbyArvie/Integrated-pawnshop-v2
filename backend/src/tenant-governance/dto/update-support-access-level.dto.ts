import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum SupportAccessLevel {
  VIEW_ONLY = 'VIEW_ONLY',
  SUPPORT = 'SUPPORT',
  EMERGENCY = 'EMERGENCY',
}

export class UpdateSupportAccessLevelDto {
  @IsEnum(SupportAccessLevel)
  level: SupportAccessLevel;

  @IsString()
  @IsOptional()
  reason?: string;
}
