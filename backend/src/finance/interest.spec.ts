import {
  DEFAULT_LATE_PENALTY_RATE,
  DEFAULT_MONTHLY_INTEREST_RATE,
  DEFAULT_RATES,
  DEFAULT_SERVICE_FEE_RATE,
  MAX_INTEREST_RATE,
  MAX_SERVICE_FEE_PCT,
  SERVICE_FEE_CAP_PESOS,
  STATUTORY_MIN_LTV,
  calculateLoanBreakdown,
  changeDue,
  interestFor,
  isBelowStatutoryMinimum,
  latePenaltyFor,
  resolveRates,
  serviceFeeFor,
  settlesAmount,
  statutoryMinimumLoan,
  toCentavos,
} from './interest';

/**
 * What a customer owes, defined once.
 *
 * The project had four answers to that question and they disagreed. A
 * redemption screen quoted 3% from `principal * 0.03` and sent that figure as
 * `amountPaid`; the pawn flow charged 3.5% and stored it; the contract printed a
 * 2% service fee; and `loan.interest_rate` defaulted to 3.0 and was never
 * written. On a PHP 10,000 pawn the staff member read a total PHP 50 short of
 * what the shop was owed, and the system accepted it.
 *
 * The failure mode was never a single wrong number. It was several correct
 * numbers that did not agree, which is why every one of these tests is about two
 * paths agreeing rather than about one path being right.
 */

describe('interest and fee rates', () => {
  it('defaults to 3.5% monthly interest', () => {
    expect(DEFAULT_MONTHLY_INTEREST_RATE).toBe(0.035);
    expect(DEFAULT_RATES.monthlyInterestRate).toBe(0.035);
  });

  it('caps the service fee at the P.D. 114 ceiling of 1% and PHP 5', () => {
    // Section 10. The earlier default of 2% exceeded the statutory ceiling.
    expect(MAX_SERVICE_FEE_PCT).toBe(0.01);
    expect(SERVICE_FEE_CAP_PESOS).toBe(5);
    expect(DEFAULT_SERVICE_FEE_RATE).toBe(0.01);
    expect(DEFAULT_RATES.serviceFeeRate).toBe(0.01);
  });

  it('sets the statutory minimum loan at 30% of appraised value', () => {
    expect(STATUTORY_MIN_LTV).toBe(0.3);
  });

  describe('resolveRates', () => {
    it('falls back to the platform default when a shop has set nothing', () => {
      expect(resolveRates({})).toEqual(DEFAULT_RATES);
      expect(resolveRates(null)).toEqual(DEFAULT_RATES);
      expect(resolveRates(undefined)).toEqual(DEFAULT_RATES);
      expect(resolveRates('not-an-object')).toEqual(DEFAULT_RATES);
    });

    it('honours a shop that has configured its own rates', () => {
      // This is the multi-tenant case: two shops on one platform, different
      // terms, no code change.
      const rates = resolveRates({
        interestRate: 0.04,
        serviceFeeRate: 0.015,
        latePenaltyRate: 0.05,
      });
      expect(rates.monthlyInterestRate).toBe(0.04);
      expect(rates.serviceFeeRate).toBe(0.015);
      expect(rates.latePenaltyRate).toBe(0.05);
    });

    it('falls back per field, so setting one rate does not discard the others', () => {
      const rates = resolveRates({ interestRate: 0.04 });
      expect(rates.monthlyInterestRate).toBe(0.04);
      expect(rates.serviceFeeRate).toBe(DEFAULT_SERVICE_FEE_RATE);
      expect(rates.latePenaltyRate).toBe(DEFAULT_LATE_PENALTY_RATE);
    });

    it('ignores a percentage typed as 3.5 instead of 0.035', () => {
      // Out of range, so rejected in favour of the default. Accepting it would
      // charge 350% interest - the kind of error that reaches a contract.
      const rates = resolveRates({ interestRate: 3.5 });
      expect(rates.monthlyInterestRate).toBe(DEFAULT_MONTHLY_INTEREST_RATE);
    });

    it('rejects negatives, strings, NaN and infinity', () => {
      expect(resolveRates({ interestRate: -0.01 }).monthlyInterestRate)
        .toBe(DEFAULT_MONTHLY_INTEREST_RATE);
      expect(resolveRates({ interestRate: '0.04' }).monthlyInterestRate)
        .toBe(DEFAULT_MONTHLY_INTEREST_RATE);
      expect(resolveRates({ interestRate: Number.NaN }).monthlyInterestRate)
        .toBe(DEFAULT_MONTHLY_INTEREST_RATE);
      expect(resolveRates({ interestRate: Number.POSITIVE_INFINITY }).monthlyInterestRate)
        .toBe(DEFAULT_MONTHLY_INTEREST_RATE);
    });

    it('rejects a rate beyond the configured ceiling', () => {
      expect(resolveRates({ interestRate: MAX_INTEREST_RATE + 0.01 }).monthlyInterestRate)
        .toBe(DEFAULT_MONTHLY_INTEREST_RATE);
      expect(resolveRates({ interestRate: MAX_INTEREST_RATE }).monthlyInterestRate)
        .toBe(MAX_INTEREST_RATE);
    });
  });

  describe('calculateLoanBreakdown', () => {
    it('computes interest, fee and total at the platform default', () => {
      const b = calculateLoanBreakdown(10000);
      expect(b.interest).toBe(350);
      // P.D. 114 s.10: 1% of 10,000 is 100, and the fee is capped at PHP 5, so
      // the lesser binds. Charging the 1% would be 20x the permitted fee.
      expect(b.serviceFee).toBe(5);
      expect(b.total).toBe(10355);
    });

    it('computes at the shop configured interest rate, not the default', () => {
      const b = calculateLoanBreakdown(10000, resolveRates({ interestRate: 0.04 }));
      expect(b.interest).toBe(400);
      expect(b.total).toBe(10405);
    });

    it('reports the uncapped fee and whether the statute bound it', () => {
      // The pawner is entitled to know the PHP 5 came from the cap rather than
      // from the rate, so the reduction is recorded on the breakdown.
      const b = calculateLoanBreakdown(10000);
      expect(b.serviceFeeUncapped).toBe(100);
      expect(b.serviceFeeCappedByStatute).toBe(true);
    });

    it('agrees with the two other paths that compute a figure for the same pawn', () => {
      // The regression this file exists for. Redemption used to compute its own
      // total in the browser and send it as amountPaid; the loan recorded 3.5%;
      // the contract printed something else again. One expression, three uses.
      const principal = 10000;
      const rates = resolveRates({});
      const breakdown = calculateLoanBreakdown(principal, rates);

      expect(breakdown.interest).toBe(interestFor(principal, rates));
      expect(breakdown.total).toBe(
        toCentavos(principal + interestFor(principal, rates) + breakdown.serviceFee),
      );
    });

    it('rounds to the centavo', () => {
      // 0.035 of 1234.56 is 43.2096.
      expect(calculateLoanBreakdown(1234.56).interest).toBe(43.21);
      expect(calculateLoanBreakdown(0.01).serviceFee).toBe(0);
    });
  });

  describe('serviceFeeFor - P.D. 114 Section 10', () => {
    //   "In addition to interest charges, pawnshops may impose a maximum service
    //    charge of five pesos (P5.00), but in no case to exceed one per cent
    //    (1%) of the principal loan."
    //
    // The cap is the LESSER of the two, so the fee is not proportional. Reading
    // the 1% as a schedule - which is what this module did before the statute
    // was applied - charges 20x the permitted fee on a PHP 10,000 loan.

    it('takes the lesser of 1% and PHP 5 on a large loan', () => {
      // 1% of 10,000 is 100; the cap is 5.
      expect(serviceFeeFor(10000)).toBe(5);
    });

    it('takes 1% where 1% is below the flat cap', () => {
      // 1% of 300 is 3, which is less than 5.
      expect(serviceFeeFor(300)).toBe(3);
    });

    it('never exceeds PHP 5 on any principal', () => {
      for (const p of [100, 500, 1000, 10000, 100000, 1000000]) {
        expect(serviceFeeFor(p)).toBeLessThanOrEqual(5);
      }
    });

    it('never exceeds 1% on any principal', () => {
      for (const p of [100, 500, 1000, 10000, 100000, 1000000]) {
        expect(serviceFeeFor(p)).toBeLessThanOrEqual(toCentavos(p * 0.01));
      }
    });

    it('ignores a shop trying to configure a fee above the statutory ceiling', () => {
      // resolveRates accepts a 0.05 service fee as a configured rate; the cap
      // still binds, so the shop cannot charge above the statute by configuring.
      const rates = resolveRates({ serviceFeeRate: 0.05 });
      expect(serviceFeeFor(10000, rates)).toBe(5);
      expect(serviceFeeFor(300, rates)).toBe(3);
    });

    it('handles a non-positive principal as no fee', () => {
      for (const bad of [0, -100, Number.NaN]) {
        expect(serviceFeeFor(bad)).toBe(0);
      }
    });
  });

  describe('isBelowStatutoryMinimum - P.D. 114 Section 9', () => {
    //   "the amount of loan shall, in no case, be less than thirty per cent
    //    (30%) of the appraised value of the security offered for the loan
    //    unless the pawner manifests in writing the desire to borrow a lesser
    //    amount."

    it('accepts a loan at or above 30% of the appraised value', () => {
      expect(isBelowStatutoryMinimum(10000, 3000)).toBe(false);
      expect(isBelowStatutoryMinimum(10000, 7000)).toBe(false);
      expect(isBelowStatutoryMinimum(10000, 10000)).toBe(false);
    });

    it('refuses a loan below 30% of the appraised value', () => {
      // The mis-appraisal case: a 10,000 item released for 1,000.
      expect(isBelowStatutoryMinimum(10000, 1000)).toBe(true);
      expect(isBelowStatutoryMinimum(10000, 2999.99)).toBe(true);
    });

    it('permits a sub-minimum loan when written consent is recorded', () => {
      // The statute's exception, and it is an evidenced one - a branch that
      // cannot record the borrower's written request cannot rely on it.
      expect(isBelowStatutoryMinimum(10000, 1000, true)).toBe(false);
    });

    it('treats an unusable appraisal or loan as below the minimum', () => {
      for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(isBelowStatutoryMinimum(v, 1000)).toBe(true);
        expect(isBelowStatutoryMinimum(10000, v)).toBe(true);
      }
    });

    it('computes the statutory minimum loan', () => {
      expect(statutoryMinimumLoan(10000)).toBe(3000);
      expect(statutoryMinimumLoan(420)).toBe(126);
      expect(statutoryMinimumLoan(0)).toBe(0);
    });

    it('agrees with the 70% LTV the appraisal screen uses', () => {
      // The POS form prices at 70%, comfortably above the floor, so ordinary
      // pawns are unaffected by the check.
      const appraised = 10000;
      const ltvLoan = appraised * 0.7;
      expect(isBelowStatutoryMinimum(appraised, ltvLoan)).toBe(false);
    });

    it('treats a non-positive principal as zero rather than a negative loan', () => {
      for (const bad of [0, -500, Number.NaN, Number.POSITIVE_INFINITY]) {
        const b = calculateLoanBreakdown(bad);
        expect(b.total).toBe(0);
        expect(b.interest).toBe(0);
        expect(b.serviceFee).toBe(0);
      }
    });
  });

  describe('latePenaltyFor', () => {
    it('uses the shop configured penalty rate', () => {
      expect(latePenaltyFor(10000, resolveRates({ latePenaltyRate: 0.05 }))).toBe(500);
    });

    it('defaults to 3%', () => {
      expect(latePenaltyFor(10000)).toBe(300);
      expect(DEFAULT_LATE_PENALTY_RATE).toBe(0.03);
    });
  });

  describe('settlesAmount', () => {
    it('accepts the exact quoted total', () => {
      expect(settlesAmount(10550, 10550)).toBe(true);
    });

    it('accepts a customer who overpays', () => {
      expect(settlesAmount(10600, 10550)).toBe(true);
    });

    it('rejects a customer who is a centavo short', () => {
      expect(settlesAmount(10549.99, 10550)).toBe(false);
    });

    it('is not fooled by binary floating point', () => {
      // 0.1 + 0.2 !== 0.3. A naive comparison would reject a customer who
      // tendered exactly the amount quoted.
      expect(settlesAmount(0.3, 0.1 + 0.2)).toBe(true);
    });

    it('rejects nonsense rather than treating it as settled', () => {
      expect(settlesAmount(Number.NaN, 100)).toBe(false);
      expect(settlesAmount(100, Number.NaN)).toBe(false);
    });
  });

  describe('changeDue', () => {
    it('returns the overpayment', () => {
      expect(changeDue(11000, 10550)).toBe(450);
    });

    it('never returns a negative, so a short payment is not a refund', () => {
      expect(changeDue(10000, 10550)).toBe(0);
    });
  });
});
