import {
  assessRisk,
  RISK_FACTORS,
  MODERATE_RISK_THRESHOLD,
  HIGH_RISK_THRESHOLD,
  CRITICAL_RISK_THRESHOLD,
  type RiskInput,
} from './appraisal';

/**
 * The POS quotes before the appraiser has inspected anything, and it sends only
 * `authenticityVerified: false`. It never sends `idVerified` or `kycStatus`.
 *
 * The scorer read both of those as failures, so every appraisal from the POS
 * scored `base 10 + authenticity 30 + id 25 + kyc 20` = **85, CRITICAL**, on a
 * 10g bracelet, with "ID not verified" and "KYC not verified" listed as findings
 * about the pawner. Nobody had checked either. The floor could not be lower,
 * because those two terms were constants.
 *
 * That is the same defect class as `riskScore: isHighRisk ? 60 : 0`: an absence
 * of information presented as a negative finding about a real person.
 */
const posQuote: RiskInput = {
  authenticityVerified: false,
  weight: 10,
  appraisedValue: 800,
};

describe('assessRisk — not assessed is not the same as assessed and failed', () => {
  it('does not score an unchecked pawner ID as a failure', () => {
    const risk = assessRisk(posQuote);

    expect(risk.factors).toContain('ID not assessed');
    expect(risk.factors).not.toContain('ID not verified');
  });

  it('does not score an absent KYC status as a failure', () => {
    const risk = assessRisk(posQuote);

    expect(risk.factors).toContain('KYC not assessed');
    expect(risk.factors).not.toContain('KYC not verified');
  });

  it('leaves the score below CRITICAL for an ordinary POS quote', () => {
    // 10 base + 30 authenticity = 40, which is HIGH - "needs manager review",
    // which is exactly what the submit-for-approval flow does next.
    const risk = assessRisk(posQuote);

    expect(risk.score).toBe(
      RISK_FACTORS.base + RISK_FACTORS.authenticityUnverified,
    );
    expect(risk.score).toBeLessThan(CRITICAL_RISK_THRESHOLD);
    expect(risk.band).toBe('HIGH');
  });

  it('cannot reach CRITICAL on paperwork alone', () => {
    // The invariant, rather than the number: nothing about un-assessed
    // dimensions may push a quote into the band that says "decline unless
    // someone senior accepts the exposure in writing".
    for (const value of [1, 100, 800, 50000, 250000]) {
      const risk = assessRisk({ authenticityVerified: false, appraisedValue: value });
      expect(risk.band).not.toBe('CRITICAL');
    }
  });

  it('still scores an explicitly failed ID', () => {
    // `false` is a real finding: somebody checked and it failed.
    const risk = assessRisk({ ...posQuote, idVerified: false });

    expect(risk.factors).toContain('ID not verified');
    expect(risk.score).toBe(
      RISK_FACTORS.base + RISK_FACTORS.authenticityUnverified + RISK_FACTORS.idUnverified,
    );
  });

  it('still scores an explicitly non-verified KYC', () => {
    const risk = assessRisk({ ...posQuote, kycStatus: 'PENDING' });

    expect(risk.factors).toContain('KYC not verified');
    expect(risk.score).toBe(
      RISK_FACTORS.base + RISK_FACTORS.authenticityUnverified + RISK_FACTORS.kycNotVerified,
    );
  });

  it('rewards a verified ID and KYC with no penalty', () => {
    const risk = assessRisk({ ...posQuote, idVerified: true, kycStatus: 'VERIFIED' });

    expect(risk.factors).toContain('ID verified');
    expect(risk.factors).toContain('KYC verified');
    expect(risk.score).toBe(
      RISK_FACTORS.base + RISK_FACTORS.authenticityUnverified,
    );
  });

  it('treats a KYC status case-insensitively, and blank as unassessed', () => {
    expect(assessRisk({ ...posQuote, kycStatus: '  verified ' }).factors)
      .toContain('KYC verified');
    expect(assessRisk({ ...posQuote, kycStatus: '   ' }).factors)
      .toContain('KYC not assessed');
    expect(assessRisk({ ...posQuote, kycStatus: null }).factors)
      .toContain('KYC not assessed');
  });

  it('is unaffected for the dimensions that were never ambiguous', () => {
    // Authenticity is explicitly `false` from the POS, which is a true statement
    // about the current state: the appraiser has not looked yet.
    const risk = assessRisk(posQuote);

    expect(risk.factors).toContain('authenticity unverified');
  });

  it('still blocks and still reads CRITICAL for a suspected counterfeit', () => {
    const risk = assessRisk({ ...posQuote, authenticitySuspect: true });

    expect(risk.blocking).toBe(true);
    expect(risk.band).toBe('CRITICAL');
  });

  it('keeps heavy and high-value handling on top of an honest floor', () => {
    const light = assessRisk(posQuote);
    // 500g sits between HEAVY_ITEM_GRAMS and VERY_HEAVY_ITEM_GRAMS, which the
    // scorer words as "elevated handling"; the vocabulary is its own.
    const heavy = assessRisk({ ...posQuote, weight: 500 });
    const valuable = assessRisk({ ...posQuote, appraisedValue: 500000 });

    expect(heavy.score).toBeGreaterThan(light.score);
    expect(heavy.factors.some((factor) => /elevated handling/.test(factor))).toBe(true);
    expect(valuable.score).toBeGreaterThan(light.score);
    expect(valuable.factors).toContain('high value exposure');
  });

  it('reaches LOW once authenticity is confirmed and the paperwork is in', () => {
    const cleared = assessRisk({
      authenticityVerified: true,
      idVerified: true,
      kycStatus: 'VERIFIED',
      weight: 10,
      appraisedValue: 800,
    });

    expect(cleared.score).toBe(RISK_FACTORS.base);
    expect(cleared.score).toBeLessThan(MODERATE_RISK_THRESHOLD);
    expect(cleared.band).toBe('LOW');
  });
});
