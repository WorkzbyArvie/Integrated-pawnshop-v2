import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SubscriptionTier, SubscriptionStatus } from '@prisma/client';

export class ExtendTrialDto {
  @IsInt()
  @Min(1)
  additionalDays: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class UpgradeTierDto {
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class AdjustSubscriptionStatusDto {
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}
