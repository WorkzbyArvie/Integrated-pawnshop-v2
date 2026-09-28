import {
  assertValidEnv,
  collectEnvProblems,
  extractSupabaseProjectRef,
} from './env.validation';

const REF = 'bxayczllpdhrvutubzbg';
const OTHER_REF = 'aaaaaaaaaaaaaaaaaaaa';
const POOLER = `postgresql://postgres.${REF}:pw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;

const VALID: Record<string, string> = {
  DATABASE_URL: POOLER,
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  MFA_CODE_HMAC_PEPPER: 'a'.repeat(48),
};

function problems(env: Record<string, string | undefined>) {
  return collectEnvProblems(env).map((problem) => `${problem.variable} ${problem.problem}`);
}

describe('extractSupabaseProjectRef', () => {
  it('reads the ref from a hosted project URL', () => {
    expect(extractSupabaseProjectRef(`https://${REF}.supabase.co`)).toBe(REF);
  });

  it('reads the ref from a pooler connection string', () => {
    expect(extractSupabaseProjectRef(POOLER)).toBe(REF);
  });

  it('reads the ref from a direct connection string', () => {
    expect(
      extractSupabaseProjectRef(`postgresql://postgres.${REF}:pw@db.${REF}.supabase.co:5432/postgres`),
    ).toBe(REF);
  });

  it('returns null for a host that is not Supabase', () => {
    expect(extractSupabaseProjectRef('https://example.com')).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(extractSupabaseProjectRef(undefined)).toBeNull();
    expect(extractSupabaseProjectRef('')).toBeNull();
  });
});

describe('collectEnvProblems', () => {
  it('accepts a complete, internally consistent configuration', () => {
    expect(collectEnvProblems(VALID)).toEqual([]);
  });

  it('requires the database, Supabase, and MFA values', () => {
    const found = problems({});
    expect(found).toContain('DATABASE_URL is required but missing or empty');
    expect(found).toContain('SUPABASE_URL is required but missing or empty');
    expect(found).toContain('SUPABASE_SERVICE_ROLE_KEY is required but missing or empty');
    expect(found).toContain('MFA_CODE_HMAC_PEPPER is required and must be at least 32 characters');
  });

  it('rejects an MFA pepper under 32 characters and reports the length', () => {
    const found = problems({ ...VALID, MFA_CODE_HMAC_PEPPER: 'short' });
    expect(found.join('\n')).toContain('is too short (5 characters, minimum 32)');
  });

  it('rejects a SUPABASE_URL that is not a Supabase host at all', () => {
    const found = problems({ ...VALID, SUPABASE_URL: 'https://example.com' });
    expect(found.join('\n')).toContain('is not a recognisable Supabase connection value');
  });

  it('rejects a project ref that is not the expected length', () => {
    const found = problems({ ...VALID, SUPABASE_URL: 'https://shortref.supabase.co' });
    expect(found.join('\n')).toContain('is not a 20-character Supabase ref');
  });

  it('detects two different project refs across variables', () => {
    const found = problems({
      ...VALID,
      VITE_SUPABASE_URL: `https://${OTHER_REF}.supabase.co`,
    });
    expect(found.join('\n')).toContain('references more than one Supabase project');
    expect(found.join('\n')).toContain(`SUPABASE_URL -> "${REF}"`);
    expect(found.join('\n')).toContain(`VITE_SUPABASE_URL -> "${OTHER_REF}"`);
  });

  it('accepts the same project ref across several variables', () => {
    const found = problems({
      ...VALID,
      DIRECT_URL: `postgresql://postgres.${REF}:pw@db.${REF}.supabase.co:5432/postgres`,
      VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
    });
    expect(found).toEqual([]);
  });

  it('rejects a ref that disagrees with the configured expectation', () => {
    const found = problems({ ...VALID, EXPECTED_SUPABASE_PROJECT_REF: OTHER_REF });
    expect(found.join('\n')).toContain('but this deployment expects');
    expect(found.join('\n')).toContain(`"${REF}"`);
    expect(found.join('\n')).toContain(`"${OTHER_REF}"`);
  });

  it('accepts a ref that matches the configured expectation', () => {
    expect(problems({ ...VALID, EXPECTED_SUPABASE_PROJECT_REF: REF })).toEqual([]);
  });

  it('flags every variable that references the wrong project', () => {
    const found = problems({
      ...VALID,
      EXPECTED_SUPABASE_PROJECT_REF: OTHER_REF,
      VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
    });
    const mismatched = found.filter((line) => line.includes('but this deployment expects'));
    // SUPABASE_URL, DATABASE_URL, and VITE_SUPABASE_URL all carry the ref.
    expect(mismatched).toHaveLength(3);
  });
});

describe('assertValidEnv', () => {
  it('does not throw for a valid environment', () => {
    expect(() => assertValidEnv(VALID)).not.toThrow();
  });

  it('throws once with every problem listed', () => {
    let thrown: Error | null = null;
    try {
      assertValidEnv({ ...VALID, MFA_CODE_HMAC_PEPPER: 'short' });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('Invalid environment configuration');
    expect(thrown!.message).toContain('minimum 32');
    expect(thrown!.message).toContain('Project Settings > API');
  });
});
