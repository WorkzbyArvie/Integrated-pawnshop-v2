import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "public"."profiles" ADD COLUMN IF NOT EXISTS "password_hash" TEXT',
  );
  console.log('password_hash column ensured');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());