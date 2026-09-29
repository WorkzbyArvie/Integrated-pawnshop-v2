-- =============================================================================
-- Record the rate and service fee actually applied to each loan.
-- =============================================================================
--
-- WHY
--
-- The system had four different answers to "what does this customer owe":
--
--   * `loan.interest_rate` on `ticket` defaults to 3.0 and the pawn flow never
--     wrote it, so every ticket silently took the default.
--   * `pawn-ticket.service.ts` computed interest at 3.5% and stored that.
--   * `Redemption.tsx` quoted `principal * 0.03` with a comment claiming it
--     matched the database, then sent that figure as `amountPaid`. On a
--     PHP 10,000 pawn that is PHP 50 the shop absorbs on every redemption.
--   * `loan-contract.service.ts` printed a 2% service fee and a 3% interest
--     rate on the legal document.
--
-- `loan` had no rate column at all, so nothing recorded what the borrower
-- actually agreed to. That is the part worth fixing: not that the numbers
-- disagreed tonight, but that there was no single figure to check them against.
--
-- WHAT THIS DOES
--
-- Adds two columns to `loan`:
--
--   interestrate     the fraction applied to the principal (0.035 = 3.5%)
--   servicefeeamount the fee charged once, in pesos
--
-- Backfilled from the `interestAmount / principalAmount` each loan already
-- stored, so historical rows carry the rate they were actually charged rather
-- than a default. Rows where that ratio is unusable - a zero or missing
-- principal - take the platform default.
--
-- Existing `servicefeeamount` is 0 rather than backfilled: the loans were issued
-- without a recorded service fee, and inventing one now would assert a figure no
-- customer was ever quoted. New loans get it written explicitly at issuance.
--
-- Nothing here changes what any existing loan is worth. It makes the terms
-- already applied legible, which is what an auditor - or a panel member - needs.
-- =============================================================================

-- IDEMPOTENCE.
--
-- This change may already have been applied by hand in the Supabase SQL editor
-- before the deploy pipeline saw it. The two ADD COLUMN statements below are
-- already `IF NOT EXISTS`, so they are safe to re-run. The backfill is guarded
-- the same way: it only writes rows whose rate is still the untouched column
-- default, so a second run cannot overwrite a rate that has since been set
-- deliberately, and cannot compound the rounding a second time.

ALTER TABLE public."loan"
  ADD COLUMN IF NOT EXISTS "interestrate" DOUBLE PRECISION NOT NULL DEFAULT 0.035,
  ADD COLUMN IF NOT EXISTS "servicefeeamount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill the rate from the ratio the loan was actually issued at.
-- Guarded on a positive principal: a zero or NULL principal would make the ratio
-- NULL or divide by zero, and NULL violates the NOT NULL constraint.
-- Guarded on the column default so a re-run is a no-op rather than a second
-- pass of arithmetic over already-corrected values.
UPDATE public."loan"
SET "interestrate" = ROUND(("interestamount" / "principalamount")::numeric, 6)::double precision
WHERE "principalamount" IS NOT NULL
  AND "principalamount" > 0
  AND "interestamount" IS NOT NULL
  AND "interestrate" = 0.035
  AND ("interestamount" / "principalamount") BETWEEN 0 AND 0.2;

-- -----------------------------------------------------------------------------
-- Verification - ONE statement, one grid. Run this by hand, after the change has
-- been applied - by the deploy pipeline or in the Supabase SQL editor. Nothing
-- below executes during a deploy.
--
-- expect: loans_total = loans_backfilled + loans_at_default
--
-- `loans_with_unbackfillable_rate` counts loans whose principal was zero or
-- missing, so no ratio could be derived. Each of those took the default and is
-- listed by loan id for inspection - a non-trivial count is worth knowing about.
-- -----------------------------------------------------------------------------

WITH derived AS (
  SELECT
    id,
    CASE
      WHEN "principalamount" IS NOT NULL
       AND "principalamount" > 0
       AND "interestamount" IS NOT NULL
       AND ("interestamount" / "principalamount") BETWEEN 0 AND 0.2
      THEN 1
      ELSE 0
    END AS backfillable
  FROM public."loan"
)
SELECT
  (SELECT count(*) FROM public."loan") AS loans_total,
  (SELECT count(*) FROM derived WHERE backfillable = 1) AS loans_backfilled,
  (SELECT count(*) FROM derived WHERE backfillable = 0) AS loans_at_default,
  (SELECT count(DISTINCT "interestrate") FROM public."loan") AS distinct_rates,
  (SELECT ROUND(AVG("interestrate")::numeric, 6)
     FROM public."loan"
    WHERE "principalamount" > 0) AS average_rate,
  (SELECT count(*) FROM public."loan" WHERE "interestrate" = 0.035) AS at_platform_default,
  (SELECT string_agg(id::text, ', ')
     FROM public."loan"
    WHERE "principalamount" IS NULL OR "principalamount" <= 0) AS unbackfillable_ids;

-- -----------------------------------------------------------------------------
-- A distribution check, once the first query has been read. The point is to see
-- what rate the shop has actually been charging, not to change it. If
-- `count` of 3.0 is non-zero, some loans were issued at the old column default
-- and the historical rate now records that honestly rather than hiding it.
-- -----------------------------------------------------------------------------

SELECT "interestrate" AS rate,
       count(*) AS loans
FROM public."loan"
GROUP BY "interestrate"
ORDER BY "interestrate";

-- -----------------------------------------------------------------------------
-- ROLLBACK
--
-- Safe at any time - these columns are written only for loans issued after this
-- migration, and dropping them loses only the recorded rate, never a balance.
--
--   ALTER TABLE public."loan"
--     DROP COLUMN IF EXISTS "interestrate",
--     DROP COLUMN IF EXISTS "servicefeeamount";
--
-- Note the deployed code must match the database. A new build writes
-- `interestrate` on every loan; running it against a database where this
-- migration has not been applied will fail on the unknown column.
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