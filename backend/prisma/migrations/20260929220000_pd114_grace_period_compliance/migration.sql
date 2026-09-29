-- =============================================================================
-- P.D. 114 compliance: 90-day redemption window.
-- =============================================================================
--
-- SECTION 13 (the redemption window)
--
--   "The pawner who fails to pay his obligation on the date it falls due may,
--    within ninety days from the date of maturity of the obligation, redeem the
--    pawn by payment of the principal of the debt with interest."
--
--   SECTION 14 (disposal on default)
--
--   "In the event the pawner fails to redeem the pawn within ninety days from
--    the date of maturity of the obligation ... the pawnbroker may sell or
--    otherwise dispose of any article taken or received by him in pawn."
--
-- The system used a 30-day grace period, a third of the statutory window. The
-- consequence is not a rounding difference: under the old setting a branch could
-- hold collateral for 30 days after maturity and then dispose of it, when the
-- borrower was entitled to 90. Every live ticket with a grace_period_end carries
-- a deadline that understates the borrower's right.
--
-- COLUMN NAMING
--
-- `ticket` mixes conventions, and this migration is the second attempt. The
-- columns are:
--
--     lifecycle_status   mapped explicitly, snake_case
--     expiry_date        mapped explicitly, snake_case
--     grace_period_end   mapped explicitly, snake_case
--     forfeituredate     mapped, but with NO separator - not "forfeiture_date"
--     updatedat          mapped, but with NO separator - not "updated_at"
--
-- The first attempt used the Prisma field names (`expiryDate`, `forfeitureDate`,
-- `gracePeriodEnd`, `updatedAt`) and Postgres rejected it with
--
--     42703  column "expiryDate" does not exist
--     HINT:  Perhaps you meant to reference the column "ticket.expiry_date".
--
-- and the transaction rolled back, so nothing was half-applied. The names below
-- are taken from the `@map` attributes in `schema.prisma`, not inferred. A
-- second guess here would be a third dead end.
--
-- WHAT THIS DOES
--
--   1. Recomputes grace_period_end as expiry_date + 90 days, for tickets that
--      have not yet been forfeited. A borrower who is still inside the correct
--      window gets it back.
--
--   2. Recomputes forfeituredate as grace_period_end + 15 days, for the same
--      set. The 15 days is the system's own post-grace handling window, not a
--      statutory figure - PD 114 sets no separate period, only the 90-day
--      redemption right and the Section 14 notice requirement.
--
--   3. Leaves forfeited and EXPIRED rows untouched, and reports the count. A
--      correct date on collateral that has already been disposed of would
--      misrepresent the history rather than remedy anything.
--
-- THE VALUES ARE NOT GUESSED. The 90 is Section 13, quoted above. The 15 is
-- unchanged from the current configuration, so this alters the grace period only.
--
-- NOTE ON NOTICE. Section 14 requires the pawnee to notify the pawner of the
-- sale "on or before the termination of the ninety-day period, the notice
-- particularly stating the date, hour, and place of sale." A correct
-- grace_period_end is a precondition for that notice being timely and makes it
-- computable. It is not by itself the notice.
-- =============================================================================

BEGIN;

-- 1. Recompute the grace period on tickets still within the borrower's window.
--
--   Guarded on lifecycle_status so a ticket that has already moved past
--   GRACE_PERIOD keeps its history.
UPDATE public.ticket
SET "grace_period_end" = "expiry_date" + INTERVAL '90 days',
    "updatedat"         = NOW()
WHERE "expiry_date" IS NOT NULL
  AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
  AND ("grace_period_end" IS DISTINCT FROM "expiry_date" + INTERVAL '90 days');

-- 2. Push the forfeiture date out to match, for the same set of tickets.
UPDATE public.ticket
SET "forfeituredate" = "grace_period_end" + INTERVAL '15 days',
    "updatedat"      = NOW()
WHERE "grace_period_end" IS NOT NULL
  AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
  AND ("forfeituredate" IS DISTINCT FROM "grace_period_end" + INTERVAL '15 days');

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification - ONE statement, one grid. snake_case, as above.
--
--   tickets_with_expiry  tickets with a maturity date to check against
--   grace_now_correct    grace_period_end == expiry_date + 90, for the live set
--   grace_incorrect      live tickets still wrong after this migration
--   grace_30day_legacy   live tickets still holding the old 30-day window
--   forfeiture_aligned   forfeituredate == grace_period_end + 15, live set
--   historical_untouched forfeited/EXPIRED rows deliberately left alone
--
-- Expect: grace_incorrect = 0 and grace_30day_legacy = 0.
-- -----------------------------------------------------------------------------

SELECT
  (SELECT count(*) FROM public.ticket WHERE "expiry_date" IS NOT NULL) AS tickets_with_expiry,
  (SELECT count(*) FROM public.ticket
    WHERE "expiry_date" IS NOT NULL
      AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "grace_period_end" = "expiry_date" + INTERVAL '90 days') AS grace_now_correct,
  (SELECT count(*) FROM public.ticket
    WHERE "expiry_date" IS NOT NULL
      AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND ("grace_period_end" IS NULL
           OR "grace_period_end" <> "expiry_date" + INTERVAL '90 days')) AS grace_incorrect,
  (SELECT count(*) FROM public.ticket
    WHERE "expiry_date" IS NOT NULL
      AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "grace_period_end" = "expiry_date" + INTERVAL '30 days') AS grace_30day_legacy,
  (SELECT count(*) FROM public.ticket
    WHERE "expiry_date" IS NOT NULL
      AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "grace_period_end" IS NOT NULL
      AND "forfeituredate" = "grace_period_end" + INTERVAL '15 days') AS forfeiture_aligned,
  (SELECT count(*) FROM public.ticket
    WHERE "lifecycle_status" NOT IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "expiry_date" IS NOT NULL) AS historical_untouched;

-- -----------------------------------------------------------------------------
-- Per-status breakdown, to see what changed and what was deliberately not.
-- -----------------------------------------------------------------------------

SELECT "lifecycle_status" AS status,
       count(*) AS tickets,
       count(*) FILTER (
         WHERE "expiry_date" IS NOT NULL
           AND "grace_period_end" = "expiry_date" + INTERVAL '90 days'
       ) AS at_90_days,
       count(*) FILTER (
         WHERE "expiry_date" IS NOT NULL
           AND "grace_period_end" = "expiry_date" + INTERVAL '30 days'
       ) AS still_30_days
FROM public.ticket
GROUP BY "lifecycle_status"
ORDER BY "lifecycle_status";

-- -----------------------------------------------------------------------------
-- ROLLBACK
--
-- Safe in the sense that it is a data change you can undo; it is not a no-op.
-- Reverting restores the 30-day window, which is the non-compliant state. Only
-- do this to reproduce the earlier behaviour, never to run the system.
--
--   BEGIN;
--
--     UPDATE public.ticket
--     SET "grace_period_end" = "expiry_date" + INTERVAL '30 days',
--         "forfeituredate"    = "expiry_date" + INTERVAL '45 days'
--     WHERE "expiry_date" IS NOT NULL
--       AND "lifecycle_status" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD');
--
--   COMMIT;
--
-- Idempotent. Applied to a database that already holds 90-day windows it is a
-- no-op, so it is safe to run more than once.
-- =============================================================================
