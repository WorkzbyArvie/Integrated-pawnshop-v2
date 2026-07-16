/**
 * Fix infinite recursion in profiles RLS policies.
 * Problem: "profiles_super_admin_see_all" does a sub-query on the profiles table,
 * which triggers the same RLS policies, causing infinite recursion (PostgreSQL error 42P17).
 * 
 * Solution: Create a SECURITY DEFINER function that bypasses RLS to check the user's role,
 * then use that function in the policies.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('=== Fixing profiles RLS infinite recursion ===\n');

  const steps = [
    // Step 1: Create a SECURITY DEFINER function to get current user's role (bypasses RLS)
    [
      `CREATE OR REPLACE FUNCTION public.get_my_role()
       RETURNS TEXT
       LANGUAGE SQL
       STABLE
       SECURITY DEFINER
       SET search_path = public
       AS $$
         SELECT role FROM public.profiles WHERE id = auth.uid()
       $$`,
      'Create get_my_role() function'
    ],
    // Step 2: Create a SECURITY DEFINER function to get current user's pawnshop_id
    [
      `CREATE OR REPLACE FUNCTION public.get_my_pawnshop_id()
       RETURNS UUID
       LANGUAGE SQL
       STABLE
       SECURITY DEFINER
       SET search_path = public
       AS $$
         SELECT pawnshop_id FROM public.profiles WHERE id = auth.uid()
       $$`,
      'Create get_my_pawnshop_id() function'
    ],
    // Step 3: Drop ALL existing profiles policies to start fresh
    [`DROP POLICY IF EXISTS "profiles_users_see_own" ON profiles`, 'Drop profiles_users_see_own'],
    [`DROP POLICY IF EXISTS "profiles_super_admin_see_all" ON profiles`, 'Drop profiles_super_admin_see_all'],
    [`DROP POLICY IF EXISTS "profiles_super_admin_manage" ON profiles`, 'Drop profiles_super_admin_manage'],
    [`DROP POLICY IF EXISTS "profiles_same_pawnshop" ON profiles`, 'Drop profiles_same_pawnshop'],
    [`DROP POLICY IF EXISTS "profiles_pawnshop_isolation" ON profiles`, 'Drop profiles_pawnshop_isolation'],

    // Step 4: Recreate profiles policies using the SECURITY DEFINER functions (no recursion)
    [
      `CREATE POLICY "profiles_own_row" ON profiles FOR SELECT TO authenticated
       USING (id = auth.uid())`,
      'Allow users to see their own profile'
    ],
    [
      `CREATE POLICY "profiles_same_pawnshop_read" ON profiles FOR SELECT TO authenticated
       USING (pawnshop_id = public.get_my_pawnshop_id() AND public.get_my_pawnshop_id() IS NOT NULL)`,
      'Allow users to see profiles in the same pawnshop'
    ],
    [
      `CREATE POLICY "profiles_admin_see_all" ON profiles FOR SELECT TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))`,
      'Allow super admin/owner to see all profiles'
    ],
    [
      `CREATE POLICY "profiles_admin_manage" ON profiles FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))`,
      'Allow super admin/owner to manage all profiles'
    ],
    [
      `CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
       USING (id = auth.uid())
       WITH CHECK (id = auth.uid())`,
      'Allow users to update their own profile'
    ],

    // Step 5: Fix pawnshops policies that also reference profiles (use the function instead)
    [`DROP POLICY IF EXISTS "pawnshops_super_admin_all" ON pawnshops`, 'Drop pawnshops_super_admin_all'],
    [`DROP POLICY IF EXISTS "pawnshops_own_pawnshop" ON pawnshops`, 'Drop pawnshops_own_pawnshop'],
    [`DROP POLICY IF EXISTS "pawnshops_admin_manage" ON pawnshops`, 'Drop pawnshops_admin_manage'],
    [
      `CREATE POLICY "pawnshops_own" ON pawnshops FOR SELECT TO authenticated
       USING (id = public.get_my_pawnshop_id())`,
      'Allow users to see their own pawnshop'
    ],
    [
      `CREATE POLICY "pawnshops_admin_all" ON pawnshops FOR SELECT TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))`,
      'Allow admin to see all pawnshops'
    ],
    [
      `CREATE POLICY "pawnshops_admin_manage" ON pawnshops FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))`,
      'Allow admin to manage pawnshops'
    ],

    // Step 6: Fix branch policies
    [`DROP POLICY IF EXISTS "branch_super_admin_all" ON branch`, 'Drop branch_super_admin_all'],
    [`DROP POLICY IF EXISTS "branch_pawnshop_isolation" ON branch`, 'Drop branch_pawnshop_isolation'],
    [`DROP POLICY IF EXISTS "branch_admin_manage" ON branch`, 'Drop branch_admin_manage'],
    [
      `CREATE POLICY "branch_own_pawnshop" ON branch FOR SELECT TO authenticated
       USING (pawnshop_id = public.get_my_pawnshop_id() OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))`,
      'Branch: own pawnshop + admin see all'
    ],
    [
      `CREATE POLICY "branch_admin_manage" ON branch FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))`,
      'Branch: admin manage'
    ],

    // Step 7: Fix customer policies
    [`DROP POLICY IF EXISTS "customer_super_admin_all_access" ON customer`, 'Drop customer policies'],
    [`DROP POLICY IF EXISTS "customer_branch_admin_own_pawnshop" ON customer`, 'Drop customer pawnshop policy'],
    [
      `CREATE POLICY "customer_access" ON customer FOR ALL TO authenticated
       USING (
         pawnshop_id = public.get_my_pawnshop_id()
         OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER')
       )
       WITH CHECK (
         pawnshop_id = public.get_my_pawnshop_id()
         OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER')
       )`,
      'Customer: pawnshop isolation + admin access'
    ],

    // Step 8: Fix ticket policies
    [`DROP POLICY IF EXISTS "ticket_super_admin_all_access" ON ticket`, 'Drop ticket policies'],
    [`DROP POLICY IF EXISTS "ticket_branch_admin_own_pawnshop" ON ticket`, 'Drop ticket pawnshop policy'],
    [
      `CREATE POLICY "ticket_access" ON ticket FOR ALL TO authenticated
       USING (
         pawnshop_id = public.get_my_pawnshop_id()
         OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER')
       )
       WITH CHECK (
         pawnshop_id = public.get_my_pawnshop_id()
         OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER')
       )`,
      'Ticket: pawnshop isolation + admin access'
    ],

    // Step 9: Fix loan policies
    [`DROP POLICY IF EXISTS "loan_super_admin_all_access" ON loan`, 'Drop loan policies'],
    [`DROP POLICY IF EXISTS "loan_branch_admin_own_pawnshop" ON loan`, 'Drop loan pawnshop policy'],
    [
      `CREATE POLICY "loan_access" ON loan FOR ALL TO authenticated
       USING (
         pawnshop_id = public.get_my_pawnshop_id()
         OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER')
       )
       WITH CHECK (
         pawnshop_id = public.get_my_pawnshop_id()
         OR public.get_my_role() IN ('SUPER_ADMIN', 'OWNER')
       )`,
      'Loan: pawnshop isolation + admin access'
    ],

    // Step 10: Fix inventory policies
    [`DROP POLICY IF EXISTS "inventory_super_admin_all_access" ON inventory`, 'Drop inventory policies'],
    [`DROP POLICY IF EXISTS "inventory_branch_admin_own_pawnshop" ON inventory`, 'Drop inventory pawnshop policy'],
    [
      `CREATE POLICY "inventory_access" ON inventory FOR ALL TO authenticated
       USING (true)
       WITH CHECK (true)`,
      'Inventory: open access for authenticated (no pawnshop_id column)'
    ],

    // Step 11: Fix staff policies
    [`DROP POLICY IF EXISTS "staff_super_admin_all" ON staff`, 'Drop staff policies'],
    [`DROP POLICY IF EXISTS "staff_pawnshop_isolation" ON staff`, 'Drop staff pawnshop policy'],
    [
      `CREATE POLICY "staff_access" ON staff FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))`,
      'Staff: admin access'
    ],

    // Step 12: Fix other tables - category (public read)
    [`DROP POLICY IF EXISTS "category_public_read" ON category`, 'Drop category policy'],
    [
      `CREATE POLICY "category_read" ON category FOR SELECT TO authenticated USING (true)`,
      'Category: public read'
    ],

    // Step 13: Activity log
    [`DROP POLICY IF EXISTS "activitylog_access" ON activitylog`, 'Drop activitylog policy'],
    [
      `CREATE POLICY "activitylog_access" ON activitylog FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))`,
      'Activity log: admin access'
    ],

    // Step 14: System settings
    [`DROP POLICY IF EXISTS "systemsettings_access" ON systemsettings`, 'Drop systemsettings policy'],
    [
      `CREATE POLICY "systemsettings_access" ON systemsettings FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))`,
      'System settings: admin access'
    ],

    // Step 15: Transaction
    [`DROP POLICY IF EXISTS "transaction_access" ON transaction`, 'Drop transaction policy'],
    [
      `CREATE POLICY "transaction_access" ON transaction FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
      'Transaction: authenticated access'
    ],

    // Step 16: Auction listings (public read for LIVE, admin manage)
    [`DROP POLICY IF EXISTS "auction_listings_public_read" ON auction_listings`, 'Drop auction_listings policy'],
    [`DROP POLICY IF EXISTS "auction_listings_admin_manage" ON auction_listings`, 'Drop auction_listings manage policy'],
    [
      `CREATE POLICY "auction_listings_read" ON auction_listings FOR SELECT TO authenticated USING (true)`,
      'Auction listings: read for all authenticated'
    ],
    [
      `CREATE POLICY "auction_listings_anon_read" ON auction_listings FOR SELECT TO anon USING (status = 'LIVE')`,
      'Auction listings: anon read LIVE only'
    ],
    [
      `CREATE POLICY "auction_listings_manage" ON auction_listings FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN'))`,
      'Auction listings: admin manage'
    ],

    // Step 17: Auction bids
    [`DROP POLICY IF EXISTS "auction_bids_access" ON auction_bids`, 'Drop auction_bids policy'],
    [
      `CREATE POLICY "auction_bids_access" ON auction_bids FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
      'Auction bids: authenticated access'
    ],

    // Step 18: Auction images
    [`DROP POLICY IF EXISTS "auction_images_access" ON auction_images`, 'Drop auction_images policy'],
    [
      `CREATE POLICY "auction_images_read" ON auction_images FOR SELECT TO authenticated USING (true)`,
      'Auction images: read for authenticated'
    ],
    [
      `CREATE POLICY "auction_images_anon_read" ON auction_images FOR SELECT TO anon USING (true)`,
      'Auction images: anon read'
    ],

    // Step 19: Admin invites
    [`DROP POLICY IF EXISTS "admin_invites_access" ON admin_invites`, 'Drop admin_invites policy'],
    [
      `CREATE POLICY "admin_invites_access" ON admin_invites FOR ALL TO authenticated
       USING (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))
       WITH CHECK (public.get_my_role() IN ('SUPER_ADMIN', 'OWNER'))`,
      'Admin invites: super admin/owner only'
    ],

    // Step 20: Grant execute on the helper functions
    [`GRANT EXECUTE ON FUNCTION public.get_my_role TO anon, authenticated, service_role`, 'Grant execute on get_my_role'],
    [`GRANT EXECUTE ON FUNCTION public.get_my_pawnshop_id TO anon, authenticated, service_role`, 'Grant execute on get_my_pawnshop_id'],
  ];

  let ok = 0, err = 0;
  for (const [sql, label] of steps) {
    try {
      await p.$executeRawUnsafe(sql);
      console.log(`  ✅ ${label}`);
      ok++;
    } catch (e) {
      console.error(`  ❌ ${label}: ${e.message.split('\n')[0]}`);
      err++;
    }
  }

  console.log(`\n=== Done: ${ok} succeeded, ${err} failed ===`);
}

main()
  .catch(err => console.error('FATAL:', err))
  .finally(() => p.$disconnect());
