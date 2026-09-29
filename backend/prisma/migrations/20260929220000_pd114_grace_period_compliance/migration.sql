-- =============================================================================
-- P.D. 114 compliance: 90-day redemption window, 30% minimum loan.
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
-- The system used a 30-day grace period, which is a third of the statutory
-- window. The consequence is not a rounding difference: under the old setting a
-- branch could lawfully hold collateral for 30 days after maturity and then
-- dispose of it, when the borrower was entitled to 90. Every live ticket with a
-- grace_period_end carries a deadline that understates the borrower's right, and
-- every ticket whose forfeiture_date has already passed on the 30-day basis may
-- have been sold early.
--
-- What this migration does:
--
--   1. Recomputes grace_period_end as expiry_date + 90 days, for tickets that
--      have not yet been forfeited. A borrower who is still inside the correct
--      window gets it back; a ticket already forfeited is left alone, because
--      moving its date cannot un-dispose of collateral and would misrepresent
--      the history.
--
--   2. Recomputes forfeiture_date as grace_period_end + 15 days, for the same
--      set. The 15 days is the system's own post-grace handling window, not a
--      statutory figure - PD 114 sets no separate period, only the 90-day
--      redemption right and the requirement of notice under Section 14.
--
--   3. Leaves EXPIRED and forfeited tickets untouched, and says so in the log
--      count so the number of affected historical rows is visible.
--
-- THE VALUES ARE NOT GUESSED. The 90 is Section 13, quoted above. The 15 is
-- unchanged from the current configuration, so this migration alters the grace
-- period only and leaves the post-grace window exactly as it was.
--
-- NOTE ON NOTICE. Section 14 requires the pawnee to notify the pawner of the
-- sale "on or before the termination of the ninety-day period, the notice
-- particularly stating the date, hour, and place of sale." A correct
-- grace_period_end is a precondition for that notice being timely, and it makes
-- the notice computable. It is not by itself the notice.
-- =============================================================================

BEGIN;

-- 1. Recompute the grace period on tickets still within the borrower's window.
--
--   Guarded on lifecycleStatus so a ticket that has already moved past
--   GRACE_PERIOD keeps its history. A forged-back date on a forfeited ticket
--   would be worse than a wrong one: it would suggest collateral was still held
--   when it was not.
UPDATE public.ticket
SET "gracePeriodEnd" = "expiryDate" + INTERVAL '90 days',
    "updatedat"     = NOW()
WHERE "expiryDate" IS NOT NULL
  AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
  AND ("gracePeriodEnd" IS DISTINCT FROM "expiryDate" + INTERVAL '90 days');

-- 2. Push the forfeiture date out to match, for the same set of tickets.
UPDATE public.ticket
SET "forfeitureDate" = "gracePeriodEnd" + INTERVAL '15 days',
    "updatedat"      = NOW()
WHERE "gracePeriodEnd" IS NOT NULL
  AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
  AND ("forfeitureDate" IS DISTINCT FROM "gracePeriodEnd" + INTERVAL '15 days');

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification - ONE statement, one grid.
--
--   tickets_with_expiry  every ticket with a maturity date to check against
--   grace_now_correct    grace_period_end == expiry + 90, for the live set
--   grace_incorrect      live tickets still wrong after this migration
--   grace_30day_legacy   live tickets still holding the old 30-day window
--   forfeiture_aligned   forfeiture_date == grace + 15, for the live set
--   historical_untouched forfeited/EXPIRED rows deliberately left alone
--
-- Expect: grace_incorrect = 0 and grace_30day_legacy = 0.
-- -----------------------------------------------------------------------------

SELECT
  (SELECT count(*) FROM public.ticket WHERE "expiryDate" IS NOT NULL) AS tickets_with_expiry,
  (SELECT count(*) FROM public.ticket
    WHERE "expiryDate" IS NOT NULL
      AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "gracePeriodEnd" = "expiryDate" + INTERVAL '90 days') AS grace_now_correct,
  (SELECT count(*) FROM public.ticket
    WHERE "expiryDate" IS NOT NULL
      AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND ("gracePeriodEnd" IS NULL
           OR "gracePeriodEnd" <> "expiryDate" + INTERVAL '90 days')) AS grace_incorrect,
  (SELECT count(*) FROM public.ticket
    WHERE "expiryDate" IS NOT NULL
      AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "gracePeriodEnd" = "expiryDate" + INTERVAL '30 days') AS grace_30day_legacy,
  (SELECT count(*) FROM public.ticket
    WHERE "expiryDate" IS NOT NULL
      AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "gracePeriodEnd" IS NOT NULL
      AND "forfeitureDate" = "gracePeriodEnd" + INTERVAL '15 days') AS forfeiture_aligned,
  (SELECT count(*) FROM public.ticket
    WHERE "lifecycleStatus" NOT IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD')
      AND "expiryDate" IS NOT NULL) AS historical_untouched;

-- -----------------------------------------------------------------------------
-- Per-status breakdown, to see what was changed and what was deliberately not.
-- `lifecycle_status` is the input; the grace column is the effective window.
-- -----------------------------------------------------------------------------

SELECT "lifecycleStatus" AS status,
       count(*) AS tickets,
       count(*) FILTER (
         WHERE "expiryDate" IS NOT NULL
           AND "gracePeriodEnd" = "expiryDate" + INTERVAL '90 days'
       ) AS at_90_days,
       count(*) FILTER (
         WHERE "expiryDate" IS NOT NULL
           AND "gracePeriodEnd" = "expiryDate" + INTERVAL '30 days'
       ) AS still_30_days
FROM public.ticket
GROUP BY "lifecycleStatus"
ORDER BY "lifecycleStatus";

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
--     SET "gracePeriodEnd" = "expiryDate" + INTERVAL '30 days',
--         "forfeitureDate" = "expiryDate" + INTERVAL '45 days'
--     WHERE "expiryDate" IS NOT NULL
--       AND "lifecycleStatus" IN ('ACTIVE', 'OVERDUE', 'GRACE_PERIOD');
--
--   COMMIT;
--
-- Idempotent. Applied to a database that already holds 90-day windows it is a
-- no-op, so it is safe to run more than once.
-- =============================================================================
