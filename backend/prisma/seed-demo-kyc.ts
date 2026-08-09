import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const pawnshopId = process.env.DEMO_PAWN_SHOP_ID || (await prisma.pawnshop.findFirst())?.id;
  if (!pawnshopId) {
    console.log('Demo KYC seed skipped: no pawnshop found. Set DEMO_PAWN_SHOP_ID or seed a pawnshop first.');
    process.exit(0);
  }

  const verifiedDemos = [
    { fullName: 'Juan Dela Cruz', contactNumber: '09123456789', address: 'Manila' },
    { fullName: 'Maria Clara', contactNumber: '09987654321', address: 'Quezon City' },
    { fullName: 'Arvie Owner', contactNumber: '09555444333', address: 'Cavite' },
  ];

  for (const demo of verifiedDemos) {
    const existing = await prisma.customer.findFirst({
      where: { fullName: demo.fullName, contactNumber: demo.contactNumber },
    });
    const customerId = existing?.id ?? (
      await prisma.customer.create({
        data: {
          fullName: demo.fullName,
          contactNumber: demo.contactNumber,
          address: demo.address,
          pawnshopId,
        },
      })
    ).id;

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: { kycStatus: 'VERIFIED' },
      });
      await tx.customerKyc.upsert({
        where: { customerId },
        create: {
          customerId,
          pawnshopId,
          status: 'VERIFIED',
          fullName: demo.fullName,
          contactNumber: demo.contactNumber,
          address: demo.address,
          idType: 'NATIONAL_ID',
          idNumber: '123456789012',
          idFrontUrl: 'https://example.com/kyc-docs/demo-front.png',
          idBackUrl: 'https://example.com/kyc-docs/demo-back.png',
          selfieUrl: 'https://example.com/kyc-docs/demo-selfie.png',
        },
        update: {
          status: 'VERIFIED',
          fullName: demo.fullName,
          contactNumber: demo.contactNumber,
          address: demo.address,
        },
      });
    });

    console.log('KYC demo customer ready:', demo.fullName, '->', customerId);
  }

  const pendingDemo = { fullName: 'Pending Demo Customer', contactNumber: '09771234567', address: 'Cavite' };
  const existingPending = await prisma.customer.findFirst({
    where: { fullName: pendingDemo.fullName, contactNumber: pendingDemo.contactNumber },
  });
  const pendingCustomerId = existingPending?.id ?? (
    await prisma.customer.create({
      data: {
        fullName: pendingDemo.fullName,
        contactNumber: pendingDemo.contactNumber,
        address: pendingDemo.address,
        pawnshopId,
      },
    })
  ).id;

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: pendingCustomerId },
      data: { kycStatus: 'PENDING' },
    });
    await tx.customerKyc.upsert({
      where: { customerId: pendingCustomerId },
      create: {
        customerId: pendingCustomerId,
        pawnshopId,
        status: 'PENDING',
        fullName: pendingDemo.fullName,
        contactNumber: pendingDemo.contactNumber,
        address: pendingDemo.address,
        idType: 'NATIONAL_ID',
        idNumber: '123456789012',
        idFrontUrl: 'https://example.com/kyc-docs/demo-front.png',
      },
      update: {
        status: 'PENDING',
        fullName: pendingDemo.fullName,
        contactNumber: pendingDemo.contactNumber,
        address: pendingDemo.address,
      },
    });
  });

  console.log('KYC demo customer ready:', pendingDemo.fullName, '->', pendingCustomerId);
}

main().catch(console.error).finally(() => prisma.$disconnect());
