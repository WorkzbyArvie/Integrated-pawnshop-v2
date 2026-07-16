/**
 * Seed staff accounts for all pawnshops.
 *
 * Creates Owner, Manager, Cashier, Staff, and Appraiser accounts
 * for each existing pawnshop, plus sets password123 on all of them.
 *
 * Usage:  npx tsx scripts/seed-staff-accounts.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PASSWORD = 'password123';

// Staff templates per pawnshop
const STAFF_TEMPLATES = [
  { emailPrefix: 'owner',     fullName: 'Pawnshop Owner',    role: 'OWNER' },
  { emailPrefix: 'manager',   fullName: 'Branch Manager',    role: 'MANAGER' },
  { emailPrefix: 'cashier',   fullName: 'Branch Cashier',    role: 'CASHIER' },
  { emailPrefix: 'staff1',    fullName: 'Staff Member 1',    role: 'STAFF' },
  { emailPrefix: 'staff2',    fullName: 'Staff Member 2',    role: 'STAFF' },
  { emailPrefix: 'appraiser', fullName: 'Item Appraiser',    role: 'APPRAISER' },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function upsertAuthUser(
  supabase: any,
  email: string,
  fullName: string,
  role: string,
): Promise<string> {
  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingUsers?.users?.find(
    (u: any) => u.email?.toLowerCase() === email.toLowerCase(),
  );

  if (existing) {
    console.log(`  ℹ️  ${email} exists (${existing.id.slice(0, 8)}...) – skipped (password unchanged)`);
    return existing.id;
  }

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { fullName, role },
  });

  if (error) {
    if (error.message.includes('already been registered')) {
      const { data: retry } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const found = retry?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
      if (found) {
        await supabase.auth.admin.updateUserById(found.id, { password: PASSWORD });
        console.log(`  ℹ️  ${email} found on retry (${found.id.slice(0, 8)}...)`);
        return found.id;
      }
    }
    throw new Error(`Failed to create ${email}: ${error.message}`);
  }

  console.log(`  ✅ Created ${email} (${newUser.user.id.slice(0, 8)}...)`);
  return newUser.user.id;
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const prisma = new PrismaClient();

  try {
    // Get all pawnshops
    const pawnshops = await prisma.pawnshop.findMany({ select: { id: true, name: true } });
    if (pawnshops.length === 0) {
      console.log('⚠️  No pawnshops found. Create a pawnshop first.');
      return;
    }

    console.log(`\n📋 Found ${pawnshops.length} pawnshop(s). Seeding staff accounts...\n`);

    for (const shop of pawnshops) {
      console.log(`\n🏪 ${shop.name} (${shop.id.slice(0, 8)}...)`);
      const shopSlug = slugify(shop.name);

      for (const template of STAFF_TEMPLATES) {
        const email = `${template.emailPrefix}.${shopSlug}@pawngold.com`;
        const fullName = `${template.fullName} – ${shop.name}`;

        const userId = await upsertAuthUser(supabase, email, fullName, template.role);

        await prisma.profile.upsert({
          where: { id: userId },
          update: {
            email,
            fullName,
            role: template.role,
            pawnshopId: shop.id,
          },
          create: {
            id: userId,
            email,
            fullName,
            role: template.role,
            pawnshopId: shop.id,
          },
        });
      }
    }

    // Also reset password on existing profiles tied to a pawnshop
    const existingStaff = await prisma.profile.findMany({
      where: { pawnshopId: { not: null }, role: { not: 'BIDDER' } },
      select: { id: true, email: true, fullName: true, role: true },
    });
    console.log(`\n🔑 Resetting passwords for ${existingStaff.length} existing staff profiles...`);
    for (const staff of existingStaff) {
      try {
        await supabase.auth.admin.updateUserById(staff.id, { password: PASSWORD });
      } catch {}
    }

    console.log('\n──────────────────────────────────────');
    console.log('🎉 All staff accounts seeded!');
    console.log('──────────────────────────────────────');
    console.log(`   Password for ALL accounts: ${PASSWORD}`);
    console.log('──────────────────────────────────────\n');

    // Print summary
    const allProfiles = await prisma.profile.findMany({
      where: { pawnshopId: { not: null } },
      select: { email: true, fullName: true, role: true, pawnshopId: true },
      orderBy: [{ pawnshopId: 'asc' }, { role: 'asc' }],
    });

    console.log('📊 All staff profiles:\n');
    for (const p of allProfiles) {
      console.log(`   ${(p.role || '').padEnd(14)} ${(p.email || '').padEnd(40)} ${p.fullName}`);
    }
    console.log('');
  } catch (err: any) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
