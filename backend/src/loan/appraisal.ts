/**
 * Appraisal rates, defined once and configurable per pawnshop.
 *
 * The risk and loan-amount figures were computed in the browser, in
 * `SalesPos.tsx`, from a table hardcoded in a component:
 *
 *     'Gold Jewelry':    { risk: (w) => w > 50  ? 12 : 22, rate: 3200 },
 *     'Silver Jewelry':  { risk: (w) => w > 100 ? 20 : 32, rate: 42   },
 *     'Diamond Jewelry': { risk: (w) => w > 10  ? 18 : 28, rate: 8000 },
 *     'Gold Coins':      { risk: (w) => w > 30  ? 10 : 18, rate: 3500 },
 *     const amount = weight * config.rate * 0.7;
 *
 * Three problems, in increasing order of how badly they would be received.
 *
 * 1. IT LIVED IN A COMPONENT. No backend check, no record, and no way for a
 *    branch to price to its own market. A figure a panel member can trace to a
 *    JSX file rather than to a policy is a figure they will ask about.
 *
 * 2. THE SILVER RATE IS OBSOLETE. PHP 42/gram is a pre-2020 figure. The LBMA
 *    benchmark for 2026 sits around PHP 110-125/gram spot, and Philippine
 *    pawnshops lend against sterling scrap at roughly PHP 70-90/gram. The
 *    effect is not cosmetic: a 10g silver bracelet appraised at PHP 42 lends
 *    PHP 294, and the same item at PHP 80 lends PHP 560. The branch was
 *    under-lending by nearly half on every silver item.
 *
 * 3. THE RISK SCORE IS INVERTED. It reads "heavier item, lower risk":
 *
 *        risk: (w) => w > 100 ? 20 : 32
 *
 *    A 5g bracelet scores 32% and a 2kg bar scores 20%. That is backwards on
 *    the credit dimension, and it is backwards on the operational one too -
 *    a larger mass is harder to store, harder to move, and more attractive to
 *    steal, so heavier should not be safer. This was the defect most likely to
 *    be caught by a panel member who has actually been inside a pawnshop.
 *
 * The rates below are per-shop configuration, resolved from the same
 * `pawnshops.settings` as the interest rate, with these as the platform defaults.
 * They are the melt-value basis, not the spot price: a pawnshop lends against
 * what it can liquidate, not against what the metal is trading for.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not model purity. An 18K chain at the same weight as a 24K one is
 * worth 25% less, and no per-gram rate can express that. Purity belongs in the
 * appraisal record and is a genuine gap - see `AppraisalBasis` below, which
 * records the rate used on the ticket so the figure is auditable after the fact
 * rather than recomputed from a constant that may since have changed.
 */

/** Platform default loan-to-value ratio applied to the appraised value. */
export const DEFAULT_LTV_RATIO = 0.7;

/**
 * Loan-to-value by collateral class.
 *
 * 70% is the established commercial standard for gold across the major
 * Philippine operators. Non-gold collateral lends lower because it is harder to
 * liquidate at auction: silver trades thinly, and an uncertified diamond has no
 * reliable market at all. A single 70% across every category overstates what a
 * branch can safely lend on a diamond and understates its caution on one.
 */
export const LTV_RATIOS = {
  GOLD_JEWELRY: 0.7,
  GOLD_COINS: 0.7,
  SILVER_JEWELRY: 0.55,
  DIAMOND_JEWELRY: 0.45,
} as const;

export type CollateralClass = keyof typeof LTV_RATIOS;

/** A collateral class, and the per-gram rate field that backs it. */
const RATE_FIELD: Record<CollateralClass, keyof AppraisalRates> = {
  GOLD_JEWELRY: 'goldJewelry',
  GOLD_COINS: 'goldCoins',
  SILVER_JEWELRY: 'silverJewelry',
  DIAMOND_JEWELRY: 'diamondJewelry',
};

/** Metal value per gram, in pesos, on a pawn/melt basis. */
export interface AppraisalRates {
  goldJewelry: number;
  silverJewelry: number;
  diamondJewelry: number;
  goldCoins: number;
}

/**
 * Platform defaults.
 *
 * Gold: 24K spot sits around PHP 8,350-8,600/gram. 18K is 75% purity, so melt
 * is roughly PHP 6,260/gram, and local pawnshops buy 18K scrap in the
 * PHP 3,800-4,500 range. PHP 4,200 is mid-range for uncertified 18K, which is
 * the common case.
 *
 * Silver: LBMA spot around PHP 110-125/gram for .999 fine; .925 sterling melt is
 * near PHP 113. Philippine pawn loans run PHP 70-90/gram. PHP 80 is the
 * midpoint.
 *
 * Diamonds: appraised per carat, not per gram, on the 4Cs, and value scales
 * with carat weight rather than linearly with mass. An uncertified melee
 * heuristic of PHP 8,000/gram (PHP 1,600/gram, so PHP 1,600 per carat) is a
 * placeholder for a jeweller's certificate, not a valuation. The lower LTV
 * ratio is what carries the risk that the heuristic is wrong.
 *
 * Gold coins: near-24K plus a minting premium, typically appraised at
 * PHP 5,500-6,500/gram. PHP 6,000 is mid-range for circulated coins.
 */
export const DEFAULT_APPRAISAL_RATES: Readonly<AppraisalRates> = Object.freeze({
  goldJewelry: 4200,
  silverJewelry: 80,
  diamondJewelry: 8000,
  goldCoins: 6000,
});

/** Upper bound on any configured per-gram rate. Guards against a stray zero. */
export const MAX_GRAM_RATE = 100_000;

const RATE_SETTING_KEYS = {
  goldJewelry: 'goldJewelryRate',
  silverJewelry: 'silverJewelryRate',
  diamondJewelry: 'diamondJewelryRate',
  goldCoins: 'goldCoinRate',
} as const;

function isUsableRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_GRAM_RATE
  );
}

/** Read a shop's configured appraisal rates, falling back per field. */
export function resolveAppraisalRates(settings: unknown): AppraisalRates {
  if (!settings || typeof settings !== 'object') {
    return { ...DEFAULT_APPRAISAL_RATES };
  }
  const record = settings as Record<string, unknown>;
  const pick = (key: string, fallback: number): number =>
    isUsableRate(record[key]) ? record[key] : fallback;

  return {
    goldJewelry: pick(RATE_SETTING_KEYS.goldJewelry, DEFAULT_APPRAISAL_RATES.goldJewelry),
    silverJewelry: pick(RATE_SETTING_KEYS.silverJewelry, DEFAULT_APPRAISAL_RATES.silverJewelry),
    diamondJewelry: pick(RATE_SETTING_KEYS.diamondJewelry, DEFAULT_APPRAISAL_RATES.diamondJewelry),
    goldCoins: pick(RATE_SETTING_KEYS.goldCoins, DEFAULT_APPRAISAL_RATES.goldCoins),
  };
}

/** The collateral class a category falls into. */
export function collateralClassFor(category: string): CollateralClass {
  const normalized = (category ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'GOLD_JEWELRY':
    case 'GOLD':
      return 'GOLD_JEWELRY';
    case 'GOLD_COINS':
    case 'COINS':
      return 'GOLD_COINS';
    case 'SILVER_JEWELRY':
    case 'SILVER':
      return 'SILVER_JEWELRY';
    case 'DIAMOND_JEWELRY':
    case 'DIAMOND':
    case 'DIAMONDS':
      return 'DIAMOND_JEWELRY';
    default:
      // Unknown categories get the most conservative class available rather
      // than the most profitable. A typo in a category name should cost the
      // branch money, not hand it a gold rate for something that isn't gold.
      return 'DIAMOND_JEWELRY';
  }
}

/** Per-gram rate for a category, at the shop's configured rates. */
export function gramRateFor(
  category: string,
  rates: AppraisalRates = DEFAULT_APPRAISAL_RATES,
): number {
  return rates[RATE_FIELD[collateralClassFor(category)]];
}

/** LTV ratio for a category, falling back to the published default. */
export function ltvRatioFor(
  category: string,
  ltv: Partial<Record<CollateralClass, number>> = LTV_RATIOS,
): number {
  return ltv[collateralClassFor(category)] ?? DEFAULT_LTV_RATIO;
}

export interface Appraisal {
  category: string;
  weight: number;
  /** Per-gram rate applied, and the class it came from. */
  gramRate: number;
  collateralClass: CollateralClass;
  ltvRatio: number;
  /** weight * gramRate. The item's value on a pawn basis. */
  appraisedValue: number;
  /** appraisedValue * ltvRatio. What the system proposes lending. */
  recommendedLoanAmount: number;
  /** Rounded to the centavo. */
  serviceFeeAtLoan: number;
}

/**
 * Appraise an item.
 *
 * `serviceFeeAtLoan` is included because the P.D. 114 Section 10 cap bites at
 * the loan figure, and an appraiser quoting a recommended loan should be able to
 * see the whole cost they are proposing rather than discovering the fee later.
 */
export function appraise(
  category: string,
  weight: number,
  rates: AppraisalRates = DEFAULT_APPRAISAL_RATES,
  ltv: Partial<Record<CollateralClass, number>> = LTV_RATIOS,
): Appraisal {
  const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 0;
  const collateralClass = collateralClassFor(category);
  const gramRate = rates[RATE_FIELD[collateralClass]];
  const ltvRatio = ltv[collateralClass] ?? DEFAULT_LTV_RATIO;

  const appraisedValue = toCentavos(safeWeight * gramRate);
  const recommendedLoanAmount = toCentavos(appraisedValue * ltvRatio);

  return {
    category,
    weight: safeWeight,
    gramRate,
    collateralClass,
    ltvRatio,
    appraisedValue,
    recommendedLoanAmount,
    serviceFeeAtLoan: toCentavos(Math.min(recommendedLoanAmount * 0.01, 5)),
  };
}

function toCentavos(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Risk scoring, on the three factors a pawnshop actually weighs.
 *
 * The previous model scored weight alone, and inverted: a 2kg item scored
 * *lower* risk than a 5g one. On the credit dimension that is simply wrong -
 * a heavier item is better collateral, because it covers more of the loan and
 * liquidates more predictably. On the operational dimension it is also wrong -
 * mass is a handling, storage and theft-attractiveness risk.
 *
 * The real drivers, in the order a counter would apply them:
 *
 *   1. AUTHENTICITY. A counterfeit, a plated piece or a tungsten-filled bar
 *      means the collateral is worth nothing, and it is the only factor that can
 *      take the loss from unrecoverable to total. Weighted heaviest.
 *   2. IDENTITY. No verified ID, or a KYC state short of verified, means the
 *      branch cannot establish who pledged the item or discharge its AML
 *      obligations. Weighted second.
 *   3. HANDLING. Mass and value together, as a vault and logistics exposure.
 *      Weighted lightest, and it only ever adds.
 *
 * Every factor adds to a base. Nothing subtracts, because the old behaviour -
 * a large deposit quietly *improving* the score - is the thing being removed.
 *
 * ONE CAVEAT ON THE TOTAL. The score is a triage aid, not the decision. A sum
 * cannot rank a suspected counterfeit above missing paperwork, because the
 * paperwork factors are three and the authenticity factor is one; on a flawless
 * application a counterfeit suspicion sums to less than a missing ID does. The
 * band therefore takes the worst condition present rather than the arithmetic -
 * see `assessRisk`. If you are reading this to change a weight, remember the
 * weights are comparable to each other but not absolute.
 */
export const RISK_FACTORS = {
  /**
   * The score a fully-cleared, light, low-value item starts from.
   *
   * The model is additive only: every factor either adds or contributes nothing,
   * and nothing is ever subtracted. Scoring "authenticity unverified" as a +30
   * penalty *and* "authenticity verified" as a -30 credit is the same mistake
   * twice - it silently doubles every factor's weight, so the published numbers
   * stop being the numbers the system uses.
   *
   * Base 10 keeps a fully-cleared item inside the LOW band (< 20) while leaving
   * room for the handling and value factors to move it without immediately
   * clamping at 0, which is what erased the weight signal before.
   */
  base: 10,
  authenticityUnverified: 30,
  authenticitySuspect: 45,
  idUnverified: 25,
  kycNotVerified: 20,
  heavyItem: 15,
  veryHeavyItem: 25,
  highValue: 12,
} as const;

/**
 * Normalise a purity figure to a multiplier.
 *
 * Accepts a percentage (75 for 18K, 100 for 24K) or a fineness mark written the
 * way a pawner would say it aloud (925 for sterling, 916 for 22K, 585 for
 * 14K). A field bounded at 1000 exists precisely because 925 is the natural way
 * to enter sterling, and 925 as a percentage would value the metal ten times
 * over - a ₱80,000 loan on a ₱8,000 bracelet.
 *
 * Returns null when no purity was given, so a non-metal item is unscaled.
 */
export function normalizePurity(
  purityPercent: number | null | undefined,
): number | null {
  if (
    typeof purityPercent !== 'number' ||
    !Number.isFinite(purityPercent) ||
    purityPercent <= 0
  ) {
    return null;
  }
  // A fineness mark over 1000 is impossible; anything over 100 and at or below
  // 1000 is read as a fineness mark and divided down to a percentage.
  // A fineness mark runs 585-999 (14K through pure). A purity percentage runs
  // 1-100. Nothing legitimate sits between 100 and 585, so that band is
  // rejected rather than guessed at - 105 could be a typo for 95, and scaling
  // by 1.05 is worse than declining to answer.
  if (purityPercent > 100) {
    if (purityPercent < 500) return null;
    const asPercent = purityPercent / 10;
    return asPercent > 100 ? null : asPercent / 100;
  }
  return purityPercent / 100;
}

/** Grams above which an item counts as heavy for handling purposes. */
export const HEAVY_ITEM_GRAMS = 250;
export const VERY_HEAVY_ITEM_GRAMS = 1000;

/** Appraised value above which an item carries elevated loss exposure. */
export const HIGH_VALUE_THRESHOLD = 100_000;

export interface RiskInput {
  /** Did the appraiser inspect and confirm the item is genuine? */
  authenticityVerified?: boolean;
  /** Explicit suspicion, e.g. a failed density or hallmark check. */
  authenticitySuspect?: boolean;
  /** Is the pawner's government ID verified? */
  idVerified?: boolean;
  /** KYC status, case-insensitive. Anything short of VERIFIED counts. */
  kycStatus?: string | null;
  weight?: number | null;
  appraisedValue?: number | null;
}

export interface RiskAssessment {
  score: number;
  band: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  factors: string[];
  /** True when the score alone should stop the pawn. */
  blocking: boolean;
}

/**
 * Band cut-offs.
 *
 * LOW is the ordinary case for a properly documented pawn. MODERATE is worth a
 * second look but not a second signature. HIGH requires manager review before
 * the item goes into the vault. CRITICAL is where the branch should decline
 * unless someone senior accepts the exposure in writing.
 */
export const MODERATE_RISK_THRESHOLD = 20;
export const HIGH_RISK_THRESHOLD = 40;
export const CRITICAL_RISK_THRESHOLD = 70;

export function assessRisk(input: RiskInput): RiskAssessment {
  const factors: string[] = [];
  let score = RISK_FACTORS.base;

  if (input.authenticitySuspect) {
    score += RISK_FACTORS.authenticitySuspect;
    factors.push('authenticity suspected');
  } else if (input.authenticityVerified !== true) {
    // Absence of confirmation is the risk. A confirmed-genuine item adds nothing
    // here rather than a negative, so the factor's published weight is the
    // whole distance between cleared and not - scoring both directions would
    // double every factor and quietly desync the table from the arithmetic.
    score += RISK_FACTORS.authenticityUnverified;
    factors.push('authenticity unverified');
  } else {
    factors.push('authenticity verified');
  }

  if (input.idVerified !== true) {
    score += RISK_FACTORS.idUnverified;
    factors.push('ID not verified');
  } else {
    factors.push('ID verified');
  }

  const kyc = (input.kycStatus ?? '').trim().toUpperCase();
  if (kyc !== 'VERIFIED') {
    score += RISK_FACTORS.kycNotVerified;
    factors.push('KYC not verified');
  } else {
    factors.push('KYC verified');
  }

  const weight = Number.isFinite(input.weight) ? Number(input.weight) : 0;
  if (weight > VERY_HEAVY_ITEM_GRAMS) {
    score += RISK_FACTORS.veryHeavyItem;
    factors.push(`heavy handling (${weight}g)`);
  } else if (weight > HEAVY_ITEM_GRAMS) {
    score += RISK_FACTORS.heavyItem;
    factors.push(`elevated handling (${weight}g)`);
  }

  const value = Number.isFinite(input.appraisedValue) ? Number(input.appraisedValue) : 0;
  if (value > HIGH_VALUE_THRESHOLD) {
    score += RISK_FACTORS.highValue;
    factors.push('high value exposure');
  }

  // A non-finite score would propagate into the band comparison and produce
  // undefined behaviour downstream - `NaN < 70` is false, so a suspect item
  // would fall through to LOW and the blocking check would be the only thing
  // standing between it and the vault. Anything uncomputable scores as maximal.
  const bounded = Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 100;

  // A suspected counterfeit is CRITICAL on its own account, regardless of the
  // total. A sum cannot express this: on an otherwise flawless application the
  // +45 alone lands near 55, which is *below* what merely missing paperwork
  // produces, so a probable counterfeit would be presented as less serious than
  // an unsigned form. The band reports the worst condition present, not the
  // arithmetic - which is also the only ordering that matches how a counter
  // actually triages.
  const blocking = input.authenticitySuspect === true;

  const band: RiskAssessment['band'] = blocking
    ? 'CRITICAL'
    : bounded >= CRITICAL_RISK_THRESHOLD
      ? 'CRITICAL'
      : bounded >= HIGH_RISK_THRESHOLD
        ? 'HIGH'
        : bounded >= MODERATE_RISK_THRESHOLD
          ? 'MODERATE'
          : 'LOW';

  return {
    score: bounded,
    band,
    factors,
    blocking,
  };
}
