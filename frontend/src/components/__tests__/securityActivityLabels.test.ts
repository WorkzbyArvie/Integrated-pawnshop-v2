import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EVENT_LABELS,
  ACTIVITY_SEVERITY,
  activitySeverity,
  describeActivityEvent,
  type CredentialActivityEvent,
} from '../../lib/accountSecurity';

/**
 * The frontend label table is keyed on action strings the backend writes, and
 * nothing at runtime checks that the two agree.
 *
 * That is exactly how this broke: the table was written against a naming scheme
 * that was never implemented server-side. Seven of its keys were dead and seven
 * of the nine real actions had no entry, so every row in the security activity
 * list fell through to a generic string. A type checker cannot see it, because
 * the map is typed `Record<string, string>` and happily accepts both real keys
 * and invented ones.
 *
 * The first test parses the backend's own SECURITY_LOG_ACTIONS literal, so the
 * two lists are compared at the source rather than copied by hand.
 */

const BACKEND_SERVICE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'backend',
  'src',
  'security',
  'security.service.ts',
);

const BACKEND_ACTIONS: string[] = (() => {
  const source = readFileSync(BACKEND_SERVICE, 'utf8');
  const block = /export const SECURITY_LOG_ACTIONS = \{([\s\S]*?)\} as const;/.exec(source);
  if (!block) throw new Error(`could not read SECURITY_LOG_ACTIONS from ${BACKEND_SERVICE}`);
  return [...block[1].matchAll(/:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
})();

const event = (action: string, success = true): CredentialActivityEvent => ({
  id: 'e1',
  action,
  success,
  createdAt: '2026-08-24T16:18:53.000Z',
});

describe('security activity labels stay in step with the backend', () => {
  it('reads a non-empty action list from the backend source', () => {
    expect(BACKEND_ACTIONS.length).toBeGreaterThan(0);
  });

  it('labels every action the backend can write', () => {
    const unlabelled = BACKEND_ACTIONS.filter((a) => !ACTIVITY_EVENT_LABELS[a]);
    expect(unlabelled).toEqual([]);
  });

  it('carries no label for an action the backend cannot write', () => {
    // A dead key is how the original table drifted: entries existed for events
    // the server never emitted, so real events had no entry while fake ones did.
    const invented = Object.keys(ACTIVITY_EVENT_LABELS).filter(
      (a) => !BACKEND_ACTIONS.includes(a),
    );
    expect(invented).toEqual([]);
  });

  it('gives every backend action a severity, not a silent default', () => {
    // Asserting "not routine" would reject the genuinely routine events, so the
    // contract is pinned to the real one: every action is classified explicitly.
    // An action missing from the table falls back to routine, which is the bug
    // this file exists to prevent.
    const unclassified = BACKEND_ACTIONS.filter((action) => !ACTIVITY_SEVERITY[action]);
    expect(unclassified).toEqual([]);
  });

  it('names the outcome rather than asserting that something happened', () => {
    for (const action of BACKEND_ACTIONS) {
      expect(describeActivityEvent(event(action))).not.toBe('Account security event');
    }
  });

  it('escalates a lockout and a failed code above a routine sign-in', () => {
    expect(activitySeverity(event('MFA_LOCKED'))).toBe('critical');
    expect(activitySeverity(event('MFA_VERIFICATION_FAILED'))).toBe('critical');
    expect(activitySeverity(event('ADMIN_PASSWORD_RESET'))).toBe('critical');
    expect(activitySeverity(event('MFA_LOGIN_VERIFIED'))).toBe('routine');
    expect(activitySeverity(event('PASSWORD_CHANGED'))).toBe('routine');
  });

  it('does not mark a failed action as routine', () => {
    expect(activitySeverity(event('PASSWORD_CHANGED', false))).not.toBe('routine');
  });

  it('surfaces an unmapped action instead of hiding it', () => {
    // Silence would read as "nothing happened", which for an unknown event in a
    // security log is the one wrong answer to give.
    const described = describeActivityEvent(event('SOMETHING_NEW_FROM_THE_SERVER'));
    expect(described).toMatch(/unrecognised event/i);
    expect(described).toContain('something new from the server');
  });
});
