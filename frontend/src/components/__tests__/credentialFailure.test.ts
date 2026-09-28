import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import {
  CREDENTIAL_FAILURE_COPY,
  classifyCredentialFailure,
  type CredentialFailure,
} from '../../lib/credentialFailure';

/**
 * The change-password form used to handle two of the eight ways the endpoint can
 * fail and sent everything else to "We couldn't update your password. Check the
 * fields below and try again", which is misleading in most of those cases
 * because the fields are correct.
 *
 * These cover each outcome, the field it is attributed to, and the two responses
 * that carry no error code at all -- a throttled request and a rejected body from
 * the validation pipe -- which are the ones a code-based lookup cannot see.
 */

/** Builds an ApiError the way apiClient does, from a real response body. */
function apiError(status: number, body: unknown) {
  return new ApiError(
    (body as { message?: string })?.message ?? 'failed',
    status,
    body,
  );
}

const say = (failure: CredentialFailure) => CREDENTIAL_FAILURE_COPY[failure.kind](failure);

describe('classifyCredentialFailure', () => {
  it('names a wrong current password and attributes it to that field', () => {
    const failure = classifyCredentialFailure(
      apiError(401, {
        success: false,
        error: 'CURRENT_PASSWORD_INVALID',
        message: 'Current password is incorrect.',
      }),
    );

    expect(failure.kind).toBe('current-password');
    expect(failure.field).toBe('currentPassword');
    expect(say(failure)).toMatch(/not your current password/i);
  });

  it('does not tell a correct-looking user to check their fields', () => {
    // The reported case: the new password met every requirement, so telling them
    // to check the fields was actively wrong.
    const failure = classifyCredentialFailure(
      apiError(401, { success: false, error: 'CURRENT_PASSWORD_INVALID' }),
    );
    expect(say(failure)).not.toMatch(/check the fields/i);
  });

  it('recognises a throttled request, which carries no error code at all', () => {
    // ThrottlerGuard answers { statusCode, message } with no `error` field, so a
    // code-based lookup sees nothing and the form used to show the generic
    // message for a request that only needed patience.
    const failure = classifyCredentialFailure(
      apiError(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
    );

    expect(failure.kind).toBe('throttled');
    expect(say(failure)).toMatch(/wait a minute/i);
  });

  it('lists the rules the server actually rejected for a policy failure', () => {
    const failure = classifyCredentialFailure(
      apiError(400, {
        success: false,
        error: 'PASSWORD_POLICY_FAILED',
        message: 'Password does not meet the required policy.',
        data: { failed: ['minLength', 'symbol'] },
      }),
    );

    expect(failure.kind).toBe('policy');
    expect(failure.field).toBe('newPassword');
    expect(say(failure)).toMatch(/too short/i);
    expect(say(failure)).toMatch(/needs a symbol/i);
  });

  it('falls back to a generic policy message when no rules are named', () => {
    const failure = classifyCredentialFailure(
      apiError(400, { success: false, error: 'PASSWORD_POLICY_FAILED' }),
    );
    expect(say(failure)).toMatch(/does not meet the requirements/i);
  });

  it('attributes a confirmation mismatch to the confirm field', () => {
    const failure = classifyCredentialFailure(
      apiError(400, { success: false, error: 'PASSWORD_CONFIRMATION_MISMATCH' }),
    );
    expect(failure.field).toBe('confirmPassword');
    expect(say(failure)).toMatch(/do not match/i);
  });

  it('distinguishes a backend failure from a user error', () => {
    const failure = classifyCredentialFailure(
      apiError(503, { success: false, error: 'PASSWORD_UPDATE_FAILED' }),
    );
    expect(failure.kind).toBe('update-failed');
    expect(say(failure)).toMatch(/not updated/i);
  });

  it('keeps the status on an unrecognised failure so it stays diagnosable', () => {
    const failure = classifyCredentialFailure(
      apiError(400, { statusCode: 400, message: ['bad request'], error: 'Bad Request' }),
    );
    expect(failure.kind).toBe('unknown');
    expect(failure.status).toBe(400);
  });

  it('blames the service for a 5xx with no code, not the user', () => {
    const failure = classifyCredentialFailure(new Error('network'));
    expect(failure.kind).toBe('unknown');
    expect(say(failure)).toMatch(/our side/i);
  });

  it('never returns the old generic message for a known outcome', () => {
    const bodies = [
      [401, { error: 'CURRENT_PASSWORD_INVALID' }],
      [400, { error: 'PASSWORD_CONFIRMATION_MISMATCH' }],
      [400, { error: 'PASSWORD_POLICY_FAILED', data: { failed: ['minLength'] } }],
      [429, { statusCode: 429, message: 'ThrottlerException' }],
      [503, { error: 'CREDENTIAL_STATE_UNAVAILABLE' }],
      [503, { error: 'PASSWORD_UPDATE_FAILED' }],
    ] as const;

    for (const [status, body] of bodies) {
      const message = say(classifyCredentialFailure(apiError(status, body)));
      expect(message).not.toBe(
        "We couldn't update your password. Check the fields below and try again.",
      );
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
