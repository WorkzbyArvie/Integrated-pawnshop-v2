import { PrismaClient } from '@prisma/client';

const EMAIL = 'testbidder@pawngold.com';

async function main() {
  const prisma = new PrismaClient();

  try {
    const updated = await prisma.$executeRaw`
      UPDATE auth.users
      SET
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        updated_at = NOW()
      WHERE lower(email) = lower(${EMAIL})
    `;

    const rows = await prisma.$queryRaw<Array<{
      email: string;
      email_confirmed_at: Date | null;
      confirmed_at: Date | null;
    }>>`
      SELECT email, email_confirmed_at, confirmed_at
      FROM auth.users
      WHERE lower(email) = lower(${EMAIL})
      LIMIT 1
    `;

    if (!rows.length) {
      console.error(`❌ Auth user not found for ${EMAIL}`);
      process.exit(1);
    }

    const row = rows[0];
    console.log(`✅ Verification updated rows: ${updated}`);
    console.log(`   Email: ${row.email}`);
    console.log(`   email_confirmed_at: ${row.email_confirmed_at?.toISOString() || 'NULL'}`);
    console.log(`   confirmed_at: ${row.confirmed_at?.toISOString() || 'NULL'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Verification script failed:', error?.message || error);
  process.exit(1);
});
