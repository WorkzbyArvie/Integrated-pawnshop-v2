/**
 * The cost of pawning money, defined once and configurable per pawnshop.
 *
 * This project had four answers to "what does a customer owe", and they did not
 * agree:
 *
 *   - `schema.prisma`  : `loan.interestRate` defaults to 3.0 and the pawn flow
 *                        never wrote it, so every loan silently took the default.
 *   - `pawn-ticket.service.ts` : computed interest at 3.5% and stored that.
 *   - `Redemption.tsx`  : quoted the customer `principal * 0.03` with a comment
 *                        claiming it matched the database, then sent that figure
 *                        as `amountPaid`. The staff member read a 3% total and
 *                        the system accepted it, so a ₱10,000 pawn silently lost
 *                        ₱50 on every redemption.
 *   - `loan-contract.service.ts` : printed a 2% service fee on the legal
 *                        document while charging something else in practice.
 *
 * The column default was the tell: it was never written, so it was never true.
 *
 * This is a multi-tenant system, so a single hardcoded rate would be the wrong
 * shape of fix. Two pawnshops on the same platform may quote different rates, and
 * a branch that changes its pricing must not require a code change. So the rates
 * are per-shop configuration held in `pawnshops.settings`, with the platform
 * defaults below as the fallback for any shop that has never set them.
 *
 * The invariant that matters: a quote shown to a customer, the figure recorded
 * against the loan, the figure printed on the contract, and the figure collected
 * at renewal are the same expression evaluated on the same rate. Not four
 * correct numbers that happen to agree today.
 */

/** Platform default monthly interest, as a fraction of principal. */
export const DEFAULT_MONTHLY_INTEREST_RATE = 0.035;

/**
 * Platform default service fee, as a fraction of principal, charged once on
 * issuance.
 *
 * PRESIDENTIAL DECREED NO. 114, Section 10:
 *
 *   "In addition to interest charges, pawnshops may impose a maximum service
 *    charge of five pesos (P5.00), but in no case to exceed one per cent (1%)
 *    of the principal loan."
 *
 * The cap is the LESSER of the two, so this percentage is a ceiling and not a
 * schedule: on a PHP 10,000 pawn the 1% is 100 and the cap bites at 5. A shop
 * charging 2% is not permitted, and the earlier default in this module did
 * exactly that. {@link serviceFeeFor} applies the lesser-of rule; this constant
 * is only the percentage half of it.
 */
export const MAX_SERVICE_FEE_PCT = 0.01;

/** Absolute service-fee cap, in pesos. Section 10. */
export const SERVICE_FEE_CAP_PESOS = 5;

/**
 * Platform default service fee rate.
 *
 * Kept at the statutory ceiling rather than a figure below it, because the
 * lower of the two caps is what actually governs and a shop pricing below 1%
 * has not opted out of the statute - it has simply been more conservative.
 */
export const DEFAULT_SERVICE_FEE_RATE = MAX_SERVICE_FEE_PCT;

/** Default late penalty on the outstanding principal, as a fraction, per month. */
export const DEFAULT_LATE_PENALTY_RATE = 0.03;

/**
 * Bounds on what a shop may configure.
 *
 * A rate outside this range is not a pricing decision, it is a data-entry
 * accident, and it is the kind a panel member will try. The floor keeps a
 * zero-rate configuration - which would let a shop issue interest-free pawns and
 * quietly stop being a lender - from being saved by a typo.
 */
export const MIN_INTEREST_RATE = 0;
export const MAX_INTEREST_RATE = 0.2;
export const MIN_SERVICE_FEE_RATE = 0;
export const MIN_LATE_PENALTY_RATE = 0;
export const MAX_LATE_PENALTY_RATE = 0.2;

/**
 * P.D. 114 Section 9, the statutory minimum loan.
 *
 *   "the amount of loan shall, in no case, be less than thirty per cent (30%)
 *    of the appraised value of the security offered for the loan unless the
 *    pawner manifests in writing the desire to borrow a lesser amount."
 *
 * A floor, not a ceiling: there is no maximum, and the loan amount is otherwise
 * whatever the parties agree. Nothing in the system enforced this, so a
 * mis-valued appraisal could produce a loan below the statutory minimum with
 * nothing objecting.
 *
 * The written-consent exception is recorded rather than assumed - see
 * {@link isBelowStatutoryMinimum}.
 */
export const STATUTORY_MIN_LTV = 0.3;

export interface RateConfig {
  monthlyInterestRate: number;
  serviceFeeRate: number;
  latePenaltyRate: number;
}

export const DEFAULT_RATES: Readonly<RateConfig> = Object.freeze({
  monthlyInterestRate: DEFAULT_MONTHLY_INTEREST_RATE,
  serviceFeeRate: DEFAULT_SERVICE_FEE_RATE,
  latePenaltyRate: DEFAULT_LATE_PENALTY_RATE,
});

/** Key names as they are stored in `pawnshops.settings`. */
export const RATE_SETTING_KEYS = {
  interest: 'interestRate',
  serviceFee: 'serviceFeeRate',
  latePenalty: 'latePenaltyRate',
} as const;

function isUsableRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_INTEREST_RATE
  );
}

/**
 * Read a shop's configured rates, falling back per-field.
 *
 * Falls back field by field rather than wholesale, so a shop that has set only
 * an interest rate still gets the default fee. Any unusable value - a string, a
 * negative, a percentage someone typed as `3.5` instead of `0.035`, an
 * out-of-range figure - is ignored in favour of the default, because a wrong
 * number here becomes a wrong number on a contract.
 */
export function resolveRates(settings: unknown): RateConfig {
  if (!settings || typeof settings !== 'object') return { ...DEFAULT_RATES };
  const record = settings as Record<string, unknown>;

  const pick = (key: string, fallback: number): number => {
    const raw = record[key];
    return isUsableRate(raw) ? raw : fallback;
  };

  return {
    monthlyInterestRate: pick(
      RATE_SETTING_KEYS.interest,
      DEFAULT_MONTHLY_INTEREST_RATE,
    ),
    serviceFeeRate: pick(RATE_SETTING_KEYS.serviceFee, DEFAULT_SERVICE_FEE_RATE),
    latePenaltyRate: pick(
      RATE_SETTING_KEYS.latePenalty,
      DEFAULT_LATE_PENALTY_RATE,
    ),
  };
}

/** Rounded to the centavo. Every money figure leaving this module goes through it. */
export function toCentavos(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export interface LoanBreakdown {
  principal: number;
  /** One month of interest on the principal. */
  interest: number;
  /** Fee charged once, capped per P.D. 114 s.10. */
  serviceFee: number;
  /** principal + interest + serviceFee. What the customer pays to redeem. */
  total: number;
  interestRate: number;
  serviceFeeRate: number;
  /**
   * The fee that would be charged with no cap applied, kept for the contract and
   * the receipt so the reduction is visible rather than invisible. A pawner
   * seeing PHP 5 charged where 1% would have been PHP 100 is entitled to know
   * that the cap, not the rate, produced the figure.
   */
  serviceFeeUncapped: number;
  /** True when the flat peso cap bound rather than the percentage. */
  serviceFeeCappedByStatute: boolean;
}

/**
 * The service fee, applying the P.D. 114 Section 10 cap.
 *
 * The cap is the LESSER of a percentage of principal and a flat peso amount, so
 * the fee is not proportional: on a PHP 500 pawn the 1% is PHP 5 and the flat cap
 * is also PHP 5, while on a PHP 10,000 pawn the 1% is PHP 100 and the flat cap
 * still binds at PHP 5. Treating the percentage as a schedule - which is what an
 * earlier version of this module did - charges 200% of the permitted fee on a
 * large loan, which is a statutory violation and not a rounding difference.
 */
export function serviceFeeFor(principal: number, rates: RateConfig = DEFAULT_RATES): number {
  const safePrincipal = Number.isFinite(principal) && principal > 0 ? principal : 0;
  const percentage = safePrincipal * Math.min(rates.serviceFeeRate, MAX_SERVICE_FEE_PCT);
  return toCentavos(Math.min(percentage, SERVICE_FEE_CAP_PESOS));
}

/**
 * The full cost of a pawn, to the centavo, at the shop's configured rates.
 *
 * Computed in one place because the failure mode is not a wrong number, it is
 * two correct numbers that disagree. The quote, the loan record, the contract
 * and the renewal receipt must be the same expression evaluated on the same
 * rate.
 */
export function calculateLoanBreakdown(
  principal: number,
  rates: RateConfig = DEFAULT_RATES,
): LoanBreakdown {
  const safePrincipal = Number.isFinite(principal) && principal > 0 ? principal : 0;
  const interest = toCentavos(safePrincipal * rates.monthlyInterestRate);
  const serviceFee = serviceFeeFor(safePrincipal, rates);

  const uncapped = toCentavos(safePrincipal * rates.serviceFeeRate);
  return {
    principal: toCentavos(safePrincipal),
    interest,
    serviceFee,
    total: toCentavos(safePrincipal + interest + serviceFee),
    interestRate: rates.monthlyInterestRate,
    serviceFeeRate: rates.serviceFeeRate,
    serviceFeeUncapped: uncapped,
    serviceFeeCappedByStatute: serviceFee < uncapped,
  };
}

/**
 * Whether a loan would fall below the P.D. 114 Section 9 minimum.
 *
 * Section 9 permits a loan under 30% of appraised value only where "the pawner
 * manifests in writing the desire to borrow a lesser amount". The consent is
 * therefore an input, not an assumption: a branch that cannot record the
 * borrower's written request cannot lawfully make the loan.
 */
export function isBelowStatutoryMinimum(
  appraisedValue: number,
  loanAmount: number,
  writtenConsentObtained = false,
): boolean {
  if (!Number.isFinite(appraisedValue) || appraisedValue <= 0) return true;
  if (!Number.isFinite(loanAmount) || loanAmount <= 0) return true;
  if (writtenConsentObtained) return false;
  return loanAmount < appraisedValue * STATUTORY_MIN_LTV;
}

/** The least a loan may be without the borrower's written consent. */
export function statutoryMinimumLoan(appraisedValue: number): number {
  if (!Number.isFinite(appraisedValue) || appraisedValue <= 0) return 0;
  return toCentavos(appraisedValue * STATUTORY_MIN_LTV);
}

/** One month of interest on a principal. What a renewal collects. */
export function interestFor(principal: number, rates: RateConfig = DEFAULT_RATES): number {
  const safePrincipal = Number.isFinite(principal) && principal > 0 ? principal : 0;
  return toCentavos(safePrincipal * rates.monthlyInterestRate);
}

/** One month of late penalty on an outstanding principal. */
export function latePenaltyFor(
  principal: number,
  rates: RateConfig = DEFAULT_RATES,
): number {
  const safePrincipal = Number.isFinite(principal) && principal > 0 ? principal : 0;
  return toCentavos(safePrincipal * rates.latePenaltyRate);
}

/**
 * Whether a tendered amount settles a debt.
 *
 * Compared against a centavo rather than a float: a customer handing over
 * exactly the quoted total must not be a cent short because of binary rounding,
 * and a customer short by ₱0.01 must not be waved through.
 */
export function settlesAmount(tendered: number, owed: number): boolean {
  if (!Number.isFinite(tendered) || !Number.isFinite(owed)) return false;
  return Math.round(tendered * 100) >= Math.round(owed * 100);
}

/** Change due back to the customer, floored at zero. */
export function changeDue(tendered: number, owed: number): number {
  if (!Number.isFinite(tendered) || !Number.isFinite(owed)) return 0;
  return Math.max(0, toCentavos(tendered - owed));
}

/** The internal field names, exported so storage mapping lives in one place. */
export const RATE_FIELD_NAMES = {
  interest: 'monthlyInterestRate',
  serviceFee: 'serviceFeeRate',
  latePenalty: 'latePenaltyRate',
} as const;
