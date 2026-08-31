import {
  assertValidSelfieCaptureTimestamp,
  normalizeAndValidateKycIdNumber,
  normalizeAndValidatePhoneNumber,
  normalizeKycIdNumberForCompare,
  parseAndValidateDateOfBirth,
} from './kyc-validation';

describe('kyc-validation', () => {
  describe('normalizeAndValidatePhoneNumber', () => {
    it('normalizes local PH mobile format', () => {
      expect(normalizeAndValidatePhoneNumber('09280766440')).toBe('+639280766440');
    });

    it('accepts international PH mobile format', () => {
      expect(normalizeAndValidatePhoneNumber('+639280766440')).toBe('+639280766440');
    });

    it('rejects invalid phone formats', () => {
      expect(() => normalizeAndValidatePhoneNumber('12345')).toThrow(
        'Phone number must be a valid PH mobile number',
      );
    });
  });

  describe('parseAndValidateDateOfBirth', () => {
    it('accepts valid adult date of birth', () => {
      const dob = parseAndValidateDateOfBirth('1998-05-12', new Date('2026-04-04T00:00:00.000Z'));
      expect(dob.toISOString().startsWith('1998-05-12')).toBe(true);
    });

    it('rejects underage date of birth', () => {
      expect(() =>
        parseAndValidateDateOfBirth('2010-10-10', new Date('2026-04-04T00:00:00.000Z')),
      ).toThrow('You must be at least 18 years old to complete KYC');
    });
  });

  describe('normalizeAndValidateKycIdNumber', () => {
    it('normalizes national id and preserves comparable value', () => {
      const normalized = normalizeAndValidateKycIdNumber('NATIONAL_ID', '1234-5678-9012');
      expect(normalized).toBe('1234-5678-9012');
      expect(normalizeKycIdNumberForCompare(normalized)).toBe('123456789012');
    });

    it('rejects invalid national id length', () => {
      expect(() => normalizeAndValidateKycIdNumber('NATIONAL_ID', '1234567890')).toThrow(
        'National ID must contain exactly 12 or 16 digits',
      );
    });

    it('accepts a 12-digit national id', () => {
      expect(normalizeAndValidateKycIdNumber('NATIONAL_ID', '123456789012')).toBe('123456789012');
    });

    it('accepts a 16-digit national id', () => {
      expect(normalizeAndValidateKycIdNumber('NATIONAL_ID', '1234567890123456')).toBe('1234567890123456');
    });
  });

  describe('assertValidSelfieCaptureTimestamp', () => {
    it('accepts recent selfie capture', () => {
      const now = Date.parse('2026-04-04T12:00:00.000Z');
      expect(() =>
        assertValidSelfieCaptureTimestamp('2026-04-04T11:30:00.000Z', now),
      ).not.toThrow();
    });

    it('rejects expired selfie capture', () => {
      const now = Date.parse('2026-04-04T12:00:00.000Z');
      expect(() =>
        assertValidSelfieCaptureTimestamp('2026-04-04T10:30:00.000Z', now),
      ).toThrow('Live selfie capture is expired. Please capture again.');
    });

    it('accepts timezone-less timestamps using PH offset fallback', () => {
      const now = Date.parse('2026-04-04T12:10:00.000Z');
      expect(() =>
        assertValidSelfieCaptureTimestamp('2026-04-04T20:00:00.000', now),
      ).not.toThrow();
    });
  });
});
