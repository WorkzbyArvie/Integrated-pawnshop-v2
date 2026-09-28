import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const [identifier, password] = process.argv.slice(2);

if (!identifier || !password) {
  console.error('Usage: npx tsx scripts/set-user-password.ts <email|user-uuid> <password>');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function describe(error: unknown): string {
  const value = error as { message?: string; status?: number; code?: string } | null;
  const parts = [value?.message ?? 'unknown error'];
  if (value?.status !== undefined) parts.push(`status=${value.status}`);
  if (value?.code) parts.push(`code=${value.code}`);
  return parts.join(' | ');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findUserByEmail(target: string) {
  const pageSizes = [25, 100, 1000];
  const failures: string[] = [];

  for (const perPage of pageSizes) {
    let page = 1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        failures.push(`perPage=${perPage} page=${page}: ${describe(error)}`);
        break;
      }
      const match = data.users.find(
        (candidate) => candidate.email?.toLowerCase() === target.toLowerCase(),
      );
      if (match) return match;
      if (data.users.length < perPage) return undefined;
      page += 1;
    }
  }

  throw new Error(failures.join(' ; ') || 'listUsers returned no usable response');
}

function projectRef(url: string): string {
  const match = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\./i);
  return match ? match[1] : url;
}

async function main() {
  console.log(`Connected Supabase project: ${projectRef(supabaseUrl!)}`);

  if (UUID_PATTERN.test(identifier)) {
    const { data, error } = await supabase.auth.admin.getUserById(identifier);
    if (error) {
      console.error(`No Supabase Auth user with id ${identifier}: ${describe(error)}`);
      process.exit(1);
    }
    console.log(`Found user: ${data.user.email}`);
    await applyPassword(identifier);
    return;
  }

  let userId: string | undefined;
  try {
    userId = (await findUserByEmail(identifier))?.id;
  } catch (error) {
    console.error('Could not search for the user:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (!userId) {
    console.error(`No Supabase Auth user found for ${identifier} in this project`);
    process.exit(1);
  }

  await applyPassword(userId);
}

async function applyPassword(userId: string) {
  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error('Could not update password:', describe(error));
    process.exit(1);
  }
  console.log(`Password updated for ${userId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
