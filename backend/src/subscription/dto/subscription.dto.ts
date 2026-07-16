import {
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SubscriptionTier, BillingInterval } from '@prisma/client';

export class CreateSubscriptionDto {
  @IsNotEmpty()
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

  @IsNotEmpty()
  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @IsOptional()
  @IsString()
  billingEmail?: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsBoolean()
  trialAutoChargeConsent?: boolean;

  @IsOptional()
  @IsEnum(['AUTO', 'CARD', 'E_WALLET'] as const)
  preferredMethod?: 'AUTO' | 'CARD' | 'E_WALLET';
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsString()
  billingEmail?: string;
}

export class CancelSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;
}
