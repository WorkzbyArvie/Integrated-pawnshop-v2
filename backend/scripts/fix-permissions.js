/**
 * Fix PostgreSQL schema permissions for Supabase roles.
 * Root cause: anon/authenticated/service_role lost USAGE on public schema,
 * causing ALL Supabase REST API queries to fail with "permission denied for schema public".
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== Fixing PostgreSQL schema permissions ===\n');

  // Step 1: Grant USAGE on public schema to all Supabase roles
  const grants = [
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`,
    `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role`,
  ];

  for (const sql of grants) {
    try {
      await p.$executeRawUnsafe(sql);
      console.log('OK:', sql.substring(0, 80));
    } catch (err) {
      console.error('ERR:', sql.substring(0, 80), '-', err.message);
    }
  }

  // Step 2: Standardize role names — everything should be UPPER_SNAKE_CASE
  console.log('\n=== Standardizing role names ===\n');

  const roleUpdates = [
    [`UPDATE profiles SET role = 'BRANCH_ADMIN' WHERE role = 'Branch_Admin'`, 'Branch_Admin → BRANCH_ADMIN'],
    [`UPDATE profiles SET role = 'BRANCH_ADMIN' WHERE role = 'branch_admin'`, 'branch_admin → BRANCH_ADMIN'],
    [`UPDATE profiles SET role = 'SUPER_ADMIN' WHERE role = 'Super_Admin'`, 'Super_Admin → SUPER_ADMIN'],
    [`UPDATE profiles SET role = 'STAFF' WHERE role = 'Staff'`, 'Staff → STAFF'],
    [`UPDATE profiles SET role = 'MANAGER' WHERE role = 'Manager'`, 'Manager → MANAGER'],
    [`UPDATE profiles SET role = 'BIDDER' WHERE role = 'Bidder'`, 'Bidder → BIDDER'],
  ];

  for (const [sql, label] of roleUpdates) {
    try {
      const result = await p.$executeRawUnsafe(sql);
      console.log(`OK: ${label} (${result} rows)`);
    } catch (err) {
      console.error(`ERR: ${label} -`, err.message);
    }
  }

  // Step 3: Verify final state
  console.log('\n=== Final profile state ===\n');
  const profiles = await p.profile.findMany({
    select: { email: true, role: true, pawnshopId: true, fullName: true },
    orderBy: { createdAt: 'asc' }
  });

  for (const pr of profiles) {
    const status = pr.role === 'SUPER_ADMIN' 
      ? (pr.pawnshopId === null ? 'OK' : 'WARN: super admin has pawnshop_id') 
      : pr.role === 'BIDDER'
        ? (pr.pawnshopId === null ? 'OK' : 'WARN: bidder has pawnshop_id')
        : (pr.pawnshopId ? 'OK' : 'WARN: missing pawnshop_id');
    console.log(`  ${pr.email} | ${pr.role} | pawnshop=${pr.pawnshopId || 'null'} | ${status}`);
  }

  console.log('\n=== Done ===');
}

main()
  .catch(err => console.error('FATAL:', err))
  .finally(() => p.$disconnect());
