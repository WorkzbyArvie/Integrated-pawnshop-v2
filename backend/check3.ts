import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const req = await prisma.$queryRawUnsafe(`
    SELECT id, pawnshop_name, owner_email, status
    FROM client_registration_requests
    WHERE id = '1f9a0915-847d-49a9-9d0d-3ebae45e9cbb'::uuid
  `);
  console.log('=== REQUEST ===');
  console.log(JSON.stringify(req, null, 2));

  const existingPawnshop = await prisma.$queryRawUnsafe(`
    SELECT id, name, owner_email, status FROM pawnshops WHERE name ILIKE '%test%'
  `);
  console.log('\n=== EXISTING PAWNSHOPS WITH test ===');
  console.log(JSON.stringify(existingPawnshop, null, 2));

  const invites = await prisma.$queryRawUnsafe(`
    SELECT id, email, pawnshop_id, role FROM admin_invites
    WHERE email = (SELECT lower(owner_email) FROM client_registration_requests WHERE id = '1f9a0915-847d-49a9-9d0d-3ebae45e9cbb'::uuid)
  `);
  console.log('\n=== EXISTING INVITES ===');
  console.log(JSON.stringify(invites, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
