const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // List all policies on the profiles table
  const policies = await p.$queryRawUnsafe(
    `SELECT polname, polcmd, pg_get_expr(polqual, polrelid) as qual
     FROM pg_policy 
     JOIN pg_class ON pg_policy.polrelid = pg_class.oid 
     WHERE relname = 'profiles'`
  );
  console.log('=== Policies on profiles ===');
  for (const pol of policies) {
    console.log(`  ${pol.polname} | cmd=${pol.polcmd} | qual=${(pol.qual || '').substring(0, 150)}`);
  }

  // Also check if there are duplicate/conflicting policies on other tables
  const allPolicies = await p.$queryRawUnsafe(
    `SELECT c.relname as tablename, p.polname
     FROM pg_policy p
     JOIN pg_class c ON p.polrelid = c.oid
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = 'public'
     ORDER BY c.relname, p.polname`
  );
  console.log('\n=== All public schema policies ===');
  let lastTable = '';
  for (const pol of allPolicies) {
    if (pol.tablename !== lastTable) {
      console.log(`\n  [${pol.tablename}]`);
      lastTable = pol.tablename;
    }
    console.log(`    - ${pol.polname}`);
  }
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
