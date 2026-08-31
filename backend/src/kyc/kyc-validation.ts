const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const KYC_MAX_SELFIE_AGE_MS = 60 * 60 * 1000;
export const KYC_MAX_FUTURE_SKEW_MS = 30 * 60 * 1000;

const SUSPICIOUS_NAME_PATTERNS = [
  /^(test|fake|sample|dummy|john doe|jane doe|foo bar|asdf|qwerty)/i,
  /^(a{3,}|b{3,}|c{3,}|d{3,}|e{3,}|f{3,})\s/i,
  /^.{0,3}\s.{0,3}$/,
];

export function assertNameNotSuspicious(fullName: string): void {
  const lower = fullName.toLowerCase().trim();
  for (const pattern of SUSPICIOUS_NAME_PATTERNS) {
    if (pattern.test(lower)) {
      throw new Error('Please enter your real full legal name. Suspicious name patterns are not allowed.');
    }
  }

  const words = lower.split(/\s+/).filter(Boolean);
  const uniqueChars = new Set(lower.replace(/\s/g, '')).size;
  if (words.length >= 2 && uniqueChars < 4) {
    throw new Error('Name appears too simple. Please enter your full legal name.');
  }
}

export function normalizeKycFullName(input: string): string {
  const normalized = String(input || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (normalized.length < 2 || normalized.length > 100) {
    throw new Error('Full name must be between 2 and 100 characters');
  }

  if (!/^[A-Za-z][A-Za-z .,'-]*$/.test(normalized)) {
    throw new Error('Full name contains invalid characters');
  }

  const parts = normalized.split(' ').filter((part) => part.trim().length > 0);
  if (parts.length < 2) {
    throw new Error('Please enter your full legal name');
  }

  return normalized;
}

export function parseAndValidateDateOfBirth(
  input: string,
  now: Date = new Date(),
): Date {
  const value = String(input || '').trim();
  if (!DOB_PATTERN.test(value)) {
    throw new Error('Date of birth must be in YYYY-MM-DD format');
  }

  const dob = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== value) {
    throw new Error('Date of birth is invalid');
  }

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  const dayDiff = now.getUTCDate() - dob.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  if (age < 18) {
    throw new Error('You must be at least 18 years old to complete KYC');
  }
  if (age > 100) {
    throw new Error('Date of birth is outside the supported age range');
  }

  return dob;
}

export function normalizeAndValidatePhoneNumber(input: string): string {
  const raw = String(input || '').trim();

  if (/^\+639\d{9}$/.test(raw)) {
    return raw;
  }

  const digitsOnly = raw.replace(/\D+/g, '');
  if (/^09\d{9}$/.test(digitsOnly)) {
    return `+63${digitsOnly.slice(1)}`;
  }
  if (/^639\d{9}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }

  throw new Error('Phone number must be a valid PH mobile number');
}

export function normalizeKycIdNumberForCompare(input: string): string {
  return String(input || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeAndValidateKycIdNumber(
  idType: string,
  input: string,
): string {
  const value = String(input || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');

  if (value.length < 6 || value.length > 32) {
    throw new Error('ID number length is invalid');
  }
  if (!/^[A-Z0-9-]+$/.test(value)) {
    throw new Error('ID number contains invalid characters');
  }

  const compareValue = normalizeKycIdNumberForCompare(value);
  if (compareValue.length < 6 || compareValue.length > 32) {
    throw new Error('ID number length is invalid');
  }
  if (/^(.)\1+$/.test(compareValue)) {
    throw new Error('ID number appears invalid');
  }

  if (idType === 'NATIONAL_ID' && !/^(?:\d{12}|\d{16})$/.test(compareValue)) {
    throw new Error('National ID must contain exactly 12 or 16 digits');
  }

  if (
    (idType === 'TIN_ID' || idType === 'SSS_ID' || idType === 'PHILHEALTH_ID') &&
    !/^\d{9,14}$/.test(compareValue)
  ) {
    throw new Error('ID number format is invalid for selected ID type');
  }

  if (idType === 'PASSPORT' && !/^[A-Z0-9]{6,9}$/.test(compareValue)) {
    throw new Error('Passport number format is invalid');
  }

  return value;
}

export function assertValidKycDocumentUrl(url: string, label: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`${label} URL is invalid`);
    }
  } catch {
    throw new Error(`${label} URL is invalid`);
  }
}

export function assertValidSelfieCaptureTimestamp(
  input: string,
  nowMs: number = Date.now(),
): Date {
  const raw = String(input || '').trim();
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
  const parseCandidate = hasExplicitTimezone ? raw : `${raw}+08:00`;

  const parsed = new Date(parseCandidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid selfieCapturedAt value');
  }

  const ageMs = nowMs - parsed.getTime();
  if (ageMs < -KYC_MAX_FUTURE_SKEW_MS || ageMs > KYC_MAX_SELFIE_AGE_MS) {
    throw new Error('Live selfie capture is expired. Please capture again.');
  }

  return parsed;
}