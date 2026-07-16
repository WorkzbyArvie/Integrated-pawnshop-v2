import {
  IsString,
  IsNumber,
  IsInt,
  IsEnum,
  IsOptional,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export enum LoanTypeEnum {
  PERSONAL = 'Personal',
  BUSINESS = 'Business',
  EMERGENCY = 'Emergency',
}

export class CreateLoanApplicationDto {
  @IsString()
  @MinLength(1)
  customerId: string;

  @IsString()
  @MinLength(1)
  pawnshopId: string;

  @IsNumber()
  @Min(1000)
  loanAmount: number;

  @IsEnum(LoanTypeEnum)
  loanType: LoanTypeEnum;

  @IsInt()
  @Min(1)
  @Max(60)
  termMonths: number;

  @IsString()
  @MinLength(10)
  purpose: string;

  @IsOptional()
  @IsString()
  submittedBy?: string;
}

export class UpdateApplicationStatusDto {
  @IsEnum([
    'PENDING',
    'DOCUMENTS_REVIEW',
    'ELIGIBILITY_CHECK',
    'AWAITING_APPROVAL',
    'MANAGER_REVIEW',
    'OWNER_APPROVAL',
    'ADDITIONAL_PROOF',
    'APPROVED',
    'REJECTED',
    'DISBURSED',
  ])
  status: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  evaluatedBy?: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  userRole?: string;
}
