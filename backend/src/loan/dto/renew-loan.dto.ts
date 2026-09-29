import {
  IsInt,
  IsNumber,
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { PaymentMethodEnum } from './payment.dto';

export class RenewLoanDto {
  @IsInt()
  ticketId: number;

  @IsInt()
  loanId: number;

  @IsNumber()
  interestAmount: number;

  @IsEnum(PaymentMethodEnum)
  paymentMethod: PaymentMethodEnum;

  /**
   * Retained for compatibility with existing callers, but IGNORED.
   *
   * The controller overwrites it with the authenticated user, because a proof
   * or receipt whose author is whatever the client typed is not an audit
   * record - it is an assertion by whoever was at the keyboard. If you are
   * calling this endpoint directly in a test, set it and expect the server to
   * disregard it.
   */
  @IsOptional()
  @IsString()
  processedBy?: string;

  @IsOptional()
  @IsInt()
  extensionDays?: number;

  /** Overwritten by the controller from the session, as `processedBy` is. */
  @IsOptional()
  @IsString()
  userRole?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
