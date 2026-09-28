import { describe, expect, it } from 'vitest';
import { assertValidViteEnv, validateViteEnv } from '../../env-guard.js';

const REF = 'bxayczllpdhrvutubzbg';

const VALID = {
  VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: 'anon-key',
};

describe('validateViteEnv', () => {
  it('accepts a complete, well-formed environment', () => {
    expect(validateViteEnv(VALID)).toEqual([]);
  });

  it('rejects a missing Supabase URL', () => {
    expect(validateViteEnv({ VITE_SUPABASE_ANON_KEY: 'k' })).toEqual([
      'VITE_SUPABASE_URL is required but missing or empty',
    ]);
  });

  it('rejects an empty Supabase URL', () => {
    expect(validateViteEnv({ ...VALID, VITE_SUPABASE_URL: '   ' })).toEqual([
      'VITE_SUPABASE_URL is required but missing or empty',
    ]);
  });

  it('rejects a URL that is not a Supabase project host', () => {
    expect(
      validateViteEnv({ ...VALID, VITE_SUPABASE_URL: 'https://example.com' })[0],
    ).toContain('is not a valid Supabase project URL');
  });

  it('rejects a project ref of the wrong length', () => {
    expect(
      validateViteEnv({ ...VALID, VITE_SUPABASE_URL: 'https://short.supabase.co' })[0],
    ).toContain('is not a 20-character Supabase ref');
  });

  it('requires the anon key', () => {
    const problems = validateViteEnv({ VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL });
    expect(problems).toContain('VITE_SUPABASE_ANON_KEY is required but missing or empty');
  });

  it('rejects a plaintext remote backend URL', () => {
    const problems = validateViteEnv({
      ...VALID,
      VITE_BACKEND_URL: 'http://integrated-pawnshop-v2.onrender.com',
    });
    expect(problems.join('\n')).toContain('must use https');
  });

  it('allows a plaintext loopback backend for local development', () => {
    expect(
      validateViteEnv({ ...VALID, VITE_BACKEND_URL: 'http://localhost:3000' }),
    ).toEqual([]);
    expect(
      validateViteEnv({ ...VALID, VITE_BACKEND_URL: 'http://127.0.0.1:3000' }),
    ).toEqual([]);
  });

  it('accepts an https backend URL', () => {
    expect(
      validateViteEnv({
        ...VALID,
        VITE_BACKEND_URL: 'https://integrated-pawnshop-v2.onrender.com',
      }),
    ).toEqual([]);
  });

  it('stops at the first structural problem so the message is unambiguous', () => {
    expect(validateViteEnv({ VITE_SUPABASE_URL: 'nonsense' })).toEqual([
      'VITE_SUPABASE_URL is not a valid Supabase project URL (got "nonsense")',
    ]);
  });
});

describe('assertValidViteEnv', () => {
  it('does not throw for a valid environment', () => {
    expect(() => assertValidViteEnv(VALID)).not.toThrow();
  });

  it('throws once with every problem listed', () => {
    let thrown: Error | null = null;
    try {
      assertValidViteEnv({ VITE_SUPABASE_URL: 'https://nope' });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('Invalid frontend environment configuration');
    expect(thrown!.message).toContain('VITE_SUPABASE_URL');
  });
});
