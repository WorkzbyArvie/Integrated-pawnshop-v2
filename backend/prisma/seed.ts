import { PrismaClient, Prisma } from '@prisma/client';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Fierce Database Seed ---');

  // 1. CLEANUP (Delete in order of dependencies)
  console.log('🗑️  Cleaning up existing records...');
  await prisma.activityLog.deleteMany({});
  await prisma.systemSettings.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.loan.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.staff.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.category.deleteMany({});

  console.log('✅ Cleanup complete.');

  // 2. SEED BRANCHES
  console.log('🏢 Seeding Branch...');
  const mainBranch = await prisma.branch.create({
    data: {
      name: 'Dasmariñas Central',
      location: 'Cavite, Philippines',
    },
  });

  // 3. SEED SYSTEM SETTINGS
  await prisma.systemSettings.create({
    data: {
      branchId: mainBranch.id,
      defaultInterest: 3.5,
      enableAiPricing: true,
      showVaultWidget: true,
      showRiskWidget: true,
    },
  });

  // 4. SEED STAFF (Fixed: Changed 'username' to 'fullName')
  console.log('👤 Seeding Staff...');
  const adminUser = await prisma.staff.create({
    data: { 
      id: randomUUID(),
      fullName: 'admin',
      password: 'password123', 
      role: 'ADMIN',
      branchId: mainBranch.id 
    },
  });

  await prisma.staff.create({
    data: { 
      id: randomUUID(),
      fullName: 'manager_lee',
      password: 'password123', 
      role: 'MANAGER',
      branchId: mainBranch.id 
    },
  });

  // 5. SEED CATEGORIES (Fixed: Manual IDs to match server.js logic)
  console.log('📦 Seeding Metadata...');
  const goldCat = await prisma.category.create({
    data: { name: 'Gold Jewelry' },
  });

  const silverCat = await prisma.category.create({
    data: { name: 'Silver Jewelry' },
  });

  const electronicsCat = await prisma.category.create({
    data: { name: 'Electronics' },
  });

  // 6. SEED CUSTOMERS
  // Create customers with explicit IDs (schema requires id)
  const customers = [] as any[];
  const custData = [
    { fullName: 'Juan Dela Cruz', contactNumber: '09123456789', address: 'Manila' },
    { fullName: 'Maria Clara', contactNumber: '09987654321', address: 'Quezon City' },
    { fullName: 'Arvie Owner', contactNumber: '09555444333', address: 'Cavite' },
  ];
  for (const c of custData) {
    const created = await prisma.customer.create({
      data: {
        id: randomUUID(),
        fullName: c.fullName,
        contactNumber: c.contactNumber,
        address: c.address,
      },
    });
    customers.push(created);
  }

  // 7. SEED TICKETS
  console.log('🎫 Seeding Tickets...');
  const ticket1 = await prisma.ticket.create({
    data: {
      ticketNumber: 'T-2026-001',
      customerId: customers[0].id,
      branchId: mainBranch.id,
      category: 'Gold Jewelry',
      description: '24K Gold Wedding Band',
      weight: 10.5,
      loanAmount: 50000,
      interestRate: 3.5,
      status: 'ACTIVE',
      expiryDate: new Date('2026-06-15'),
    },
  });

  const ticket2 = await prisma.ticket.create({
    data: {
      ticketNumber: 'T-2026-002',
      customerId: customers[1].id,
      branchId: mainBranch.id,
      category: 'Electronics',
      description: 'iPhone 15 Pro Max',
      loanAmount: 35000,
      interestRate: 4.0,
      status: 'FORFEITED',
      expiryDate: new Date('2025-12-01'),
      forfeitureDate: new Date(),
    },
  });

  // 8. SEED INVENTORY & LOANS
  await prisma.inventory.createMany({
    data: [
      { categoryId: goldCat.id, ticketId: ticket1.id, isForAuction: false },
      { categoryId: electronicsCat.id, ticketId: ticket2.id, isForAuction: true, auctionPrice: 38000 },
    ],
  });

  await prisma.loan.createMany({
    data: [
      { ticketId: ticket1.id, principalAmount: 50000, interestAmount: 1750 },
      { ticketId: ticket2.id, principalAmount: 35000, interestAmount: 1400 },
    ],
  });

  // 9. LOG INITIAL ACTION
  await prisma.activityLog.create({
    data: {
      staffId: adminUser.id,
      action: 'SYSTEM_INITIALIZATION',
      details: 'Database seeded with Multi-Branch/Role structure.',
    },
  });

  console.log('🚀 Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });