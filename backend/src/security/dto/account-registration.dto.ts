import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const REGISTRATION_PURPOSES = [
  'OWNER_REGISTRATION',
  'BIDDER_REGISTRATION',
  'STAFF_ACCOUNT_CREATE',
] as const;

const REGISTRATION_ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'STAFF',
  'HR',
  'APPROVER',
] as const;

const STAFF_TYPES = [
  'CASHIER_TELLER',
  'APPRAISER',
  'INVENTORY_CUSTODIAN',
  'AUDITOR',
  'CASHIER',
  'TELLER',
  'INVENTORY',
] as const;

export class AccountRegistrationDto {
  @IsEmail()
  @IsString()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  full_name?: string;

  @IsOptional()
  @IsIn(REGISTRATION_PURPOSES)
  purpose?: (typeof REGISTRATION_PURPOSES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'auth_code must be six digits' })
  auth_code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'authCode must be six digits' })
  authCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  verification_token?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  verificationToken?: string;

  @IsOptional()
  @IsIn(REGISTRATION_ROLES)
  role?: (typeof REGISTRATION_ROLES)[number];

  @IsOptional()
  @IsIn(STAFF_TYPES)
  staff_type?: (typeof STAFF_TYPES)[number];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pawnshop_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  branch_id?: string;
}
