import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = 'testbidder@pawngold.com';

async function main() {
  const profile = await prisma.profile.findFirst({ where: { email } });

  if (!profile) {
    throw new Error(`PROFILE_NOT_FOUND for ${email}`);
  }

  await prisma.profile.update({
    where: { id: profile.id },
    data: {
      role: 'BIDDER',
      fullName: profile.fullName || 'Test Bidder',
    },
  });

  await prisma.bidderKyc.upsert({
    where: { profileId: profile.id },
    update: {
      status: 'VERIFIED',
      fullName: profile.fullName || 'Test Bidder',
      reviewedAt: new Date(),
      rejectionReason: null,
    },
    create: {
      profileId: profile.id,
      status: 'VERIFIED',
      fullName: profile.fullName || 'Test Bidder',
      dateOfBirth: new Date('1995-06-15'),
      address: '123 Test Street, Dasmarinas, Cavite',
      phoneNumber: '+63 912 345 6789',
      idType: 'NATIONAL_ID',
      idNumber: 'PSN-0000-0000-0001',
      idFrontUrl: 'https://placehold.co/400x250?text=ID+Front',
      idBackUrl: 'https://placehold.co/400x250?text=ID+Back',
      selfieUrl: 'https://placehold.co/400x250?text=Selfie',
      reviewedBy: profile.id,
      reviewedAt: new Date(),
    },
  });

  console.log(`KYC_VERIFIED_FOR ${profile.id}`);
}

main()
  .catch((err) => {
    console.error('FIX_FAILED:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
