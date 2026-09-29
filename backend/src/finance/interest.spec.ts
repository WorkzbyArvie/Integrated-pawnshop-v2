import {
  DEFAULT_LATE_PENALTY_RATE,
  DEFAULT_MONTHLY_INTEREST_RATE,
  DEFAULT_RATES,
  DEFAULT_SERVICE_FEE_RATE,
  MAX_INTEREST_RATE,
  calculateLoanBreakdown,
  changeDue,
  interestFor,
  latePenaltyFor,
  resolveRates,
  settlesAmount,
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
  it('defaults to 3.5% monthly interest and a 2% service fee', () => {
    expect(DEFAULT_MONTHLY_INTEREST_RATE).toBe(0.035);
    expect(DEFAULT_SERVICE_FEE_RATE).toBe(0.02);
    expect(DEFAULT_RATES.monthlyInterestRate).toBe(0.035);
    expect(DEFAULT_RATES.serviceFeeRate).toBe(0.02);
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
      expect(b.serviceFee).toBe(200);
      expect(b.total).toBe(10550);
    });

    it('computes at the shop configured rate, not the default', () => {
      const b = calculateLoanBreakdown(10000, resolveRates({ interestRate: 0.04 }));
      expect(b.interest).toBe(400);
      expect(b.total).toBe(10600);
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
