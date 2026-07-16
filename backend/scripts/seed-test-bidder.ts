/**
 * Seed a pre-verified test bidder account.
 *
 * Usage:  npx tsx scripts/seed-test-bidder.ts
 *
 * Credentials:
 *   Email:    testbidder@pawngold.com
 *   Password: password123
 */
import { PrismaClient } from '@prisma/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'testbidder@pawngold.com';
const PASSWORD = 'password123';
const FULL_NAME = 'Test Bidder';

async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
) {
  const normalizedEmail = email.toLowerCase();
  const perPage = 1000;

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Auth list users failed: ${error.message}`);
    }

    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (found) return found;

    if (users.length < perPage) break;
  }

  return null;
}

function isDuplicateEmailError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('already been registered') ||
    normalized.includes('already exists') ||
    normalized.includes('duplicate')
  );
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
    // ── 1. Create (or find) Supabase Auth user ──────────────────────────
    let userId: string;

    // Check if user already exists
    const existing = await findAuthUserByEmail(supabase, EMAIL);

    if (existing) {
      userId = existing.id;
      console.log(`ℹ️  Auth user already exists: ${userId}`);
      // Update password and force email verification for existing seeded account.
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        userId,
        {
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { fullName: FULL_NAME, role: 'BIDDER' },
        },
      );
      if (updateError) {
        throw new Error(`Auth update failed: ${updateError.message}`);
      }
    } else {
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { fullName: FULL_NAME, role: 'BIDDER' },
      });
      if (error) {
        // Handle race condition: user exists but wasn't in the list
        if (isDuplicateEmailError(error.message)) {
          const retryExisting = await findAuthUserByEmail(supabase, EMAIL);
          if (!retryExisting) throw new Error(`Auth create failed: ${error.message}`);
          userId = retryExisting.id;
          console.log(`ℹ️  Auth user found on retry: ${userId}`);
          const { error: retryUpdateError } =
            await supabase.auth.admin.updateUserById(userId, {
              password: PASSWORD,
              email_confirm: true,
              user_metadata: { fullName: FULL_NAME, role: 'BIDDER' },
            });
          if (retryUpdateError) {
            throw new Error(`Auth update failed: ${retryUpdateError.message}`);
          }
        } else {
          throw new Error(`Auth create failed: ${error.message}`);
        }
      } else {
        userId = newUser.user.id;
        console.log(`✅ Auth user created: ${userId}`);
      }
    }

    // ── 2. Upsert profile ───────────────────────────────────────────────
    await prisma.profile.upsert({
      where: { id: userId },
      update: { email: EMAIL, fullName: FULL_NAME, role: 'BIDDER' },
      create: {
        id: userId,
        email: EMAIL,
        fullName: FULL_NAME,
        role: 'BIDDER',
        pawnshopId: null,
      },
    });
    console.log('✅ Profile upserted');

    // ── 3. Upsert KYC record as VERIFIED ────────────────────────────────
    await prisma.bidderKyc.upsert({
      where: { profileId: userId },
      update: {
        status: 'VERIFIED',
        fullName: FULL_NAME,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      create: {
        profileId: userId,
        status: 'VERIFIED',
        fullName: FULL_NAME,
        dateOfBirth: new Date('1995-06-15'),
        address: '123 Test Street, Dasmariñas, Cavite',
        phoneNumber: '+63 912 345 6789',
        idType: 'NATIONAL_ID',
        idNumber: 'PSN-0000-0000-0001',
        idFrontUrl: 'https://placehold.co/400x250?text=ID+Front',
        idBackUrl: 'https://placehold.co/400x250?text=ID+Back',
        selfieUrl: 'https://placehold.co/400x250?text=Selfie',
        reviewedBy: userId, // self-reviewed for seed purposes
        reviewedAt: new Date(),
      },
    });
    console.log('✅ BidderKyc set to VERIFIED');

    console.log('\n🎉 Test bidder seeded successfully!');
    console.log('─────────────────────────────────');
    console.log(`   Email:    ${EMAIL}`);
    console.log(`   Password: ${PASSWORD}`);
    console.log(`   KYC:      VERIFIED`);
    console.log('─────────────────────────────────\n');
  } catch (err: any) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
