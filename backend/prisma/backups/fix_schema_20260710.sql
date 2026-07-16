-- Fix DB schema drift: ensure ticket table has lifecycle_status and related columns
-- Run this against your Supabase DB (direct connection, NOT PgBouncer)

-- 1. Create TicketLifecycleStatus enum if missing (original values)
DO $$ BEGIN
  CREATE TYPE "public"."TicketLifecycleStatus" AS ENUM (
    'RECEIVED', 'APPRAISED', 'OFFER_MADE', 'CONTRACT_SIGNED', 'DISBURSED',
    'ACTIVE', 'GRACE_PERIOD', 'OVERDUE', 'REDEEMED', 'FORFEITED',
    'AUCTION_QUEUED', 'AUCTION_SOLD', 'AUCTION_UNSOLD', 'CANCELLED',
    'PENDING_APPROVAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add lifecycle_status to ticket table (if missing)
ALTER TABLE "public"."ticket"
ADD COLUMN IF NOT EXISTS "lifecycle_status" "public"."TicketLifecycleStatus" NOT NULL DEFAULT 'RECEIVED';

-- 3. Add grace_period_end to ticket table (if missing)
ALTER TABLE "public"."ticket"
ADD COLUMN IF NOT EXISTS "grace_period_end" TIMESTAMPTZ;

-- 4. Add contract_id to ticket table (if missing)
ALTER TABLE "public"."ticket"
ADD COLUMN IF NOT EXISTS "contract_id" UUID;

-- 5. Add receipt_id to legal_proofs table (if missing)
ALTER TABLE "public"."legal_proofs"
ADD COLUMN IF NOT EXISTS "receipt_id" UUID;

-- 6. Add PENDING_APPROVAL to the enum (safe idempotent add)
ALTER TYPE "public"."TicketLifecycleStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';

-- 7. Confirm columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ticket'
ORDER BY ordinal_position;
