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
-- `ALTER TYPE ... RENAME VALUE` rewrites the type's value list in place: every
-- existing row keeps its data and keeps its meaning, and no table rewrite
-- happens. This is why the status is renamed rather than re-added-and-migrated,
-- and it is also why it must not be followed by a hand-written UPDATE - there is
-- nothing to migrate.
--
-- Run each block below as its own paste. The SQL editor renders only the last
-- result set of a multi-statement paste, so a single block would show one grid
-- and read as "the rest passed" when nothing else was displayed.

-- -----------------------------------------------------------------------------
-- 1. The enum value.
-- -----------------------------------------------------------------------------
-- Not wrapped in BEGIN/COMMIT. `ALTER TYPE ... RENAME VALUE` is transactional
-- on modern Postgres, but the DDL in block 2 and this are independent steps and
-- keeping them separate means a failure leaves a clear, resumable position.

ALTER TYPE public."ComplianceDocStatus" RENAME VALUE 'REJECTED' TO 'DENIED';

-- -----------------------------------------------------------------------------
-- 2. The reason column, so the schema does not read "denial" beside
--    "rejection_reason". Same model only.
-- -----------------------------------------------------------------------------

ALTER TABLE public.pawnshop_documents
  RENAME COLUMN rejection_reason TO denial_reason;

-- -----------------------------------------------------------------------------
-- 3. Verification - ONE statement, one grid. Expect a single row reading:
--      denied_value_present = t
--      rejected_value_present = f
--      denial_reason_column = t
--      rejection_reason_column = f
--      denied_rows_preserved = <count of previously-rejected rows; 0 is normal>
-- -----------------------------------------------------------------------------

SELECT
  EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ComplianceDocStatus' AND e.enumlabel = 'DENIED'
  ) AS denied_value_present,
  EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ComplianceDocStatus' AND e.enumlabel = 'REJECTED'
  ) AS rejected_value_present,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pawnshop_documents'
      AND column_name = 'denial_reason'
  ) AS denial_reason_column,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pawnshop_documents'
      AND column_name = 'rejection_reason'
  ) AS rejection_reason_column,
  (SELECT count(*) FROM public.pawnshop_documents WHERE status = 'DENIED') AS denied_rows_preserved;

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
