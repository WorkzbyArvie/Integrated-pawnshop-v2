import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class AddPaymentMethodDto {
  @IsString()
  @IsIn(['CARD', 'GCASH', 'PAYMAYA', 'BANK_ACCOUNT'])
  type: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  last4?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  cardBrand?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(2024)
  @Max(2100)
  expiryYear?: number;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  bankName?: string;

  @IsOptional()
  @IsString()
  @Length(5, 30)
  walletPhone?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
