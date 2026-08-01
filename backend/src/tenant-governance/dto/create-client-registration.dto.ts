import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateClientRegistrationDto {
  @IsNotEmpty()
  @IsString()
  pawnshopName: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsNotEmpty()
  @IsEmail()
  ownerEmail: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  @IsOptional()
  @IsArray()
  @IsIn(
    [
      'Inventory Vault',
      'Finance & Treasury',
      'Customer CRM',
      'Staff Matrix',
      'Decision Support',
      'Auto-Reminders',
    ],
    { each: true },
  )
  @IsString({ each: true })
  selectedModules?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  staffCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
