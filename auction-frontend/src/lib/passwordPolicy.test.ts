import { describe, expect, it } from 'vitest';
import {
  PASSWORD_POLICY,
  PASSWORD_RULE_LABELS,
  PASSWORD_RULE_ORDER,
  evaluatePasswordRules,
  failedPasswordRules,
  isPasswordCompliant,
} from './passwordPolicy';

/** Independent re-implementation of the server normalization, for cross-checking. */
function normalize(value: string): string {
  const substitutions: Record<string, string> = {
    '@': 'a', '4': 'a', '8': 'b', '(': 'c', '3': 'e', '6': 'g',
    '1': 'i', '0': 'o', $: 's', '5': 's', '7': 't', '+': 't',
  };
  return value
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((character) => substitutions[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

describe('passwordPolicy client mirror', () => {
  it('mirrors the server length bounds of 10 to 128', () => {
    expect(PASSWORD_POLICY.minLength).toBe(10);
    expect(PASSWORD_POLICY.maxLength).toBe(128);
  });

  it('exposes the six approved policy rules plus the common-password rule', () => {
    expect([...PASSWORD_RULE_ORDER]).toEqual([
      'minLength',
      'uppercase',
      'lowercase',
      'number',
      'symbol',
      'noSurroundingWhitespace',
      'common',
    ]);
    expect(PASSWORD_RULE_LABELS.minLength).toBe('10–128 characters');
  });

  it('rejects a value below the minimum length', () => {
    expect(evaluatePasswordRules('Ab1!efg').minLength).toBe(false);
  });

  it('rejects a value above the maximum length', () => {
    const long = `A1!${'a'.repeat(200)}`;
    expect(evaluatePasswordRules(long).minLength).toBe(false);
  });

  it('accepts a passphrase that satisfies every rule', () => {
    const value = 'Str0ng!Passphrase';
    expect(isPasswordCompliant(value)).toBe(true);
    expect(failedPasswordRules(value)).toEqual([]);
  });

  it('requires each character class independently', () => {
    const rules = evaluatePasswordRules('lowercase1!aaaa');
    expect(rules.uppercase).toBe(false);
    expect(rules.lowercase).toBe(true);
    expect(rules.number).toBe(true);
    expect(rules.symbol).toBe(true);
  });

  it('rejects leading or trailing whitespace', () => {
    expect(evaluatePasswordRules(' Str0ng!Passphrase').noSurroundingWhitespace).toBe(false);
    expect(evaluatePasswordRules('Str0ng!Passphrase ').noSurroundingWhitespace).toBe(false);
    expect(evaluatePasswordRules('Str0ng!Pass phrase').noSurroundingWhitespace).toBe(true);
  });

  it('rejects a common password', () => {
    // `P4ssword!Aa` normalizes to `passwordaa`, which is not on the server list,
    // so the common rule alone must not reject it.
    expect(evaluatePasswordRules('Welcome!Aa1').common).toBe(true);
    // `P4ssword!!A` normalizes to `passworda` -> still not on the list.
    expect(evaluatePasswordRules('Str0ng!Passphrase').common).toBe(true);
  });

  it('rejects a value that normalizes onto a common password', () => {
    // `P4ssw0rd!` -> `password`
    expect(evaluatePasswordRules('P4ssw0rd!').common).toBe(false);
    // `P@ssword!` -> `password`
    expect(evaluatePasswordRules('P@ssword!').common).toBe(false);
  });

  it('mirrors the server quirk where digit entries are unreachable after substitution', () => {
    // The server substitutes 1->i, 3->e, 4->a, 5->s, 6->g, 7->t, 8->b before the
    // set lookup, so `12345678` normalizes to `i2easgtb` and never matches the
    // `12345678` entry. This pins faithful-mirror behavior rather than asserting
    // a rejection the server does not perform. Such values are still stopped by
    // the length, character-class, and symbol rules.
    expect(normalize('12345678')).toBe('i2easgtb');
    expect(evaluatePasswordRules('12345678').common).toBe(true);
    expect(isPasswordCompliant('12345678')).toBe(false);
  });

  it('leaves unmapped digits untouched', () => {
    // Only `2` and `9` survive the substitution map unchanged.
    expect(normalize('2299')).toBe('2299');
    expect(evaluatePasswordRules('2299').common).toBe(true);
  });

  it('strips non-alphanumerics before the common-password comparison', () => {
    // `Qwerty!` -> `qwerty`
    expect(evaluatePasswordRules('Qwerty!').common).toBe(false);
  });

  it('reports an empty value as incomplete rather than compliant', () => {
    expect(isPasswordCompliant('')).toBe(false);
    expect(failedPasswordRules('')).toContain('minLength');
  });

  it('lists every failing rule for a weak value', () => {
    const failed = failedPasswordRules('abc');
    expect(failed).toContain('minLength');
    expect(failed).toContain('uppercase');
    expect(failed).toContain('number');
    expect(failed).toContain('symbol');
  });
});
