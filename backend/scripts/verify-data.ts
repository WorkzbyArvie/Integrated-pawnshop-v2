import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 [VerifyData] Checking jaro pawnshop data...');

  const pawnshopId = '7e1a7edd-1fb8-4cde-9b3b-df6c46d9fa15';

  // Get pawnshop
  const pawnshop = await prisma.pawnshop.findUnique({
    where: { id: pawnshopId },
    select: { id: true, name: true }
  });
  console.log('🏢 Pawnshop:', pawnshop);

  // Get tickets
  const tickets = await prisma.ticket.findMany({
    where: { pawnshopId },
    select: { id: true, ticketNumber: true, loanAmount: true, interestRate: true, status: true, category: true }
  });
  console.log('🎫 Tickets:', tickets);
  console.log(`   Total tickets: ${tickets.length}`);
  console.log(`   Active tickets: ${tickets.filter(t => (t.status || '').toUpperCase() === 'ACTIVE').length}`);
  
  // Calculate totals
  const activeTickets = tickets.filter(t => (t.status || '').toUpperCase() === 'ACTIVE');
  const totalPrincipal = activeTickets.reduce((s, t) => s + (Number(t.loanAmount) || 0), 0);
  const projectedInterest = activeTickets.reduce((s, t) => s + ((Number(t.loanAmount) || 0) * (Number(t.interestRate) || 0) / 100), 0);
  
  console.log(`   Total Principal: ₱${totalPrincipal.toLocaleString()}`);
  console.log(`   Projected Interest: ₱${projectedInterest.toLocaleString()}`);

  // Get customers
  const customers = await prisma.customer.findMany({
    where: { pawnshopId },
    select: { id: true, fullName: true }
  });
  console.log('👥 Customers:', customers);
  console.log(`   Total customers: ${customers.length}`);

  console.log('\n✅ [VerifyData] Complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
