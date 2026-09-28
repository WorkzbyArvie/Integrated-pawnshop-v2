import { getApiErrorDetails } from './apiClient';

/**
 * Explains a failed credential change instead of collapsing every outcome into
 * one message.
 *
 * The change-password form handled two of the eight ways the endpoint can fail.
 * A wrong current password and a confirmation mismatch each got their own
 * wording, and the other six all produced "We couldn't update your password.
 * Check the fields below and try again" -- which is actively misleading, because
 * in most of those cases the fields are provably fine. A throttled request is
 * the obvious one: the endpoint allows five attempts a minute and returns a
 * 429 with no error code at all, so the form could not tell "slow down" from
 * "you typed the wrong thing".
 *
 * This classifies the response into an outcome, and the caller turns that into
 * copy and highlights the field at fault. A pure function, so it is testable
 * without rendering the form.
 */
export type CredentialFailureKind =
  | 'current-password'
  | 'confirmation'
  | 'policy'
  | 'throttled'
  | 'state-unavailable'
  | 'update-failed'
  | 'empty-field'
  | 'unknown';

export interface CredentialFailure {
  kind: CredentialFailureKind;
  /** Which input the message belongs beside, so the user is not left hunting. */
  field: 'currentPassword' | 'newPassword' | 'confirmPassword' | 'form';
  /** Rule keys the server rejected, for a policy failure. */
  failedRules: string[];
  /** HTTP status, kept even for known outcomes so an unmapped one stays diagnosable. */
  status: number | null;
}

const CODE_TO_KIND: Record<string, { kind: CredentialFailureKind; field: CredentialFailure['field'] }> = {
  CURRENT_PASSWORD_INVALID: { kind: 'current-password', field: 'currentPassword' },
  MFA_REAUTH_FAILED: { kind: 'current-password', field: 'currentPassword' },
  PASSWORD_CONFIRMATION_MISMATCH: { kind: 'confirmation', field: 'confirmPassword' },
  PASSWORD_POLICY_FAILED: { kind: 'policy', field: 'newPassword' },
  CREDENTIAL_STATE_UNAVAILABLE: { kind: 'state-unavailable', field: 'form' },
  PASSWORD_UPDATE_FAILED: { kind: 'update-failed', field: 'form' },
  CREDENTIAL_VERIFICATION_UNAVAILABLE: { kind: 'update-failed', field: 'form' },
};

export function classifyCredentialFailure(error: unknown): CredentialFailure {
  const status =
    typeof (error as { status?: unknown } | null)?.status === 'number'
      ? ((error as { status: number }).status)
      : null;
  const { code, failedRules } = getApiErrorDetails(error);

  const mapped = code ? CODE_TO_KIND[code] : undefined;
  if (mapped) {
    return { ...mapped, failedRules: [...failedRules], status };
  }

  // Throttling arrives from the guard with no error code, so it has to be
  // recognised by status. Five attempts a minute is easy to reach when someone is
  // correcting a typo.
  if (status === 429) {
    return { kind: 'throttled', field: 'form', failedRules: [], status };
  }

  // A rejected body from the validation pipe: { statusCode, message, error: 'Bad Request' }.
  if (status === 400) {
    return { kind: 'unknown', field: 'form', failedRules: [...failedRules], status };
  }

  return { kind: 'unknown', field: 'form', failedRules: [...failedRules], status };
}

/**
 * Human wording per outcome.
 *
 * The policy branch lists the rules that actually failed rather than saying the
 * password is wrong, since a rejected new password is a different problem from a
 * rejected current one and the user cannot otherwise tell them apart.
 */
export const CREDENTIAL_FAILURE_COPY: Record<
  CredentialFailureKind,
  (failure: CredentialFailure) => string
> = {
  'current-password': () =>
    'That is not your current password. Check it and try again.',
  confirmation: () => 'The new password and its confirmation do not match.',
  policy: (failure) => {
    if (failure.failedRules.length === 0) {
      return 'The new password does not meet the requirements listed above.';
    }
    const named = failure.failedRules
      .map((rule) => POLICY_RULE_PHRASES[rule])
      .filter((phrase): phrase is string => Boolean(phrase));
    if (named.length === 0) {
      return 'The new password does not meet the requirements listed above.';
    }
    return `The new password was rejected: ${named.join('; ')}.`;
  },
  throttled: () =>
    'Too many attempts in a row. Wait a minute, then try again with the correct current password.',
  'state-unavailable': () =>
    "We couldn't confirm your account security status, so nothing was changed. Try again in a moment.",
  'update-failed': () =>
    'Your password was not updated. The service could not complete the change — try again, and if it keeps failing contact support.',
  'empty-field': () => 'Fill in every field before continuing.',
  unknown: (failure) =>
    failure.status === null || failure.status >= 500
      ? "Something went wrong on our side and your password was not changed. Try again in a moment."
      : 'Your password was not changed. Check the fields above and try again.',
};

const POLICY_RULE_PHRASES: Record<string, string> = {
  minLength: 'it is too short',
  maxLength: 'it is too long',
  uppercase: 'it needs an uppercase letter',
  lowercase: 'it needs a lowercase letter',
  number: 'it needs a number',
  symbol: 'it needs a symbol',
  noSurroundingWhitespace: 'it has leading or trailing spaces',
  notCommon: 'it is too common',
  notObviousVariant: 'it is too similar to a common password',
  reuse: 'it is the same as your current password',
  required: 'it is empty',
  characterSet: 'it contains characters that are not allowed',
};
