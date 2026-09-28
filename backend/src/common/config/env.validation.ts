export interface EnvLike {
  [key: string]: string | undefined;
}

export interface EnvProblem {
  variable: string;
  problem: string;
}

const SUPABASE_PROJECT_PATTERN = /^[a-z0-9]{20}$/;

const HOSTED_URL = /^https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)\b/i;
const POOLER_URL = /^[a-z0-9+]+:\/\/(?:postgres\.)?([a-z0-9]{20})(?::[^@]*)?@/i;

/**
 * Reads the Supabase project reference from either shape of connection value: a
 * hosted project URL (`https://<ref>.supabase.co`) or a pooler/direct
 * connection string, where the reference lives in the username
 * (`postgres.<ref>`) rather than the host.
 *
 * A single wrong character in the reference yields a well-formed value pointing
 * at a project that does not exist, so a pattern check alone cannot catch it.
 * That is why {@link collectEnvProblems} also compares references across
 * variables and honours an explicitly configured expected reference.
 */
export function extractSupabaseProjectRef(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  const hosted = trimmed.match(HOSTED_URL);
  if (hosted) return hosted[1].toLowerCase();

  const pooler = trimmed.match(POOLER_URL);
  if (pooler) return pooler[1].toLowerCase();

  return null;
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates the configuration the API cannot boot without.
 *
 * Historically a missing or malformed value surfaced as an unrelated failure
 * later: a blank MFA pepper threw from a service constructor, and a mistyped
 * Supabase project reference only appeared as DNS failures in the browser. Both
 * cost a full debugging session. This collects every problem up front so a
 * misconfigured deploy fails immediately and says exactly what is wrong.
 */
export function collectEnvProblems(env: EnvLike): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const refsByVariable = new Map<string, string>();

  const requireValue = (variable: string, hint?: string) => {
    if (!isNonEmpty(env[variable])) {
      problems.push({
        variable,
        problem: hint ?? 'is required but missing or empty',
      });
    }
  };

  requireValue('DATABASE_URL');
  requireValue('SUPABASE_URL');
  requireValue('SUPABASE_SERVICE_ROLE_KEY');

  const pepper = env.MFA_CODE_HMAC_PEPPER;
  if (!isNonEmpty(pepper)) {
    problems.push({
      variable: 'MFA_CODE_HMAC_PEPPER',
      problem: 'is required and must be at least 32 characters',
    });
  } else if (pepper!.trim().length < 32) {
    problems.push({
      variable: 'MFA_CODE_HMAC_PEPPER',
      problem: `is too short (${pepper!.trim().length} characters, minimum 32)`,
    });
  }

  const refVariables = [
    'SUPABASE_URL',
    'DIRECT_URL',
    'DATABASE_URL',
    'VITE_SUPABASE_URL',
  ];

  for (const variable of refVariables) {
    const value = env[variable];
    if (!isNonEmpty(value)) continue;
    const ref = extractSupabaseProjectRef(value);
    if (!ref) {
      problems.push({
        variable,
        problem: `is not a recognisable Supabase connection value (got "${value!.trim()}")`,
      });
      continue;
    }
    if (!SUPABASE_PROJECT_PATTERN.test(ref)) {
      problems.push({
        variable,
        problem: `contains a project ref that is not a 20-character Supabase ref (got "${ref}")`,
      });
      continue;
    }
    refsByVariable.set(variable, ref);
  }

  const distinctRefs = new Set(refsByVariable.values());
  if (distinctRefs.size > 1) {
    const detail = [...refsByVariable.entries()]
      .map(([variable, ref]) => `${variable} -> "${ref}"`)
      .join('; ');
    problems.push({
      variable: 'SUPABASE_URL',
      problem: `references more than one Supabase project, so credentials and data would come from different places: ${detail}`,
    });
  }

  const expected = env.EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (isNonEmpty(expected)) {
    for (const [variable, ref] of refsByVariable.entries()) {
      if (ref !== expected) {
        problems.push({
          variable,
          problem: `references project "${ref}" but this deployment expects "${expected}". Copy the ref from Supabase > Project Settings > API.`,
        });
      }
    }
  }

  return problems;
}

export function assertValidEnv(env: EnvLike = process.env): void {
  const problems = collectEnvProblems(env);
  if (problems.length === 0) return;

  const details = problems
    .map((problem) => `  - ${problem.variable} ${problem.problem}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${details}\n\n` +
      'Set these in the deployment platform. Copy every project ref from ' +
      'Supabase > Project Settings > API rather than retyping it: one wrong ' +
      'character produces a project that does not resolve, and the failure ' +
      'surfaces far from its cause.',
  );
}
