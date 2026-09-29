import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';

/**
 * Query shape for the tenant-scoped ticket vault.
 *
 * As with the customer ledger, `branchId` is a scope selector rather than a
 * tenant selector: the service verifies the branch belongs to the caller's own
 * pawnshop before narrowing by it.
 */
export class TicketListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branchId?: number;

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
