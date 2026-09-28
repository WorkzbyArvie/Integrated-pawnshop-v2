import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MFA_ASSERTION_HEADER,
  authHeaders,
  bindAssertionToSession,
  clearMfaAssertion,
  getMfaAssertion,
  setMfaAssertion,
} from './authHeaders';

describe('authHeaders', () => {
  beforeEach(() => {
    clearMfaAssertion();
  });

  it('builds a public-shaped header set with no token and no assertion', () => {
    const headers = authHeaders(null);
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
    expect(headers[MFA_ASSERTION_HEADER]).toBeUndefined();
  });

  it('attaches the bearer token and omits the assertion when none is held', () => {
    const headers = authHeaders('token-123');
    expect(headers.Authorization).toBe('Bearer token-123');
    expect(headers[MFA_ASSERTION_HEADER]).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('adds the content type only for a json body', () => {
    expect(authHeaders('token-123', { json: true })['Content-Type']).toBe('application/json');
  });

  it('attaches a held assertion to a protected request', () => {
    setMfaAssertion('assertion-abc', { userId: 'user-1' });
    const headers = authHeaders('token-123', { userId: 'user-1' });
    expect(headers[MFA_ASSERTION_HEADER]).toBe('assertion-abc');
  });

  it('drops the assertion when the authenticated subject changes', () => {
    setMfaAssertion('assertion-abc', { userId: 'user-1' });
    const headers = authHeaders('token-123', { userId: 'user-2' });
    expect(headers[MFA_ASSERTION_HEADER]).toBeUndefined();
    expect(getMfaAssertion()).toBeNull();
  });

  it('drops the assertion on sign-out, leaving nothing to replay', () => {
    setMfaAssertion('assertion-abc', { userId: 'user-1' });
    bindAssertionToSession(null, false);
    expect(getMfaAssertion()).toBeNull();
    expect(authHeaders('token-123')[MFA_ASSERTION_HEADER]).toBeUndefined();
  });

  it('treats a blank assertion as a clear rather than storing an empty value', () => {
    setMfaAssertion('assertion-abc', { userId: 'user-1' });
    setMfaAssertion('   ');
    expect(getMfaAssertion()).toBeNull();
  });

  it('never persists the assertion to web storage (D-02)', () => {
    // Asserted at the source level so the guarantee is deterministic and does not
    // depend on the test environment providing a Storage implementation. An
    // in-memory holder that mentions no storage API cannot leak the assertion.
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/authHeaders.ts'),
      'utf8',
    );
    // Strip comments so the prose that *describes* the rule does not itself
    // trip the scan.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/sessionStorage/);
    expect(code).not.toMatch(/document\.cookie/);
    expect(code).not.toMatch(/indexedDB/);

    // The held value is still retrievable in-process, so the test is not
    // vacuously passing against a stub.
    setMfaAssertion('assertion-abc', { userId: 'user-1' });
    expect(getMfaAssertion()).toBe('assertion-abc');
  });

  it('discards an expired assertion on read', () => {
    setMfaAssertion('assertion-abc', {
      userId: 'user-1',
      expiresAt: Date.now() - 1_000,
    });
    expect(getMfaAssertion()).toBeNull();
  });

  it('keeps a still-valid assertion across reads', () => {
    setMfaAssertion('assertion-abc', {
      userId: 'user-1',
      expiresAt: Date.now() + 60_000,
    });
    expect(getMfaAssertion()).toBe('assertion-abc');
  });
});
