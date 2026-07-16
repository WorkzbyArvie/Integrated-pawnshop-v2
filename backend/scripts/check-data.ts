import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const prisma = new PrismaClient();
async function main() {
  const shops = await prisma.pawnshop.findMany({ select: { id: true, name: true } });
  console.log('PAWNSHOPS:', JSON.stringify(shops, null, 2));
  const profiles = await prisma.profile.findMany({ select: { id: true, email: true, role: true, pawnshopId: true, fullName: true } });
  console.log('PROFILES:', JSON.stringify(profiles, null, 2));
  await prisma.$disconnect();
}
main();
