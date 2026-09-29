/**
 * Loan and renewal terms, in one place.
 *
 * The codebase previously had four different answers to "how long is a pawn for":
 * a hardcoded `termMonths: 1` on the pawn flow, a DTO that accepted anything up
 * to 60 months, a contract that multiplied `termMonths * 30` days to reach
 * maturity, and a renewal that extended `extensionDays || 30`. A reviewer reading
 * the code and the thesis side by side could not reconcile them.
 *
 * Terms are expressed in DAYS. That is the unit the lifecycle actually operates
 * in - `renewLoan` extends by days, the grace period is 30 days, forfeiture
 * follows 15 days after grace - so expressing the term in days too means the
 * contract, the ticket, and the renewal cannot drift apart.
 *
 * 30 days is the conventional term for pawned items in the Philippines, and it
 * is what the pawn flow and the renewal both already did. The database column is
 * `term_months`, which is retained for schema compatibility: every read of it
 * goes through {@link toTermMonths} so the month count is derived rather than
 * stored independently.
 */

/** Standard pawn term from disbursement to maturity. */
export const PAWN_TERM_DAYS = 30;

/** Days added by a renewal, on top of the accrued interest being paid. */
export const RENEWAL_EXTENSION_DAYS = 30;

/**
 * Grace period after maturity during which the borrower may still redeem before
 * the item is forfeited.
 */
export const GRACE_PERIOD_DAYS = 30;

/**
 * Days after the grace period ends before collateral is forfeited and routed to
 * auction.
 */
export const FORFEITURE_GRACE_DAYS = 15;

/** Longest term the loan-application API will accept, in days. */
export const MAX_LOAN_TERM_DAYS = 60;

/**
 * Convert a stored `term_months` value into days.
 *
 * A whole number of months is rounded up to the equivalent whole days so a
 * one-month term cannot silently become 29 days. Any fractional or out-of-range
 * value falls back to the standard term rather than producing a nonsense
 * maturity date.
 */
export function toTermDays(termMonths: number | null | undefined): number {
  if (typeof termMonths !== 'number' || !Number.isFinite(termMonths)) {
    return PAWN_TERM_DAYS;
  }
  if (termMonths <= 0) return PAWN_TERM_DAYS;
  return Math.ceil(termMonths * PAWN_TERM_DAYS);
}

/** Days to whole months, rounded up. Never returns less than 1. */
export function toTermMonths(termDays: number | null | undefined): number {
  if (typeof termDays !== 'number' || !Number.isFinite(termDays) || termDays <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(termDays / PAWN_TERM_DAYS));
}

/**
 * The maturity date for a loan of `termDays`, measured from `from`.
 *
 * Every caller derives the maturity date from here rather than multiplying a
 * month count inline. The previous `termMonths * 30 * 24 * 60 * 60 * 1000`
 * arithmetic silently disagreed with a real calendar month, which is how a
 * contract could state a maturity date the ticket did not agree with.
 */
export function maturityDateFrom(
  termDays: number = PAWN_TERM_DAYS,
  from: Date = new Date(),
): Date {
  const maturity = new Date(from);
  maturity.setDate(maturity.getDate() + termDays);
  return maturity;
}

/** The grace-period end for a maturity date. */
export function gracePeriodEndFrom(
  maturityDate: Date,
  graceDays: number = GRACE_PERIOD_DAYS,
): Date {
  const end = new Date(maturityDate);
  end.setDate(end.getDate() + graceDays);
  return end;
}

/** The forfeiture date for a grace-period end. */
export function forfeitureDateFrom(
  gracePeriodEnd: Date,
  days: number = FORFEITURE_GRACE_DAYS,
): Date {
  const date = new Date(gracePeriodEnd);
  date.setDate(date.getDate() + days);
  return date;
}
