import { describe, expect, it } from 'vitest';
import {
  buildProfileUpdate,
  normalizeMyProfile,
  toDateInputValue,
  validateProfileInput,
  PROFILE_FIELD_LIMITS,
  type MyProfile,
} from './profile';

const PROFILE: MyProfile = {
  id: 'user-1',
  email: 'owner@pawngold.ph',
  fullName: 'Ana Dela Cruz',
  phoneNumber: '09171234567',
  address: '123 Rizal St',
  dateOfBirth: '1990-04-12T00:00:00.000Z',
  avatarUrl: null,
  role: 'OWNER',
};

describe('normalizeMyProfile', () => {
  it('accepts a complete payload', () => {
    expect(normalizeMyProfile(PROFILE)).toMatchObject({ id: 'user-1', fullName: 'Ana Dela Cruz' });
  });

  it('rejects a payload with no id', () => {
    expect(normalizeMyProfile({ email: 'a@b.c' })).toBeNull();
  });

  it('rejects a payload with no email', () => {
    expect(normalizeMyProfile({ id: 'user-1' })).toBeNull();
  });

  it('rejects a non-object payload', () => {
    expect(normalizeMyProfile(null)).toBeNull();
    expect(normalizeMyProfile('nope')).toBeNull();
  });

  it('coerces absent optional fields to null instead of undefined', () => {
    const result = normalizeMyProfile({ id: 'user-1', email: 'a@b.c' });
    expect(result).not.toBeNull();
    expect(result?.fullName).toBeNull();
    expect(result?.avatarUrl).toBeNull();
  });
});

describe('buildProfileUpdate', () => {
  it('omits unchanged fields so an untouched value is never blanked', () => {
    expect(
      buildProfileUpdate(PROFILE, {
        fullName: 'Ana Dela Cruz',
        phoneNumber: '09171234567',
        address: '123 Rizal St',
        dateOfBirth: '1990-04-12',
        avatarUrl: '',
      }),
    ).toEqual({});
  });

  it('includes only the changed field', () => {
    expect(buildProfileUpdate(PROFILE, { address: '456 Mabini St' })).toEqual({
      address: '456 Mabini St',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(buildProfileUpdate(PROFILE, { fullName: '  Ana D. Cruz  ' })).toEqual({
      fullName: 'Ana D. Cruz',
    });
  });

  it('sends an explicit clear when an existing value is emptied', () => {
    expect(buildProfileUpdate(PROFILE, { address: '' })).toEqual({ address: '' });
  });

  it('does not send a field that is empty in both places', () => {
    expect(buildProfileUpdate(PROFILE, { avatarUrl: '   ' })).toEqual({});
  });
});

describe('validateProfileInput', () => {
  it('accepts a compliant payload', () => {
    expect(validateProfileInput({ fullName: 'Ana', phoneNumber: '0917' })).toEqual({});
  });

  it('flags each field over its documented limit', () => {
    const errors = validateProfileInput({
      fullName: 'a'.repeat(PROFILE_FIELD_LIMITS.fullName + 1),
      phoneNumber: '9'.repeat(PROFILE_FIELD_LIMITS.phoneNumber + 1),
      address: 'a'.repeat(PROFILE_FIELD_LIMITS.address + 1),
      avatarUrl: 'a'.repeat(PROFILE_FIELD_LIMITS.avatarUrl + 1),
    });
    expect(Object.keys(errors).sort()).toEqual([
      'address',
      'avatarUrl',
      'fullName',
      'phoneNumber',
    ]);
  });

  it('accepts a value exactly at the limit', () => {
    expect(
      validateProfileInput({ fullName: 'a'.repeat(PROFILE_FIELD_LIMITS.fullName) }),
    ).toEqual({});
  });

  it('rejects an unparseable date of birth', () => {
    expect(validateProfileInput({ dateOfBirth: 'not-a-date' }).dateOfBirth).toBeTruthy();
  });

  it('rejects a future date of birth', () => {
    const future = new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10);
    expect(validateProfileInput({ dateOfBirth: future }).dateOfBirth).toBeTruthy();
  });

  it('allows an empty date of birth', () => {
    expect(validateProfileInput({ dateOfBirth: '' }).dateOfBirth).toBeUndefined();
  });
});

describe('toDateInputValue', () => {
  it('formats an ISO timestamp as a date input value', () => {
    expect(toDateInputValue('1990-04-12T00:00:00.000Z')).toBe('1990-04-12');
  });

  it('returns an empty string for a missing value', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(toDateInputValue('garbage')).toBe('');
  });
});
