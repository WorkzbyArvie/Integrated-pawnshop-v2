-- =============================================================================
-- PawnGold: REJECTED -> DENIED for compliance documents.
-- =============================================================================
--
-- WHY
--
-- The status was named REJECTED, and it was doing two jobs. The Super Admin had
-- declined a submission, but the label framed the shop as the thing being
-- turned away rather than the document. "Denied" is an administrative state a
-- document can be in and carry a way out of; "rejected" reads as a verdict on
-- the applicant. The shop does not get to appeal, re-upload and continue, and
-- the wording should say that.
--
-- SCOPE - deliberately narrow.
--
-- This renames ONE enum, `ComplianceDocStatus`, and ONE column on the table it
-- belongs to. Three other enums in this schema also contain a REJECTED value -
-- client registration requests, onboarding approvals and bidder KYC - and they
-- are left exactly as they are. Those are decisions about a person's
-- application to a platform, which is a genuinely different act from a
-- regulatory document, and folding them in here would change three flows nobody
-- asked about while this migration was in flight.
--
-- IDEMPOTENCE - the reason every statement below is guarded.
--
-- This migration may be executed by `prisma migrate deploy` on a database where
-- the rename has already been applied by hand, in the Supabase SQL editor. A
-- bare `ALTER TYPE ... RENAME VALUE 'REJECTED' TO 'DENIED'` is a fatal error in
-- that situation - the source label no longer exists, so Postgres raises
-- `22023 "REJECTED" is not an existing enum label` and the whole deploy dies
-- with P3018. That is not hypothetical: it is what happened, twice, and it took
-- the deployment down with it.
--
-- So each step is guarded on the state it expects. Applied to a database where
-- the rename is already in place, this is a no-op and records cleanly. Applied
-- to a fresh one, it does the work. Both are correct, which is the only property
-- that matters for a migration the deploy pipeline owns.
--
-- `ALTER TYPE ... RENAME VALUE` rewrites the value list in place: every existing
-- row keeps its data and its meaning, and no table rewrite happens.

-- 1. The enum value, only if the old label is still there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ComplianceDocStatus' AND e.enumlabel = 'REJECTED'
  ) THEN
    ALTER TYPE public."ComplianceDocStatus" RENAME VALUE 'REJECTED' TO 'DENIED';
  END IF;
END
$$;

-- 2. The reason column, so the schema does not read "denial" beside
--    "rejection_reason". Same model only.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pawnshop_documents'
      AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE public.pawnshop_documents
      RENAME COLUMN rejection_reason TO denial_reason;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- ROLLBACK
--
--   ALTER TYPE public."ComplianceDocStatus" RENAME VALUE 'DENIED' TO 'REJECTED';
--   ALTER TABLE public.pawnshop_documents
--     RENAME COLUMN denial_reason TO rejection_reason;
--
-- Safe at any time: the rename carries rows with it, so nothing is lost either
-- way and the order does not matter.
--
-- The deployed code must match the database. If the app is rolled back to the
-- previous build while the database is renamed, every compliance document read
-- will fail on the unknown enum value. Change one or the other, not both.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TRANSACTION
--
-- No BEGIN/COMMIT here, deliberately. Prisma wraps every migration in a
-- transaction on PostgreSQL, so a nested BEGIN is at best a no-op and at worst
-- commits Prisma's transaction before its bookkeeping runs.
--
-- The cost of getting that wrong was a deploy that failed with
-- "current transaction is aborted, commands ignored until end of transaction
-- block" instead of the real error - which was a column name that did not
-- exist. An aborted transaction reports the abort, not the cause, and Prisma
-- logs what Postgres said last. The genuine error is now visible in the log,
-- which is the only reason to care about this.
--
-- If you are running one of these by hand in the SQL editor rather than through
-- the pipeline, wrap your paste in BEGIN/COMMIT yourself.