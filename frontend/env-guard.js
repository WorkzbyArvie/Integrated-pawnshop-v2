const SUPABASE_PROJECT_PATTERN = /^[a-z0-9]{20}$/;

/**
 * Validates the frontend build environment.
 *
 * A mistyped Supabase project reference is well formed but points at a project
 * that does not exist, so it reaches the browser and surfaces as a DNS failure
 * during sign-in with no visible connection to the cause. Checking here fails
 * the build immediately and names the variable.
 *
 * This file is plain JavaScript because it is loaded by `vite.config.js`
 * directly, without a TypeScript build step.
 */
export function validateViteEnv(env) {
  const problems = [];
  const url = env.VITE_SUPABASE_URL;

  if (typeof url !== 'string' || url.trim() === '') {
    problems.push('VITE_SUPABASE_URL is required but missing or empty');
    return problems;
  }

  const match = url.trim().match(/^https:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)\b/i);
  if (!match) {
    problems.push(`VITE_SUPABASE_URL is not a valid Supabase project URL (got "${url.trim()}")`);
    return problems;
  }

  const ref = match[1].toLowerCase();
  if (!SUPABASE_PROJECT_PATTERN.test(ref)) {
    problems.push(
      `VITE_SUPABASE_URL contains a project ref that is not a 20-character Supabase ref (got "${ref}")`,
    );
  }

  const key = env.VITE_SUPABASE_ANON_KEY;
  if (typeof key !== 'string' || key.trim() === '') {
    problems.push('VITE_SUPABASE_ANON_KEY is required but missing or empty');
  }

  const backend = env.VITE_BACKEND_URL;
  if (typeof backend === 'string' && backend.trim().startsWith('http://')) {
    // A plaintext loopback address is normal for local development; a plaintext
    // remote host is not, because bearer tokens would cross the network in clear.
    const isLoopback = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(backend.trim());
    if (!isLoopback) {
      problems.push(`VITE_BACKEND_URL must use https (got "${backend.trim()}")`);
    }
  }

  return problems;
}

export function assertValidViteEnv(env) {
  const problems = validateViteEnv(env);
  if (problems.length === 0) return;
  throw new Error(
    `Invalid frontend environment configuration:\n${problems
      .map((problem) => `  - ${problem}`)
      .join(
        '\n',
      )}\n\nCopy the project ref and keys from Supabase > Project Settings > API.`,
  );
}
