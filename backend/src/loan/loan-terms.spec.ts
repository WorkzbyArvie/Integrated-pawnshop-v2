import {
  FORFEITURE_GRACE_DAYS,
  GRACE_PERIOD_DAYS,
  MAX_LOAN_TERM_DAYS,
  PAWN_TERM_DAYS,
  RENEWAL_EXTENSION_DAYS,
  forfeitureDateFrom,
  gracePeriodEndFrom,
  maturityDateFrom,
  toTermDays,
  toTermMonths,
} from './loan-terms';

/**
 * The term, the renewal window and the two deadlines that follow it.
 *
 * These were four separate answers to the same question before this file
 * existed: a hardcoded `termMonths: 1` on the pawn flow, an application DTO
 * that accepted up to 60 months, a contract computing maturity as
 * `termMonths * 30 * 24 * 60 * 60 * 1000`, and a renewal extending by a literal
 * 30 days before adding a literal 30-day grace and a literal 15 days to
 * forfeiture. A reviewer could not reconcile the code with the thesis, because
 * the code did not agree with itself.
 *
 * The date arithmetic is also where a contract and a ticket silently diverge.
 * `termMonths * 30 * 24 * 60 * 60 * 1000` is not a calendar month, so a
 * contract could state a maturity date its own ticket did not agree with - and
 * these are the dates a pawnshop is legally held to.
 */

const DAY = 86_400_000;

describe('loan terms', () => {
  it('uses a 30-day standard term', () => {
    expect(PAWN_TERM_DAYS).toBe(30);
  });

  it('grants 30 days on renewal', () => {
    expect(RENEWAL_EXTENSION_DAYS).toBe(30);
  });

  it('allows 30 grace days then 15 to forfeiture', () => {
    expect(GRACE_PERIOD_DAYS).toBe(30);
    expect(FORFEITURE_GRACE_DAYS).toBe(15);
  });

  describe('toTermDays', () => {
    it('converts the stored month count to days', () => {
      expect(toTermDays(1)).toBe(30);
      expect(toTermDays(2)).toBe(60);
    });

    it('rounds a fractional month up rather than losing a day', () => {
      // Flooring is only observably wrong where the product lands between two
      // integers, and those are the boundaries asserted here. Integer months -
      // the only values the column can actually hold - are identical under
      // ceil or floor, so a mutation swapping them survives unless a fractional
      // case is pinned.
      expect(toTermDays(1.5)).toBe(45);
      expect(toTermDays(0.5)).toBe(15);
      expect(toTermDays(2.1)).toBe(63);
      expect(toTermDays(1.01)).toBe(31);
      expect(toTermDays(1.99)).toBe(60);
      // 1/30 of a month is one day exactly; flooring would yield 0 - a
      // maturity date identical to the loan date.
      expect(toTermDays(1 / 30)).toBe(1);
    });

    it('falls back to the standard term for unusable input', () => {
      expect(toTermDays(null)).toBe(30);
      expect(toTermDays(undefined)).toBe(30);
      expect(toTermDays(0)).toBe(30);
      expect(toTermDays(-5)).toBe(30);
      expect(toTermDays(Number.NaN)).toBe(30);
    });
  });

  describe('toTermMonths', () => {
    it('round-trips the standard term', () => {
      expect(toTermMonths(PAWN_TERM_DAYS)).toBe(1);
    });

    it('rounds up so a stored term never understates the actual window', () => {
      expect(toTermMonths(31)).toBe(2);
    });

    it('never returns zero', () => {
      expect(toTermMonths(0)).toBe(1);
      expect(toTermMonths(-10)).toBe(1);
    });
  });

  describe('maturityDateFrom', () => {
    it('adds the term in calendar days', () => {
      const from = new Date('2026-03-01T00:00:00.000Z');
      expect(maturityDateFrom(30, from).toISOString()).toBe('2026-03-31T00:00:00.000Z');
    });

    it('crosses a month boundary correctly', () => {
      const from = new Date('2026-01-20T00:00:00.000Z');
      expect(maturityDateFrom(30, from).toISOString()).toBe('2026-02-19T00:00:00.000Z');
    });

    it('adds days across a DST transition without losing or gaining a day', () => {
      // setDate walks the local calendar, so a 30-day window spanning a
      // daylight-saving change is still 30 calendar days. A plain millisecond
      // addition would return 29 or 31 days of real time here, which is a
      // maturity date a borrower could be held to the wrong day.
      const dst = new Date('2026-03-01T12:00:00.000Z');
      const maturity = maturityDateFrom(30, dst);
      const calendarDays = Math.round(
        (Date.UTC(
          maturity.getUTCFullYear(),
          maturity.getUTCMonth(),
          maturity.getUTCDate(),
        ) -
          Date.UTC(dst.getUTCFullYear(), dst.getUTCMonth(), dst.getUTCDate())) /
          DAY,
      );
      expect(calendarDays).toBe(30);
    });

  // Known limit, stated rather than papered over.
  //
  // Replacing `setDate(d + n)` with `setTime(t + n * 86400000)` survives every
  // test in this file. That is not a weak test: for whole-day terms the two
  // produce the same instant in a process whose clock does not observe daylight
  // saving, so no input distinguishes them here. They diverge only under a DST
  // transition, and the runner's timezone is fixed at startup - assigning
  // `process.env.TZ` mid-run does not re-timezone V8's cached date tables.
  //
  // `setDate` is kept because it is the correct choice where it matters: a
  // 30-day pawn maturing across a transition is 30 *calendar* days. Proving
  // that needs this suite to run under a DST zone, which is a decision about CI
  // rather than about this file. The assertions below therefore pin the exact
  // dates, which catches any change in the arithmetic short of that one
  // semantically-equivalent swap.

  it('agrees with the calendar, not with 30-day millisecond months', () => {
      // The old contract expression was `termMonths * 30 * 24 * 60 * 60 * 1000`.
      // Twelve of those months is 360 days, not 365 - so a contract could state
      // a maturity date its own ticket did not agree with. Pinned to exact
      // ISO strings so any change in the arithmetic surfaces as a diff.
      expect(maturityDateFrom(365, new Date('2026-01-01T00:00:00.000Z')).toISOString())
        .toBe('2027-01-01T00:00:00.000Z');
      expect(maturityDateFrom(90, new Date('2026-01-01T00:00:00.000Z')).toISOString())
        .toBe('2026-04-01T00:00:00.000Z');
      expect(maturityDateFrom(30, new Date('2026-02-15T00:00:00.000Z')).toISOString())
        .toBe('2026-03-17T00:00:00.000Z');

      // And the arithmetic that produced the old drift, stated as a fact about
      // what was wrong rather than as an assertion on the current code.
      expect(new Date('2026-01-01T00:00:00.000Z').getTime() + 12 * 30 * DAY)
        .toBe(new Date('2026-12-27T00:00:00.000Z').getTime());
    });
  });

  describe('deadline chain', () => {
    it('places grace after maturity and forfeiture after grace', () => {
      const from = new Date('2026-06-01T00:00:00.000Z');
      const maturity = maturityDateFrom(30, from);
      const graceEnd = gracePeriodEndFrom(maturity);
      const forfeiture = forfeitureDateFrom(graceEnd);

      expect(graceEnd.getTime()).toBe(maturity.getTime() + 30 * DAY);
      expect(forfeiture.getTime()).toBe(graceEnd.getTime() + 15 * DAY);
      expect(maturity.getTime() - from.getTime()).toBe(30 * DAY);
    });

    it('keeps the whole window inside the cap the API enforces', () => {
      // A pawn at the maximum term must not push forfeiture past the bound the
      // application DTO advertises.
      const total = PAWN_TERM_DAYS + GRACE_PERIOD_DAYS + FORFEITURE_GRACE_DAYS;
      expect(total).toBeLessThanOrEqual(MAX_LOAN_TERM_DAYS + GRACE_PERIOD_DAYS);
    });
  });
});
