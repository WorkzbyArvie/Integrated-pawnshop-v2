import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query shape for the tenant-scoped customer ledger.
 *
 * `branchId` is a *scope* selector, not a tenant selector: the service verifies
 * it belongs to the caller's own pawnshop before using it to narrow the ledger
 * to customers who actually hold a ticket at that branch. A shop id from the
 * client is never trusted as the tenant.
 */
export class CustomerListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branchId?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
