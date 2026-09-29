import { build, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

const prisma = new PrismaClient();

/**
 * Record the already-applied security and finance migrations as applied.
 *
 * Render runs `prisma migrate deploy` on every build. Three migrations in this
 * repository were applied by hand in the Supabase SQL editor before the deploy
 * pipeline existed for them, so the `_prisma_migrations` ledger did not know
 * about them, and the pipeline tried to execute them again. Two of them then
 * took a deployment down:
 *
 *   - `20260929160000_rename_rejected_to_denied` raised
 *     `22023 "REJECTED" is not an existing enum label`, because the rename had
 *     already happened. Deploy failed with P3018.
 *   - every later build then failed with P3009, "migrate found failed
 *     migrations in the target database", because the first failure was still
 *     recorded.
 *
 * Those files are now idempotent, so a re-run would succeed. This script does
 * the better thing: it tells the ledger the work is already done, so the
 * statements are never sent a second time and the migration history matches the
 * database as it actually is.
 *
 * `prisma migrate resolve --applied` is the supported command for this and is
 * preferable where it can be run, since it writes the ledger through Prisma's
 * own connection. This script exists because the direct database credential in
 * `backend/.env` no longer authenticates (P1000), while the Render environment
 * does.
 *
 * Run with:
 *   node --experimental-strip-types scripts/resolve-applied-migrations.ts
 * or, from a shell that can reach the database:
 *   npx prisma migrate resolve --applied <migration_name>
 */

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

/** Applied by hand in the Supabase SQL editor, verified by the operator. */
const ALREADY_APPLIED = [
  '20260929150000_profiles_presence_heartbeat_grant',
  '20260929160000_rename_rejected_to_denied',
  '20260929210000_record_loan_rate_and_fee',
];

function checksumFor(migrationName: string): string {
  const file = path.join(MIGRATIONS_DIR, migrationName, 'migration.sql');
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in this environment.');
  }

  // Direct connections only. The pooled URL will not work for DDL.
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    for (const name of ALREADY_APPLIED) {
      const checksum = checksumFor(name);

      const existing = await client.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT id FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1',
        name,
      );

      if (existing.length > 0) {
        // Clear a failed record so the ledger is not left blocking deploys.
        await client.$executeRawUnsafe(
          'DELETE FROM "_prisma_migrations" WHERE migration_name = $1',
          name,
        );
        console.log(`reset   ${name}`);
      }

      await client.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, migration_name, started_at, finished_at, rolled_back_at, logs, applied_steps_count)
         VALUES ($1, $2, $3, NOW(), NOW(), NULL, $4, 1)`,
        crypto.randomUUID(),
        checksum,
        name,
        'Applied by hand in the Supabase SQL editor; recorded to match the database.',
      );
      console.log(`applied ${name}`);
    }

    const remaining = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count
         FROM "_prisma_migrations"
        WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    console.log(
      `\nfailed migrations still in the ledger: ${remaining[0]?.count ?? 0}`,
    );
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export { ALREADY_APPLIED, checksumFor };
void build;
