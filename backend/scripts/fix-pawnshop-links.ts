import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 [FixPawnshopLinks] Checking current database state...');

  // 1. Check how many pawnshops exist
  const pawnshops = await prisma.pawnshop.findMany({ select: { id: true, name: true } });
  console.log(`📊 Found ${pawnshops.length} pawnshops:`, pawnshops);

  // 2. Check how many customers exist
  const allCustomers = await prisma.customer.findMany({ select: { id: true, fullName: true, pawnshopId: true } });
  console.log(`👥 Found ${allCustomers.length} customers:`, allCustomers);

  // 3. Check how many tickets exist
  const allTickets = await prisma.ticket.findMany({ select: { id: true, ticketNumber: true, pawnshopId: true, branchId: true } });
  console.log(`🎫 Found ${allTickets.length} tickets:`, allTickets);

  // 4. If we have pawnshops but tickets don't have pawnshop_id, assign them
  if (pawnshops.length > 0 && allTickets.some(t => !t.pawnshopId)) {
    console.log('⚠️  [FixPawnshopLinks] Detected tickets without pawnshop_id. Assigning...');
    
    // Use the first pawnshop as default (or you can update the logic)
    const defaultPawnshop = pawnshops[0];
    console.log(`✏️  [FixPawnshopLinks] Using default pawnshop: ${defaultPawnshop.name} (${defaultPawnshop.id})`);

    const updatedCount = await prisma.ticket.updateMany({
      where: { pawnshopId: null },
      data: { pawnshopId: defaultPawnshop.id }
    });

    console.log(`✅ [FixPawnshopLinks] Updated ${updatedCount.count} tickets with pawnshop_id`);
  }

  // 5. Similarly for customers
  if (pawnshops.length > 0 && allCustomers.some(c => !c.pawnshopId)) {
    console.log('⚠️  [FixPawnshopLinks] Detected customers without pawnshop_id. Assigning...');
    
    const defaultPawnshop = pawnshops[0];
    console.log(`✏️  [FixPawnshopLinks] Using default pawnshop: ${defaultPawnshop.name} (${defaultPawnshop.id})`);

    const updatedCount = await prisma.customer.updateMany({
      where: { pawnshopId: null },
      data: { pawnshopId: defaultPawnshop.id }
    });

    console.log(`✅ [FixPawnshopLinks] Updated ${updatedCount.count} customers with pawnshop_id`);
  }

  // 6. Final verification
  console.log('✅ [FixPawnshopLinks] Final verification:');
  const finalTickets = await prisma.ticket.findMany({ where: { pawnshopId: { not: null } } });
  const finalCustomers = await prisma.customer.findMany({ where: { pawnshopId: { not: null } } });
  console.log(`📊 Tickets with pawnshop_id: ${finalTickets.length}`);
  console.log(`👥 Customers with pawnshop_id: ${finalCustomers.length}`);

  console.log('🚀 Script complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
