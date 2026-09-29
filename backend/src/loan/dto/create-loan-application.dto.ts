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
import { MAX_LOAN_TERM_DAYS, PAWN_TERM_DAYS } from '../loan-terms';

/** Longest term the API accepts, expressed in the stored unit (months). */
const MAX_TERM_MONTHS = Math.ceil(MAX_LOAN_TERM_DAYS / PAWN_TERM_DAYS);

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

  /**
   * Stored as months for schema compatibility, but bounded to what the system
   * actually operates on. The upper limit was 60 months while the pawn flow
   * hardcoded 1 and the lifecycle works in days, so a caller could create a
   * five-year pawn that no other part of the system agreed with.
   */
  @IsInt()
  @Min(1)
  @Max(MAX_TERM_MONTHS)
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
