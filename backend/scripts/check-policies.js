const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const policies = await p.$queryRawUnsafe(
    `SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'profiles' ORDER BY policyname`
  );
  console.log('=== RLS Policies on profiles table ===\n');
  for (const pol of policies) {
    console.log(`Policy: ${pol.policyname}`);
    console.log(`  CMD: ${pol.cmd}`);
    console.log(`  QUAL: ${pol.qual}`);
    const isRecursive = pol.qual && pol.qual.includes('profiles') && pol.qual.includes('auth.uid');
    if (isRecursive) {
      console.log('  ⚠️  RECURSIVE: references profiles in its own policy!');
    } else {
      console.log('  ✅ Safe');
    }
    console.log('');
  }
}

main().catch(e => console.error(e)).finally(() => process.exit(0));
