import * as fs from 'fs';
import * as path from 'path';

const prismaRoot = path.resolve(__dirname, '../../prisma');
const migrationsRoot = path.join(prismaRoot, 'migrations');
const schemaSource = fs.readFileSync(
  path.join(prismaRoot, 'schema.prisma'),
  'utf8',
);

function migrationFiles(suffix: string): string[] {
  if (!fs.existsSync(migrationsRoot)) return [];

  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.endsWith(`_${suffix}`),
    )
    .map((entry) => path.join(migrationsRoot, entry.name, 'migration.sql'))
    .filter((file) => fs.existsSync(file));
}

function migrationSource(suffix: string): string {
  const files = migrationFiles(suffix);
  return files.length === 1 ? fs.readFileSync(files[0], 'utf8') : '';
}

function modelSource(model: string): string {
  const match = schemaSource.match(
    new RegExp(`model ${model} \\{[\\s\\S]*?^\\}`, 'm'),
  );
  return match?.[0] ?? '';
}

const credentialStateMigration = migrationSource('add_credential_state');
const mfaMigrations = migrationSource('add_mfa_challenges');

describe('credential security schema contract', () => {
  it('defines the three profile-scoped credential security models', () => {
    expect(modelSource('CredentialState')).toContain(
      'model CredentialState {',
    );
    expect(modelSource('MfaEmailChallenge')).toContain(
      'model MfaEmailChallenge {',
    );
    expect(modelSource('MfaSessionAssertion')).toContain(
      'model MfaSessionAssertion {',
    );
    expect(modelSource('Profile')).toMatch(/credentialState\s+CredentialState\?/);
    expect(modelSource('Profile')).toMatch(
      /mfaEmailChallenges\s+MfaEmailChallenge\[\]/,
    );
    expect(modelSource('Profile')).toMatch(
      /mfaSessionAssertions\s+MfaSessionAssertion\[\]/,
    );
  });

  it('maps credential fields to the locked snake_case database contract', () => {
    const credentialState = modelSource('CredentialState');
    const challenge = modelSource('MfaEmailChallenge');
    const assertion = modelSource('MfaSessionAssertion');
    const securityLog = modelSource('SecurityLog');

    expect(credentialState).toMatch(
      /profileId\s+String\s+@unique\s+@map\("profile_id"\)\s+@db\.Uuid/,
    );
    expect(credentialState).toMatch(
      /mustChangePassword\s+Boolean\s+@default\(false\)\s+@map\("must_change_password"\)/,
    );
    expect(credentialState).toContain('@map("mfa_enabled")');
    expect(credentialState).toContain('@map("marked_at")');
    expect(credentialState).toContain('@map("resolved_at")');
    expect(credentialState).toContain('@@map("credential_states")');

    expect(challenge).toMatch(
      /profileId\s+String\s+@map\("profile_id"\)\s+@db\.Uuid/,
    );
    expect(challenge).toMatch(
      /maxAttempts\s+Int\s+@default\(5\)\s+@map\("max_attempts"\)/,
    );
    expect(challenge).toContain('@map("code_hash")');
    expect(challenge).toContain('@@index([profileId, purpose])');
    expect(challenge).toContain('@@index([expiresAt])');
    expect(challenge).toContain('@@map("mfa_email_challenges")');

    expect(assertion).toMatch(
      /profileId\s+String\s+@map\("profile_id"\)\s+@db\.Uuid/,
    );
    expect(assertion).toMatch(
      /sessionId\s+String\s+@map\("session_id"\)/,
    );
    expect(assertion).toContain('@map("token_hash")');
    expect(assertion).toContain('@@index([profileId, sessionId])');
    expect(assertion).toContain('@@index([expiresAt])');
    expect(assertion).toContain('@@map("mfa_session_assertions")');

    expect(securityLog).toMatch(
      /actorProfileId\s+String\?\s+@map\("actor_profile_id"\)\s+@db\.Uuid/,
    );
    expect(securityLog).toMatch(
      /targetProfileId\s+String\?\s+@map\("target_profile_id"\)\s+@db\.Uuid/,
    );
    expect(securityLog).toMatch(
      /pawnshopId\s+String\?\s+@map\("pawnshop_id"\)\s+@db\.Uuid/,
    );
    expect(securityLog).toMatch(/metadata\s+Json\?\s+@db\.Json/);
    expect(securityLog).toContain('@@index([pawnshopId, createdAt])');
    expect(securityLog).toContain('@@index([actorProfileId, createdAt])');
  });

  it('creates the idempotent credential-state backfill without retiring password_hash', () => {
    expect(credentialStateMigration).not.toBe('');
    expect(credentialStateMigration).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."credential_states"',
    );
    expect(credentialStateMigration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "credential_states_profile_id_key"',
    );
    expect(credentialStateMigration).toContain(
      'CREATE INDEX IF NOT EXISTS "credential_states_must_change_password_idx"',
    );
    expect(credentialStateMigration).toContain(
      'ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "actor_profile_id" UUID',
    );
    expect(credentialStateMigration).toContain(
      'ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "target_profile_id" UUID',
    );
    expect(credentialStateMigration).toContain(
      'ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "pawnshop_id" UUID',
    );
    expect(credentialStateMigration).toContain(
      'ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "metadata" JSONB',
    );
    expect(credentialStateMigration).toContain(
      'INSERT INTO "public"."credential_states"',
    );
    expect(credentialStateMigration).toContain("'PRE_ROLLOUT_LEGACY'");
    expect(credentialStateMigration).toMatch(/WHERE NOT EXISTS\s*\(/);
    expect(credentialStateMigration).toContain(
      'ON DELETE CASCADE ON UPDATE CASCADE',
    );
    expect(credentialStateMigration).not.toMatch(
      /SET\s+"password_hash"\s*=\s*NULL/i,
    );
    expect(credentialStateMigration).not.toMatch(
      /DROP\s+COLUMN\s+(?:IF EXISTS\s+)?"password_hash"/i,
    );
  });

  it('makes credential and audit tables browser-revoked with RLS enabled', () => {
    expect(credentialStateMigration).toContain(
      'ALTER TABLE "public"."credential_states" ENABLE ROW LEVEL SECURITY;',
    );
    expect(credentialStateMigration).toContain(
      'ALTER TABLE "public"."security_logs" ENABLE ROW LEVEL SECURITY;',
    );
    expect(credentialStateMigration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "public"."credential_states" FROM anon, authenticated;',
    );
    expect(credentialStateMigration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "public"."security_logs" FROM anon, authenticated;',
    );
  });

  it('creates private persistent MFA challenge and assertion storage', () => {
    expect(mfaMigrations).not.toBe('');
    expect(mfaMigrations).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."mfa_email_challenges"',
    );
    expect(mfaMigrations).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."mfa_session_assertions"',
    );
    expect(mfaMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS "mfa_email_challenges_profile_id_purpose_idx"',
    );
    expect(mfaMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS "mfa_email_challenges_expires_at_idx"',
    );
    expect(mfaMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS "mfa_session_assertions_profile_id_session_id_idx"',
    );
    expect(mfaMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS "mfa_session_assertions_expires_at_idx"',
    );
    expect(mfaMigrations).toMatch(
      /mfa_email_challenges_profile_id_fkey[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(mfaMigrations).toMatch(
      /mfa_session_assertions_profile_id_fkey[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/,
    );
  });

  it('revokes browser access from every MFA secret-bearing table', () => {
    expect(mfaMigrations).toContain(
      'ALTER TABLE "public"."mfa_email_challenges" ENABLE ROW LEVEL SECURITY;',
    );
    expect(mfaMigrations).toContain(
      'ALTER TABLE "public"."mfa_session_assertions" ENABLE ROW LEVEL SECURITY;',
    );
    expect(mfaMigrations).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "public"."mfa_email_challenges" FROM anon, authenticated;',
    );
    expect(mfaMigrations).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "public"."mfa_session_assertions" FROM anon, authenticated;',
    );
    expect(mfaMigrations).not.toMatch(
      /GRANT[\s\S]*(?:anon|authenticated)[\s\S]*(?:mfa_email_challenges|mfa_session_assertions)/i,
    );
  });

  it('retains the Prisma legacy password field for plan 10.1-17', () => {
    expect(modelSource('Profile')).toMatch(
      /passwordHash\s+String\?\s+@map\("password_hash"\)/,
    );
  });
});
