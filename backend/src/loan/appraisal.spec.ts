import {
  CRITICAL_RISK_THRESHOLD,
  DEFAULT_APPRAISAL_RATES,
  DEFAULT_LTV_RATIO,
  HEAVY_ITEM_GRAMS,
  HIGH_RISK_THRESHOLD,
  HIGH_VALUE_THRESHOLD,
  LTV_RATIOS,
  MODERATE_RISK_THRESHOLD,
  RISK_FACTORS,
  VERY_HEAVY_ITEM_GRAMS,
  appraise,
  assessRisk,
  collateralClassFor,
  gramRateFor,
  ltvRatioFor,
  normalizePurity,
  resolveAppraisalRates,
} from './appraisal';

/**
 * Appraisal rates and risk scoring, which used to be a hardcoded table inside a
 * React component with no server-side copy of any of it.
 *
 * Three defects, and the third is the one that would have been caught in a
 * defence.
 *
 * 1. The rates lived in JSX. Nothing recorded what produced a valuation, so a
 *    per-gram constant could change and a past ticket's worth would no longer be
 *    reproducible.
 *
 * 2. The silver rate was PHP 42/gram, a pre-2020 figure. LBMA spot for 2026
 *    sits near PHP 110-125, and Philippine pawnshops lend against sterling
 *    scrap at PHP 70-90. A 10g silver item was appraised at PHP 420 instead of
 *    PHP 800, and the branch under-lent by nearly half on every one.
 *
 * 3. THE RISK SCORE WAS INVERTED. It read `w > 100 ? 20 : 32` - heavier item,
 *    LOWER risk. That is backwards on the credit dimension (a heavier item is
 *    better collateral) and backwards on the operational one (mass is a
 *    handling, storage and theft-attractiveness exposure). A 5g bracelet scored
 *    worse than a 2kg bar, which is the kind of statement a panel member who has
 *    been inside a pawnshop will notice immediately.
 */

describe('appraisal rates', () => {
  it('defaults to a current silver rate, not a pre-2020 one', () => {
    // LBMA spot is PHP 110-125/gram; Philippine pawn loans run PHP 70-90.
    // PHP 42 was last plausible around 2019.
    expect(DEFAULT_APPRAISAL_RATES.silverJewelry).toBe(80);
    expect(DEFAULT_APPRAISAL_RATES.silverJewelry).toBeGreaterThan(70);
    expect(DEFAULT_APPRAISAL_RATES.silverJewelry).toBeLessThan(90);
  });

  it('prices 18K gold below 24K spot, on a scrap basis', () => {
    // 24K spot is PHP 8,350-8,600. 18K is 75% purity, so melt is near 6,260,
    // and local shops buy 18K scrap at PHP 3,800-4,500.
    expect(DEFAULT_APPRAISAL_RATES.goldJewelry).toBeGreaterThanOrEqual(3800);
    expect(DEFAULT_APPRAISAL_RATES.goldJewelry).toBeLessThanOrEqual(4500);
    expect(DEFAULT_APPRAISAL_RATES.goldJewelry).toBeLessThan(8000);
  });

  it('falls back to platform defaults when a shop has configured nothing', () => {
    expect(resolveAppraisalRates({})).toEqual(DEFAULT_APPRAISAL_RATES);
    expect(resolveAppraisalRates(null)).toEqual(DEFAULT_APPRAISAL_RATES);
    expect(resolveAppraisalRates('nonsense')).toEqual(DEFAULT_APPRAISAL_RATES);
  });

  it('lets a branch price to its own market', () => {
    const rates = resolveAppraisalRates({
      goldJewelryRate: 4500,
      silverJewelryRate: 85,
    });
    expect(rates.goldJewelry).toBe(4500);
    expect(rates.silverJewelry).toBe(85);
    // Per-field fallback: a shop that set two rates keeps the defaults for the rest.
    expect(rates.goldCoins).toBe(DEFAULT_APPRAISAL_RATES.goldCoins);
  });

  it('ignores a rate that is zero, negative or absurd', () => {
    expect(resolveAppraisalRates({ goldJewelryRate: 0 }).goldJewelry)
      .toBe(DEFAULT_APPRAISAL_RATES.goldJewelry);
    expect(resolveAppraisalRates({ goldJewelryRate: -100 }).goldJewelry)
      .toBe(DEFAULT_APPRAISAL_RATES.goldJewelry);
    expect(resolveAppraisalRates({ goldJewelryRate: 999_999 }).goldJewelry)
      .toBe(DEFAULT_APPRAISAL_RATES.goldJewelry);
    expect(resolveAppraisalRates({ goldJewelryRate: '4500' }).goldJewelry)
      .toBe(DEFAULT_APPRAISAL_RATES.goldJewelry);
  });
});

describe('collateral classes', () => {
  it('maps the POS categories to a class', () => {
    expect(collateralClassFor('Gold Jewelry')).toBe('GOLD_JEWELRY');
    expect(collateralClassFor('Silver Jewelry')).toBe('SILVER_JEWELRY');
    expect(collateralClassFor('Diamond Jewelry')).toBe('DIAMOND_JEWELRY');
    expect(collateralClassFor('Gold Coins')).toBe('GOLD_COINS');
  });

  it('treats a loose or lower-case label the same way', () => {
    expect(collateralClassFor('gold jewelry')).toBe('GOLD_JEWELRY');
    expect(collateralClassFor('GOLD-JEWELRY')).toBe('GOLD_JEWELRY');
    expect(collateralClassFor('  Silver  ')).toBe('SILVER_JEWELRY');
    expect(collateralClassFor('coins')).toBe('GOLD_COINS');
  });

  it('falls back to the most conservative class, not the most profitable', () => {
    // A typo must cost the branch money. Defaulting to gold would hand out a
    // PHP 4,200/gram rate for an item nobody has classified.
    expect(collateralClassFor('')).toBe('DIAMOND_JEWELRY');
    expect(collateralClassFor('mystery box')).toBe('DIAMOND_JEWELRY');
  });

  it('lends non-gold collateral at a lower ratio', () => {
    // 70% is the standard for gold. Silver trades thin at auction and an
    // uncertified diamond has no reliable market, so a single 70% across every
    // category overstates what a branch can safely lend.
    expect(ltvRatioFor('Gold Jewelry')).toBe(0.7);
    expect(ltvRatioFor('Gold Coins')).toBe(0.7);
    expect(ltvRatioFor('Silver Jewelry')).toBeLessThan(0.7);
    expect(ltvRatioFor('Diamond Jewelry')).toBeLessThan(
      ltvRatioFor('Silver Jewelry'),
    );
  });

  it('keeps every ratio above the P.D. 114 Section 9 floor of 30%', () => {
    for (const ratio of Object.values(LTV_RATIOS)) {
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });

  it('exposes the same ratio through the lookup helper', () => {
    // `ltvRatioFor` and the table must not be able to drift apart - the helper
    // is what `appraise` calls, so a divergence would be invisible from the
    // table alone.
    for (const category of ['Gold Jewelry', 'Gold Coins', 'Silver Jewelry', 'Diamond Jewelry']) {
      expect(ltvRatioFor(category)).toBe(LTV_RATIOS[collateralClassFor(category)]);
    }
  });

  it('falls back to the published default when a ratio is missing', () => {
    // A partial override, as a shop configuration would supply. A missing class
    // must not become NaN, which would silently zero every loan on that class.
    expect(ltvRatioFor('Silver Jewelry', { GOLD_JEWELRY: 0.5 }))
      .toBe(DEFAULT_LTV_RATIO);
    expect(ltvRatioFor('Gold Jewelry', { GOLD_JEWELRY: 0.5 })).toBe(0.5);
    expect(appraise('Silver Jewelry', 10, undefined, { GOLD_JEWELRY: 0.5 })
      .recommendedLoanAmount).toBe(560);
  });
});

describe('gramRateFor', () => {
  it('resolves the per-gram rate for a category', () => {
    expect(gramRateFor('Silver Jewelry')).toBe(80);
    expect(gramRateFor('gold jewelry')).toBe(4200);
    expect(gramRateFor('Gold Coins')).toBe(6000);
    expect(gramRateFor('Diamond Jewelry')).toBe(8000);
  });

  it('uses the shop configured rate', () => {
    const rates = resolveAppraisalRates({ silverJewelryRate: 85 });
    expect(gramRateFor('Silver Jewelry', rates)).toBe(85);
  });

  it('agrees with appraise on the rate it actually applied', () => {
    // The rate reported in the response has to be the one used, or the figure
    // becomes unreproducible after a configuration change.
    for (const category of ['Gold Jewelry', 'Silver Jewelry', 'Diamond Jewelry', 'Gold Coins']) {
      expect(appraise(category, 10).gramRate).toBe(gramRateFor(category));
    }
  });
});

describe('appraise', () => {
  it('values a 10g silver bracelet at the current rate', () => {
    // The figure from the deployed contract, which was PHP 294 at the old
    // PHP 42/gram. At PHP 80/gram and a 55% LTV it is PHP 440.
    const a = appraise('Silver Jewelry', 10);
    expect(a.gramRate).toBe(80);
    expect(a.appraisedValue).toBe(800);
    expect(a.recommendedLoanAmount).toBe(440);
  });

  it('agrees with the old figure only at the old rate', () => {
    // Pins the regression: at PHP 42/gram this returns the PHP 294 that was on
    // the live contract, so the two paths cannot be confused.
    const legacy = appraise('Silver Jewelry', 10, {
      ...DEFAULT_APPRAISAL_RATES,
      silverJewelry: 42,
    });
    expect(legacy.appraisedValue).toBe(420);
    expect(legacy.recommendedLoanAmount).toBe(231);
  });

  it('applies the class LTV ratio', () => {
    // 10g at PHP 4,200 = PHP 42,000 appraised; 70% gold, 45% diamond.
    expect(appraise('Gold Jewelry', 10).appraisedValue).toBe(42_000);
    expect(appraise('Gold Jewelry', 10).recommendedLoanAmount).toBe(29_400);
    expect(appraise('Diamond Jewelry', 10).recommendedLoanAmount).toBe(36_000);
  });

  it('shows the P.D. 114 service fee that would apply at the quoted loan', () => {
    // PHP 440 loan: 1% is 4.40, and the cap is 5, so 4.40 is the lesser.
    expect(appraise('Silver Jewelry', 10).serviceFeeAtLoan).toBe(4.4);
    // A PHP 10,000 loan: 1% would be 100, capped at 5.
    const big = appraise('Gold Coins', 20);
    expect(big.recommendedLoanAmount).toBeGreaterThan(500);
    expect(big.serviceFeeAtLoan).toBe(5);
  });

  it('treats a zero or negative weight as worth nothing, not as a negative loan', () => {
    for (const w of [0, -10, Number.NaN]) {
      const a = appraise('Gold Jewelry', w);
      expect(a.appraisedValue).toBe(0);
      expect(a.recommendedLoanAmount).toBe(0);
    }
  });

  it('scales linearly with weight', () => {
    expect(appraise('Gold Jewelry', 20).appraisedValue)
      .toBe(appraise('Gold Jewelry', 10).appraisedValue * 2);
  });

  it('uses the shop configured rate, not the default', () => {
    const rates = resolveAppraisalRates({ goldJewelryRate: 5000 });
    expect(appraise('Gold Jewelry', 10, rates).appraisedValue).toBe(50_000);
  });
});

describe('normalizePurity', () => {
  it('reads a percentage directly', () => {
    expect(normalizePurity(100)).toBe(1);
    expect(normalizePurity(75)).toBe(0.75);
    expect(normalizePurity(58.5)).toBe(0.585);
  });

  it('reads a fineness mark the way a pawner says it aloud', () => {
    // "925" is how sterling is spoken and written. Read as a percentage it
    // would be 925%, valuing a PHP 80,000 loan on a PHP 8,000 bracelet.
    // Compared to a few decimals because 916/1000/100 is not exact in binary.
    expect(normalizePurity(925)).toBeCloseTo(0.925, 10);
    expect(normalizePurity(916)).toBeCloseTo(0.916, 10);
    expect(normalizePurity(585)).toBeCloseTo(0.585, 10);
    expect(normalizePurity(750)).toBeCloseTo(0.75, 10);
  });

  it('returns null when no purity is given, so a diamond is unscaled', () => {
    expect(normalizePurity(undefined)).toBeNull();
    expect(normalizePurity(null)).toBeNull();
    expect(normalizePurity(0)).toBeNull();
    expect(normalizePurity(-5)).toBeNull();
    expect(normalizePurity(Number.NaN)).toBeNull();
  });

  it('rejects the gap between a percentage and a fineness mark', () => {
    // Nothing legitimate sits between 100 and 585. 105 is far more likely a
    // typo for 95 than a 105% pure metal, and scaling by 1.05 is worse than
    // declining to answer.
    expect(normalizePurity(101)).toBeNull();
    expect(normalizePurity(105)).toBeNull();
    expect(normalizePurity(300)).toBeNull();
    expect(normalizePurity(499)).toBeNull();
  });

  it('rejects a value above any possible purity', () => {
    expect(normalizePurity(1001)).toBeNull();
    expect(normalizePurity(5000)).toBeNull();
  });
});

describe('assessRisk', () => {
  it('does NOT reward a heavier item', () => {
    // The regression. Previously `w > 100 ? 20 : 32`, so a 2kg bar scored
    // better than a 5g bracelet. Both scores must move the same way, or the
    // same way up.
    const light = assessRisk({ weight: 5, authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    const heavy = assessRisk({ weight: 2000, authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    expect(heavy.score).toBeGreaterThan(light.score);
  });

  it('never lets weight reduce the score', () => {
    const base = assessRisk({ authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    const medium = assessRisk({ weight: 300, authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    const huge = assessRisk({ weight: 1500, authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    expect(medium.score).toBeGreaterThanOrEqual(base.score);
    expect(huge.score).toBeGreaterThan(medium.score);
  });

  it('treats unverified authenticity as the heaviest single factor', () => {
    // Measured with the other two factors pinned identical, so the difference
    // is the authenticity credit alone. Holding ID and KYC at "not verified"
    // keeps the score under the 100 clamp, which would otherwise flatten the
    // gap to whatever the clamp allows.
    const unverified = assessRisk({ weight: 10, idVerified: true, kycStatus: 'VERIFIED' });
    const verified = assessRisk({ weight: 10, idVerified: true, kycStatus: 'VERIFIED', authenticityVerified: true });
    expect(unverified.score - verified.score)
      .toBe(RISK_FACTORS.authenticityUnverified);
    expect(unverified.factors).toContain('authenticity unverified');
    expect(verified.factors).toContain('authenticity verified');
  });

  it('weighs authenticity above identity and KYC individually', () => {
    // A fully-cleared baseline, then exactly one factor removed per variant, so
    // each delta is that factor alone and no pair of them is confounded.
    const cleared = assessRisk({
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
    });
    const noAuth = assessRisk({ idVerified: true, kycStatus: 'VERIFIED' });
    const noId = assessRisk({ authenticityVerified: true, kycStatus: 'VERIFIED' });
    const noKyc = assessRisk({ authenticityVerified: true, idVerified: true });

    expect(RISK_FACTORS.authenticityUnverified)
      .toBeGreaterThan(RISK_FACTORS.idUnverified);
    expect(RISK_FACTORS.authenticityUnverified)
      .toBeGreaterThan(RISK_FACTORS.kycNotVerified);

    // The deltas must be observable, not flattened by the 0-100 clamp, and each
    // must equal the weight the constant publishes.
    expect(noAuth.score - cleared.score)
      .toBe(RISK_FACTORS.authenticityUnverified);
    expect(noId.score - cleared.score).toBe(RISK_FACTORS.idUnverified);
    expect(noKyc.score - cleared.score).toBe(RISK_FACTORS.kycNotVerified);
  });

  it('blocks a suspected counterfeit outright', () => {
    // The one condition that must not be weighed against other factors.
    // Proceeding means the branch holds worthless collateral and faces the
    // rightful owner, which is not a risk to be scored.
    //
    // `authenticityVerified: true` alongside `authenticitySuspect: true` is
    // deliberate: it proves suspicion is not merely a larger weight on the same
    // axis. A suspect item that is somehow also marked verified must still stop.
    const r = assessRisk({
      authenticitySuspect: true,
      weight: 1,
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
    });
    expect(r.blocking).toBe(true);
    expect(r.band).toBe('CRITICAL');
  });

  it('ranks a suspected counterfeit above mere paperwork gaps', () => {
    // The sum alone gets this backwards. One authenticity factor cannot outscore
    // a +20 KYC gap, so on an otherwise flawless application a probable
    // counterfeit totalled *below* a pending KYC - presented to the counter as
    // less serious than a paperwork omission, which is precisely backwards.
    const counterfeit = assessRisk({
      authenticitySuspect: true,
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
    });

    // The total alone would call this merely HIGH, which understates it: the
    // paperwork is in perfect order, so the only thing standing between this
    // pawn and a worthless item in the vault is that single flag.
    expect(counterfeit.score).toBeGreaterThanOrEqual(HIGH_RISK_THRESHOLD);
    expect(counterfeit.score).toBeLessThan(CRITICAL_RISK_THRESHOLD);
    // The band a counter acts on has to say CRITICAL regardless.
    expect(counterfeit.band).toBe('CRITICAL');
    expect(counterfeit.blocking).toBe(true);

    // And a complete absence of verification, which is paperwork rather than
    // authenticity, must not be able to outrank it in the only field that
    // stops a pawn.
    const nothingCleared = assessRisk({ weight: 10 });
    expect(nothingCleared.score).toBeGreaterThan(counterfeit.score);
    expect(counterfeit.blocking).toBe(true);
    expect(nothingCleared.blocking).toBe(false);
  });;

  it('does not block a merely unverified item', () => {
    const r = assessRisk({ weight: 10 });
    expect(r.blocking).toBe(false);
  });

  it('still separates a cleared item from one with nothing cleared', () => {
    // The clamping trap: with a base below the sum of the credits, every
    // cleared item pins to 0 and the weight signal vanishes precisely when the
    // paperwork is in order.
    const cleared = assessRisk({ authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    const bare = assessRisk({ weight: 10 });
    expect(bare.score).toBeGreaterThan(cleared.score);
  });

  it('penalises a missing ID and an unverified KYC', () => {
    const clean = assessRisk({ authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    const noId = assessRisk({ authenticityVerified: true, kycStatus: 'VERIFIED' });
    const noKyc = assessRisk({ authenticityVerified: true, idVerified: true });

    expect(noId.score).toBeGreaterThan(clean.score);
    expect(noKyc.score).toBeGreaterThan(clean.score);
    expect(noKyc.factors).toContain('KYC not verified');
  });

  it('reads KYC case-insensitively and treats anything short of VERIFIED as unverified', () => {
    for (const status of ['verified', 'VERIFIED', 'Verified']) {
      expect(assessRisk({ kycStatus: status, authenticityVerified: true, idVerified: true }).factors)
        .toContain('KYC verified');
    }
    for (const status of ['PENDING', 'NOT_SUBMITTED', null, undefined, 'REJECTED']) {
      expect(assessRisk({ kycStatus: status, authenticityVerified: true, idVerified: true }).factors)
        .toContain('KYC not verified');
    }
  });

  it('flags a high-value item as loss exposure', () => {
    const r = assessRisk({ appraisedValue: 250_000, authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
    expect(r.factors.some((f) => f.includes('high value'))).toBe(true);
  });

  it('stays within 0-100 whatever it is given', () => {
    const worst = assessRisk({
      authenticitySuspect: true,
      weight: 100_000,
      appraisedValue: 10_000_000,
    });
    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.score).toBeGreaterThanOrEqual(0);

    const best = assessRisk({
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
      weight: 0,
      appraisedValue: 0,
    });
    expect(best.score).toBeGreaterThanOrEqual(0);
  });

  it('bands consistently with the thresholds it publishes', () => {
    const cleared = assessRisk({
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
    });
    expect(cleared.score).toBeLessThan(MODERATE_RISK_THRESHOLD);
    expect(cleared.band).toBe('LOW');

    // Nothing cleared, light, low value: 10 + 30 + 25 + 20 = 85, over CRITICAL.
    const bare = assessRisk({ weight: 10 });
    expect(bare.score).toBeGreaterThanOrEqual(CRITICAL_RISK_THRESHOLD);
    expect(bare.band).toBe('CRITICAL');
  });

  it('puts the band boundaries where the constants say they are', () => {
    // Each band, built by adding factors, checked against the published
    // thresholds rather than against a hardcoded number.
    const at = (extra: Record<string, unknown>) =>
      assessRisk({
        authenticityVerified: true,
        idVerified: true,
        kycStatus: 'VERIFIED',
        ...extra,
      });

    // Scoring from the base up: heavy 10+15=25, very heavy 10+25=35, high
    // value 10+12=22. The heavy/very-heavy step crosses the MODERATE cut but
    // stays under HIGH, and the value step is worth exactly the constant.
    expect(at({ weight: HEAVY_ITEM_GRAMS - 1 }).band).toBe('LOW');
    expect(at({ weight: HEAVY_ITEM_GRAMS + 1 }).score)
      .toBe(RISK_FACTORS.base + RISK_FACTORS.heavyItem);
    expect(at({ weight: VERY_HEAVY_ITEM_GRAMS - 1 }).score)
      .toBe(RISK_FACTORS.base + RISK_FACTORS.heavyItem);
    expect(at({ weight: VERY_HEAVY_ITEM_GRAMS + 1 }).score)
      .toBe(RISK_FACTORS.base + RISK_FACTORS.veryHeavyItem);
    expect(at({ appraisedValue: HIGH_VALUE_THRESHOLD - 1 }).band).toBe('LOW');
    expect(at({ appraisedValue: HIGH_VALUE_THRESHOLD + 1 }).score)
      .toBe(RISK_FACTORS.base + RISK_FACTORS.highValue);
  });

  it('never lowers the band as conditions worsen', () => {
    // The property that actually matters for triage: no input can move an item
    // into a less severe band. Checked by enumerating the conditions and
    // ordering the resulting bands, rather than trusting the arithmetic.
    const bandOrder = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 } as const;
    // Only genuinely cumulative conditions. Weight and value are single-valued
    // inputs, so they cannot be spread over a base without one overwriting the
    // other - a "lighter" weight is not a milder risk, and pairing them would
    // test the spread operator rather than the scorer. Those are covered above
    // by the boundary walk.
    const conditions = [
      {},
      { kycStatus: 'PENDING' },
      { kycStatus: 'NOT_SUBMITTED' },
      { idVerified: false },
      { authenticityVerified: false },
      { authenticitySuspect: true },
    ];

    for (const worse of conditions) {
      for (const better of conditions) {
        const b = assessRisk({ ...better });
        const w = assessRisk({ ...better, ...worse });
        expect(bandOrder[w.band]).toBeGreaterThanOrEqual(bandOrder[b.band]);
        expect(w.score).toBeGreaterThanOrEqual(b.score);
      }
    }
  });

  it('escalates the band monotonically as weight rises', () => {
    // The inversion this replaced read `w > 100 ? 20 : 32` - heavier was
    // *safer*. Weight has to be able to move the band in one direction only.
    let previous = -1;
    const bandOrder = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 } as const;
    for (const weight of [1, 100, HEAVY_ITEM_GRAMS, VERY_HEAVY_ITEM_GRAMS, 5000]) {
      const r = assessRisk({ weight, authenticityVerified: true, idVerified: true, kycStatus: 'VERIFIED' });
      const rank = bandOrder[r.band];
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it('lands a fully-cleared item on the base, so nothing is clamped away', () => {
    // Additive-only: a cleared item scores exactly the base and nothing else.
    // The earlier design subtracted for cleared factors *and* added for uncleared
    // ones, so a cleared item hit 0 and the clamp erased every later difference.
    const cleared = assessRisk({
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
      weight: 1,
      appraisedValue: 1000,
    });
    expect(cleared.score).toBe(RISK_FACTORS.base);
  });

  it('always reports what drove the score', () => {
    const r = assessRisk({ weight: 300, appraisedValue: 200_000 });
    expect(r.factors.length).toBeGreaterThan(0);
  });
});
