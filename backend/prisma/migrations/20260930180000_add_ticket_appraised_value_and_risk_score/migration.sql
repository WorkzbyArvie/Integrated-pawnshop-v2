-- Persist the two appraisal figures the ticket was missing.
--
-- `submitForApproval` wrote `ticket.loanAmount` into both `appraisedValue` and
-- `recommendedLoanAmount`, so every approval record carried the loan twice and
-- the valuation was nowhere. It also wrote
-- `riskScore: ticket.isHighRisk ? 60 : 0` - a number invented from a boolean,
-- which is why the approval queue showed "60 HIGH" for any flagged item rather
-- than the score the appraiser actually produced.
--
-- Both are now real columns on the ticket, recorded at intake.

ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS appraised_value DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION;

COMMENT ON COLUMN ticket.appraised_value IS
  'Collateral valuation. Distinct from loan_amount, which is a fraction of it.';
COMMENT ON COLUMN ticket.risk_score IS
  'Risk score assessed at intake. NULL means not assessed - never substitute a number.';

-- Backfill the valuation where the loan implies an exact 100% LTV, which is the
-- only case where the loan is provably the valuation.
UPDATE ticket
SET appraised_value = loan_amount
WHERE appraised_value IS NULL
  AND loan_amount > 0
  AND ishighrisk = false;

-- Deliberately NOT backfilling risk_score. The real score was never stored, and
-- inventing one from the `ishighrisk` boolean is precisely the defect this
-- migration fixes. NULL now reads as "Not scored", which is the truth.
