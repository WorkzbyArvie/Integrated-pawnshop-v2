import { Injectable } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Window over which failed current-password attempts are counted.
 *
 * Deliberately short. The user is sitting in front of the dialog retrying, so a
 * long lockout would punish a typo as if it were an attack, and this is
 * reauthentication of an already-authenticated session rather than a login
 * attempt.
 */
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Failed attempts tolerated inside the window before reauthentication is
 * refused. The fifth failure is rejected, so a user gets four corrections.
 */
const MAX_ATTEMPTS = 5;

export const MFA_REAUTH_ERROR_CODES = {
  FAILED: 'MFA_REAUTH_FAILED',
  LOCKED: 'MFA_REAUTH_LOCKED',
} as const;

export interface MfaReauthAttemptView {
  attempts: number;
  remaining: number;
}

/**
 * Per-account counter for failed current-password checks in the MFA dialog.
 *
 * This exists because the request throttle cannot tell the two cases apart. The
 * throttler is keyed by IP and counts every hit on the endpoint, so a mistyped
 * password and a request for a second email are indistinguishable to it. Keying
 * this by account and separating the outcomes lets the caller report what
 * actually happened.
 *
 * In-memory by design: a restart clears it, which is acceptable for a
 * reauthentication throttle on an authenticated session. Moving it to the
 * database would make it durable but would also mean a failed attempt writes a
 * row, which is a worse trade for this case.
 */
@Injectable()
export class MfaPasswordAttemptService {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  /**
   * Records a failed check and throws when the account has spent its budget.
   *
   * Called only after a password has been rejected, so a correct password never
   * appears here and cannot be blocked by earlier typos.
   */
  recordFailure(profileId: string): MfaReauthAttemptView {
    const now = Date.now();
    const existing = this.attempts.get(profileId);

    if (!existing || existing.resetAt <= now) {
      this.attempts.set(profileId, { count: 1, resetAt: now + WINDOW_MS });
      return { attempts: 1, remaining: MAX_ATTEMPTS - 1 };
    }

    const count = existing.count + 1;
    this.attempts.set(profileId, { count, resetAt: existing.resetAt });

    if (count >= MAX_ATTEMPTS) {
      throw new HttpException(
        {
          success: false,
          error: MFA_REAUTH_ERROR_CODES.LOCKED,
          message:
            'Too many incorrect password attempts. Close this dialog and try again shortly.',
          retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return { attempts: count, remaining: MAX_ATTEMPTS - count };
  }

  /**
   * Clears the counter after a successful check.
   *
   * Without this a user who mistypes twice, corrects, and then returns an hour
   * later would be one typo away from a lockout they never actually triggered.
   */
  recordSuccess(profileId: string): void {
    this.attempts.delete(profileId);
  }

  /** Current standing, for the caller to report remaining attempts. */
  view(profileId: string): MfaReauthAttemptView {
    const existing = this.attempts.get(profileId);
    if (!existing || existing.resetAt <= Date.now()) {
      return { attempts: 0, remaining: MAX_ATTEMPTS };
    }
    return {
      attempts: existing.count,
      remaining: Math.max(0, MAX_ATTEMPTS - existing.count),
    };
  }

  /** Test seam, so a suite can start from a known state. */
  reset(profileId?: string): void {
    if (profileId) this.attempts.delete(profileId);
    else this.attempts.clear();
  }
}
