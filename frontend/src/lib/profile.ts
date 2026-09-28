import api, { getApiErrorDetails } from './apiClient';

/**
 * Own-account profile contract (SEC-04 / SEC-06).
 *
 * `GET/PATCH /profile/me` is tenant-scoped to the caller's own profile, so this
 * client never accepts a profile id from the caller. The backend is the sole
 * authority for what is stored; the field limits below mirror
 * `backend/src/profile/dto/update-profile.dto.ts` and are guidance only.
 */

export interface MyProfile {
  id: string;
  email: string;
  fullName: string | null;
  phoneNumber: string | null;
  address: string | null;
  dateOfBirth: string | null;
  avatarUrl: string | null;
  role: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export const PROFILE_FIELD_LIMITS = {
  fullName: 150,
  phoneNumber: 50,
  address: 255,
  avatarUrl: 500,
} as const;

export const PROFILE_ERROR_CODES = {
  NOT_FOUND: 'PROFILE_NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export const PROFILE_COPY = {
  heading: 'Profile settings',
  subtitle: 'Your account details across PawnGold.',
  loading: 'Loading your profile',
  loadError: "We couldn't load your profile. Try again.",
  identityHeading: 'Identity',
  contactHeading: 'Contact',
  fullName: 'Full name',
  phoneNumber: 'Phone number',
  address: 'Address',
  dateOfBirth: 'Date of birth',
  avatarUrl: 'Avatar URL',
  emailReadOnly: 'Email',
  emailNote: 'Your sign-in email cannot be changed here.',
  save: 'Save changes',
  saving: 'Saving',
  saved: 'Profile updated successfully',
  saveError: "We couldn't save your profile. Check the fields and try again.",
  retry: 'Try again',
  tooLong: (label: string, max: number) => `${label} must be ${max} characters or fewer.`,
  invalidDate: 'Enter a valid date of birth.',
  futureDate: 'Date of birth cannot be in the future.',
  cancel: 'Cancel',
  notProvided: 'Not provided',
} as const;

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function normalizeMyProfile(raw: unknown): MyProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.email !== 'string') return null;
  return {
    id: value.id,
    email: value.email,
    fullName: asStringOrNull(value.fullName),
    phoneNumber: asStringOrNull(value.phoneNumber),
    address: asStringOrNull(value.address),
    dateOfBirth: asStringOrNull(value.dateOfBirth),
    avatarUrl: asStringOrNull(value.avatarUrl),
    role: asStringOrNull(value.role),
    createdAt: asStringOrNull(value.createdAt),
    updatedAt: asStringOrNull(value.updatedAt),
  };
}

export async function fetchMyProfile(): Promise<MyProfile | null> {
  const raw = await api.get<unknown>('/profile/me');
  return normalizeMyProfile(raw);
}

export interface ProfileUpdateInput {
  fullName?: string;
  phoneNumber?: string;
  address?: string;
  dateOfBirth?: string;
  avatarUrl?: string;
}

/** Only changed, non-empty fields are sent so an untouched field is never blanked. */
export function buildProfileUpdate(current: MyProfile, next: ProfileUpdateInput): ProfileUpdateInput {
  const payload: ProfileUpdateInput = {};
  const assign = <K extends keyof ProfileUpdateInput>(key: K, value: string | undefined) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    const original = current[key as keyof MyProfile];
    const originalValue = typeof original === 'string' ? original : '';
    if (trimmed === originalValue) return;
    if (trimmed === '' && originalValue === '') return;
    payload[key] = trimmed;
  };

  assign('fullName', next.fullName);
  assign('phoneNumber', next.phoneNumber);
  assign('address', next.address);
  assign('avatarUrl', next.avatarUrl);
  // The draft holds a `YYYY-MM-DD` date-input value while the server returns a
  // full ISO timestamp, so compare in the same normalized shape or an untouched
  // field would always look changed.
  if (next.dateOfBirth !== undefined) {
    const original = toDateInputValue(current.dateOfBirth);
    const draft = next.dateOfBirth.trim();
    if (draft !== original) payload.dateOfBirth = draft;
  }
  return payload;
}

export async function updateMyProfile(input: ProfileUpdateInput): Promise<MyProfile | null> {
  const raw = await api.patch<unknown>('/profile/me', input);
  return normalizeMyProfile(raw);
}

export type ProfileFieldErrors = Partial<
  Record<'fullName' | 'phoneNumber' | 'address' | 'avatarUrl' | 'dateOfBirth', string>
>;

/** Client-side limit/format guidance. The backend DTO remains authoritative. */
export function validateProfileInput(input: ProfileUpdateInput): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};

  if (input.fullName !== undefined && input.fullName.trim().length > PROFILE_FIELD_LIMITS.fullName) {
    errors.fullName = PROFILE_COPY.tooLong(PROFILE_COPY.fullName, PROFILE_FIELD_LIMITS.fullName);
  }
  if (
    input.phoneNumber !== undefined &&
    input.phoneNumber.trim().length > PROFILE_FIELD_LIMITS.phoneNumber
  ) {
    errors.phoneNumber = PROFILE_COPY.tooLong(
      PROFILE_COPY.phoneNumber,
      PROFILE_FIELD_LIMITS.phoneNumber,
    );
  }
  if (input.address !== undefined && input.address.trim().length > PROFILE_FIELD_LIMITS.address) {
    errors.address = PROFILE_COPY.tooLong(PROFILE_COPY.address, PROFILE_FIELD_LIMITS.address);
  }
  if (
    input.avatarUrl !== undefined &&
    input.avatarUrl.trim().length > PROFILE_FIELD_LIMITS.avatarUrl
  ) {
    errors.avatarUrl = PROFILE_COPY.tooLong(PROFILE_COPY.avatarUrl, PROFILE_FIELD_LIMITS.avatarUrl);
  }

  if (input.dateOfBirth !== undefined && input.dateOfBirth.trim() !== '') {
    const parsed = new Date(input.dateOfBirth);
    if (Number.isNaN(parsed.getTime())) {
      errors.dateOfBirth = PROFILE_COPY.invalidDate;
    } else if (parsed.getTime() > Date.now()) {
      errors.dateOfBirth = PROFILE_COPY.futureDate;
    }
  }

  return errors;
}

export function isProfileNotFound(error: unknown): boolean {
  return getApiErrorDetails(error).code === PROFILE_ERROR_CODES.NOT_FOUND;
}

/** `YYYY-MM-DD` for a `Date`, or an empty string when the value is unusable. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}
