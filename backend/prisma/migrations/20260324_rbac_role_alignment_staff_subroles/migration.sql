-- RBAC role alignment + staff sub-role support
-- Safe for existing production data where profiles.role is TEXT and includes BIDDER.

-- 1) Add specialized staff role dimension (Cashier/Teller, Appraiser, Inventory Custodian, Auditor)
-- without changing role semantics.
ALTER TABLE "public"."profiles"
ADD COLUMN IF NOT EXISTS "staff_type" TEXT;

-- 2) Normalize legacy branch admin naming to canonical ADMIN.
UPDATE "public"."profiles"
SET "role" = 'ADMIN'
WHERE UPPER(COALESCE("role", '')) IN ('BRANCH_ADMIN', 'BRANCH ADMIN', 'BRANCHADMIN');

UPDATE "public"."admin_invites"
SET "role" = 'ADMIN'
WHERE UPPER(COALESCE("role", '')) IN ('BRANCH_ADMIN', 'BRANCH ADMIN', 'BRANCHADMIN');

-- 3) Ensure future invite defaults use ADMIN for branch-admin level access.
ALTER TABLE "public"."admin_invites"
ALTER COLUMN "role" SET DEFAULT 'ADMIN';

-- 4) Data quality normalization for staff_type values.
-- Backfill legacy specialization roles into staff_type while preserving tenant-level role hierarchy.
UPDATE "public"."profiles"
SET
  "staff_type" = CASE
    WHEN UPPER(BTRIM("role")) = 'CASHIER' THEN 'CASHIER_TELLER'
    WHEN UPPER(BTRIM("role")) = 'INVENTORY' THEN 'INVENTORY_CUSTODIAN'
    ELSE UPPER(BTRIM("role"))
  END,
  "role" = 'STAFF'
WHERE UPPER(COALESCE("role", '')) IN ('CASHIER', 'APPRAISER', 'INVENTORY', 'CASHIER_TELLER', 'INVENTORY_CUSTODIAN', 'AUDITOR')
  AND (
    "staff_type" IS NULL
    OR UPPER(BTRIM("staff_type")) NOT IN ('CASHIER_TELLER', 'APPRAISER', 'INVENTORY_CUSTODIAN', 'AUDITOR')
  );

UPDATE "public"."profiles"
SET "staff_type" = NULL
WHERE "staff_type" IS NOT NULL
  AND BTRIM("staff_type") = '';

UPDATE "public"."profiles"
SET "staff_type" = UPPER(BTRIM("staff_type"))
WHERE "staff_type" IS NOT NULL;

UPDATE "public"."profiles"
SET "staff_type" = 'CASHIER_TELLER'
WHERE "staff_type" = 'CASHIER';

UPDATE "public"."profiles"
SET "staff_type" = 'INVENTORY_CUSTODIAN'
WHERE "staff_type" = 'INVENTORY';

UPDATE "public"."profiles"
SET "staff_type" = NULL
WHERE "staff_type" IS NOT NULL
  AND "staff_type" NOT IN ('CASHIER_TELLER', 'APPRAISER', 'INVENTORY_CUSTODIAN', 'AUDITOR');

-- 5) Add check constraint for allowed staff specialization labels.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_staff_type_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE "public"."profiles"
    ADD CONSTRAINT "profiles_staff_type_check"
    CHECK (
      "staff_type" IS NULL
      OR "staff_type" IN ('CASHIER_TELLER', 'APPRAISER', 'INVENTORY_CUSTODIAN', 'AUDITOR')
    );
  END IF;
END
$$;

-- 6) Optional index to speed up staff filtering.
CREATE INDEX IF NOT EXISTS "profiles_staff_type_idx"
ON "public"."profiles" ("staff_type");
