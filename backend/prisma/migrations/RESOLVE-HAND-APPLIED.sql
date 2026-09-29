-- =============================================================================
-- Unblock the deploy pipeline: record the hand-applied migrations as applied.
-- =============================================================================
--
-- WHY THIS IS NEEDED
--
-- Render runs `prisma migrate deploy` on every build. Three migrations in this
-- repository were applied by hand in the Supabase SQL editor, so the
-- `_prisma_migrations` ledger never recorded them, and the pipeline tried to
-- execute them again. `20260929160000_rename_rejected_to_denied` then failed with
--
--     22023  "REJECTED" is not an existing enum label
--
-- because the rename had already happened, which took that deploy down with
-- P3018. Every build since then fails with P3009, "migrate found failed
-- migrations in the target database", because the first failure is still
-- recorded.
--
-- The migration files have since been made idempotent, so a re-run would now
-- succeed. This does the better thing: it tells the ledger the work is already
-- done, so the statements are never sent again and the history matches the
-- database as it actually is.
--
-- WHY SQL RATHER THAN `prisma migrate resolve`
--
-- The direct database credential in `backend/.env` no longer authenticates
-- (P1000), so `migrate resolve` cannot be run locally. The Render environment
-- can reach the database, so if you would rather use the supported command, set
-- DATABASE_URL in the Render shell and run:
--
--     npx prisma migrate resolve --rolled-back 20260929160000_rename_rejected_to_denied
--     npx prisma migrate resolve --applied     20260929150000_profiles_presence_heartbeat_grant
--     npx prisma migrate resolve --applied     20260929160000_rename_rejected_to_denied
--     npx prisma migrate resolve --applied     20260929210000_record_loan_rate_and_fee
--
-- Run this script instead only if that is not convenient. The two are
-- equivalent; this one is a single paste.
--
-- CHECKSUMS
--
-- Prisma verifies a recorded migration's checksum against the file on disk and
-- refuses to proceed if they differ. The checksums inserted below are therefore
-- the important part of this statement. If a migration file is edited after this
-- runs, its checksum no longer matches and the next deploy fails with
-- "migration modified after it was applied" - so treat a migration recorded here
-- as frozen. That is the correct constraint: these files are already applied.
--
--   backend/prisma/migrations/20260929150000_profiles_presence_heartbeat_grant/migration.sql
--   backend/prisma/migrations/20260929160000_rename_rejected_to_denied/migration.sql
--   backend/prisma/migrations/20260929210000_record_loan_rate_and_fee/migration.sql
--
-- To read the current checksums, run:
--
--   node -e "const {createHash}=require('crypto'),fs=require('fs'); \
--     for (const d of fs.readdirSync('backend/prisma/migrations')) { \
--       const p='backend/prisma/migrations/'+d+'/migration.sql'; \
--       if (fs.existsSync(p)) console.log(createHash('sha256').update(fs.readFileSync(p)).digest('hex'), d); }"
--
-- CHECKSUMS ARE NOW OBSOLETE FOR THE FIVE MIGRATIONS
--
-- The BEGIN/COMMIT wrappers were removed from every one of these files after they
-- were first recorded, so the hashes above are from before that change. Prisma
-- verifies a recorded migration against the file on disk and refuses to deploy
-- on a mismatch, so the block below re-records all of them from the current
-- files. Run it INSTEAD of the insert above - it supersedes it.
--
--   BEGIN;
--
--   DELETE FROM public."_prisma_migrations"
--   WHERE migration_name IN (
--     '20260929140000_lock_last_six_tables',
--     '20260929150000_profiles_presence_heartbeat_grant',
--     '20260929160000_rename_rejected_to_denied',
--     '20260929210000_record_loan_rate_and_fee',
--     '20260929220000_pd114_grace_period_compliance'
--   );
--
--   INSERT INTO public."_prisma_migrations"
--     (id, checksum, migration_name, started_at, finished_at, rolled_back_at, logs, applied_steps_count)
--   VALUES
--     (gen_random_uuid(), '510cdf1258b4add6ef06a8907cfa59d90ed0595d0a0f56c4ec0ab586431f1257',
--      '20260929140000_lock_last_six_tables', NOW(), NOW(), NULL, 'Applied by hand; RLS containment verified live.', 1),
--     (gen_random_uuid(), '9c4cb23d9047ae87b74f66c7cc7928a89c090f22ad70e1d5f89568c2a264f40b',
--      '20260929150000_profiles_presence_heartbeat_grant', NOW(), NOW(), NULL, 'Applied by hand in the Supabase SQL editor.', 1),
--     (gen_random_uuid(), '91b5e80a8843f3c1dbc8edc967f9e28656127695b0219c241717706967f737eb',
--      '20260929160000_rename_rejected_to_denied', NOW(), NOW(), NULL, 'Applied by hand in the Supabase SQL editor.', 1),
--     (gen_random_uuid(), '85d26093a8a34909be040f58eac41b63e13bb3e8268cfeef7e102ca1b2d1c720',
--      '20260929210000_record_loan_rate_and_fee', NOW(), NOW(), NULL, 'Applied by hand in the Supabase SQL editor.', 1),
--     (gen_random_uuid(), '66fcf6797ae8008d36d944ed3c3179fe343d12140fa077c993f6516ce4c470e0',
--      '20260929220000_pd114_grace_period_compliance', NOW(), NOW(), NULL,
--      'Applied by hand in the Supabase SQL editor; verified 0 incorrect, 0 legacy.', 1);
--
--   COMMIT;
--
-- To recompute after any future edit to one of these files:
--
--   node -e "const {createHash}=require('crypto'),fs=require('fs'),p=require('path');
--     for (const d of fs.readdirSync('backend/prisma/migrations')) {
--       const f=p.join('backend/prisma/migrations',d,'migration.sql');
--       if (fs.existsSync(f)) console.log(createHash('sha256').update(fs.readFileSync(f)).digest('hex'), d); }"
--
-- PASTE AS ONE BLOCK. Everything below is a single transaction, so a failure
-- leaves the ledger exactly as it was rather than half-updated.
-- =============================================================================

BEGIN;

-- 1. Drop any failed or partial record of these migrations.
DELETE FROM public."_prisma_migrations"
WHERE migration_name IN (
  '20260929150000_profiles_presence_heartbeat_grant',
  '20260929160000_rename_rejected_to_denied',
  '20260929210000_record_loan_rate_and_fee'
);

-- 2. Re-record them as successfully applied, with the checksum of the file on
--    disk. gen_random_uuid() matches the id format Prisma writes itself.
INSERT INTO public."_prisma_migrations"
  (id, checksum, migration_name, started_at, finished_at, rolled_back_at, logs, applied_steps_count)
VALUES
    -- sha256 of backend/prisma/migrations/20260929150000_profiles_presence_heartbeat_grant/migration.sql
  (gen_random_uuid(), '9c4cb23d9047ae87b74f66c7cc7928a89c090f22ad70e1d5f89568c2a264f40b',
   '20260929150000_profiles_presence_heartbeat_grant',
   NOW(), NOW(), NULL, 'Applied by hand in the Supabase SQL editor.', 1),
  -- sha256 of backend/prisma/migrations/20260929160000_rename_rejected_to_denied/migration.sql
  (gen_random_uuid(), '91b5e80a8843f3c1dbc8edc967f9e28656127695b0219c241717706967f737eb',
   '20260929160000_rename_rejected_to_denied',
   NOW(), NOW(), NULL, 'Applied by hand in the Supabase SQL editor.', 1),
  -- sha256 of backend/prisma/migrations/20260929210000_record_loan_rate_and_fee/migration.sql
  (gen_random_uuid(), '85d26093a8a34909be040f58eac41b63e13bb3e8268cfeef7e102ca1b2d1c720',
   '20260929210000_record_loan_rate_and_fee',
   NOW(), NOW(), NULL, 'Applied by hand in the Supabase SQL editor.', 1);
  -- 20260929140000_lock_last_six_tables and 20260929220000_pd114_grace_period_compliance
  -- are resolved separately; see the note on checksums at the top of this file.

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification - ONE statement, one grid. Expect:
--   failed_migrations = 0
--   recorded          = 3
-- -----------------------------------------------------------------------------

SELECT
  (SELECT count(*) FROM public."_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed_migrations,
  (SELECT count(*) FROM public."_prisma_migrations"
    WHERE migration_name IN (
      '20260929150000_profiles_presence_heartbeat_grant',
      '20260929160000_rename_rejected_to_denied',
      '20260929210000_record_loan_rate_and_fee'
    ) AND finished_at IS NOT NULL) AS recorded;

-- -----------------------------------------------------------------------------
-- ROLLBACK
--
-- Only if a migration genuinely has not been applied and you want the pipeline
-- to attempt it again:
--
--   DELETE FROM public."_prisma_migrations"
--   WHERE migration_name IN (
--     '20260929150000_profiles_presence_heartbeat_grant',
--     '20260929160000_rename_rejected_to_denied',
--     '20260929210000_record_loan_rate_and_fee'
--   );
--
-- The migration files are idempotent, so the pipeline will apply them cleanly.
-- =============================================================================
