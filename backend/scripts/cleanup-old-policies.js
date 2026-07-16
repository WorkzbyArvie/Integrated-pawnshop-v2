/**
 * Nuclear cleanup: Drop ALL old/conflicting policies, keep only the safe ones using get_my_role()/get_my_pawnshop_id().
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== Nuclear RLS policy cleanup ===\n');

  const drops = [
    // ── PROFILES: drop ALL old recursive policies ──
    `DROP POLICY IF EXISTS "super_admin_full_profiles_access" ON profiles`,
    `DROP POLICY IF EXISTS "branch_admin_select_own_profiles" ON profiles`,
    `DROP POLICY IF EXISTS "users_see_own_profile" ON profiles`,
    `DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles`,
    `DROP POLICY IF EXISTS "Users can view their own profile" ON profiles`,

    // ── CUSTOMER: drop old recursive policies ──
    `DROP POLICY IF EXISTS "customer_pawnshop_isolation" ON customer`,
    `DROP POLICY IF EXISTS "customer_super_admin_all" ON customer`,
    `DROP POLICY IF EXISTS "customer_insert" ON customer`,
    `DROP POLICY IF EXISTS "customer_update" ON customer`,
    `DROP POLICY IF EXISTS "customer_delete" ON customer`,

    // ── TICKET: drop old recursive policies ──
    `DROP POLICY IF EXISTS "ticket_pawnshop_isolation" ON ticket`,
    `DROP POLICY IF EXISTS "ticket_super_admin_all" ON ticket`,
    `DROP POLICY IF EXISTS "ticket_insert" ON ticket`,
    `DROP POLICY IF EXISTS "ticket_update" ON ticket`,
    `DROP POLICY IF EXISTS "ticket_delete" ON ticket`,

    // ── LOAN: drop old recursive policies ──
    `DROP POLICY IF EXISTS "loan_pawnshop_isolation" ON loan`,
    `DROP POLICY IF EXISTS "loan_super_admin_all" ON loan`,
    `DROP POLICY IF EXISTS "loan_admin_manage" ON loan`,

    // ── INVENTORY: drop old policies ──
    `DROP POLICY IF EXISTS "inventory_pawnshop_isolation" ON inventory`,
    `DROP POLICY IF EXISTS "inventory_super_admin_all" ON inventory`,
    `DROP POLICY IF EXISTS "inventory_insert" ON inventory`,
    `DROP POLICY IF EXISTS "inventory_update" ON inventory`,

    // ── PAWNSHOPS: drop old ──
    `DROP POLICY IF EXISTS "pawnshops_user_own" ON pawnshops`,

    // ── STAFF: drop old ──
    `DROP POLICY IF EXISTS "staff_admin_manage" ON staff`,

    // ── ACTIVITY LOG: drop old ──
    `DROP POLICY IF EXISTS "activitylog_admin_only" ON activitylog`,
    `DROP POLICY IF EXISTS "activitylog_admin_insert" ON activitylog`,

    // ── SYSTEM SETTINGS: drop old ──
    `DROP POLICY IF EXISTS "systemsettings_admin_manage" ON systemsettings`,
    `DROP POLICY IF EXISTS "systemsettings_branch_access" ON systemsettings`,
    `DROP POLICY IF EXISTS "systemsettings_super_admin_all" ON systemsettings`,

    // ── ADMIN INVITES: drop old ──
    `DROP POLICY IF EXISTS "admin_invites_super_admin_only" ON admin_invites`,

    // ── AUCTION: drop old ──
    `DROP POLICY IF EXISTS "auction_listings_public_live" ON auction_listings`,
    `DROP POLICY IF EXISTS "auction_listings_admin_own" ON auction_listings`,
    `DROP POLICY IF EXISTS "auction_bids_public_live" ON auction_bids`,
    `DROP POLICY IF EXISTS "auction_bids_authenticated_insert" ON auction_bids`,
    `DROP POLICY IF EXISTS "auction_images_public_live" ON auction_images`,
    `DROP POLICY IF EXISTS "auction_images_admin_manage" ON auction_images`,

    // ── CATEGORY: drop old ──
    `DROP POLICY IF EXISTS "category_admin_manage" ON category`,

    // ── TRANSACTION: drop old ──
    `DROP POLICY IF EXISTS "transaction_pawnshop_isolation" ON transaction`,
    `DROP POLICY IF EXISTS "transaction_super_admin_all" ON transaction`,
  ];

  let ok = 0;
  for (const sql of drops) {
    try {
      await p.$executeRawUnsafe(sql);
      ok++;
    } catch (e) {
      console.error(`  ERR: ${sql.substring(0, 80)} - ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`Dropped ${ok} old policies.\n`);

  // Verify profiles table now only has safe policies
  const remaining = await p.$queryRawUnsafe(
    `SELECT polname, polcmd, pg_get_expr(polqual, polrelid) as qual
     FROM pg_policy 
     JOIN pg_class ON pg_policy.polrelid = pg_class.oid 
     WHERE relname = 'profiles'`
  );
  console.log('=== Remaining profiles policies ===');
  for (const pol of remaining) {
    const hasRecursion = (pol.qual || '').includes('profiles') && !pol.qual.includes('get_my_');
    console.log(`  ${hasRecursion ? '⚠️  RECURSIVE' : '✅ SAFE'} ${pol.polname} | qual=${(pol.qual || '').substring(0, 120)}`);
  }

  console.log('\n=== Done ===');
}

main().catch(e => console.error(e)).finally(() => p.$disconnect());
