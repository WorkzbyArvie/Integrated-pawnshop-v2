-- Migration: Migrate Loan.status from String to TicketLifecycleStatus enum
-- Date: July 7, 2026
-- Changes Loan.status column type and maps old string values to enum values

-- 1. Add a temporary column
ALTER TABLE "public"."loan"
ADD COLUMN "status_new" "public"."TicketLifecycleStatus" NOT NULL DEFAULT 'RECEIVED';

-- 2. Migrate existing data: map old string values to new enum values
UPDATE "public"."loan"
SET "status_new" = CASE
  WHEN LOWER("status") IN ('active', 'current') THEN 'ACTIVE'::"public"."TicketLifecycleStatus"
  WHEN LOWER("status") IN ('paid', 'completed', 'redeemed') THEN 'REDEEMED'::"public"."TicketLifecycleStatus"
  WHEN LOWER("status") IN ('defaulted', 'forfeited') THEN 'FORFEITED'::"public"."TicketLifecycleStatus"
  WHEN LOWER("status") IN ('overdue') THEN 'OVERDUE'::"public"."TicketLifecycleStatus"
  WHEN LOWER("status") IN ('pending') THEN 'RECEIVED'::"public"."TicketLifecycleStatus"
  WHEN LOWER("status") IN ('cancelled') THEN 'CANCELLED'::"public"."TicketLifecycleStatus"
  ELSE 'RECEIVED'::"public"."TicketLifecycleStatus"
END;

-- 3. Drop old column and rename new one
ALTER TABLE "public"."loan" DROP COLUMN "status";
ALTER TABLE "public"."loan" RENAME COLUMN "status_new" TO "status";
