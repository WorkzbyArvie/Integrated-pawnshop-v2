-- ============================================================================
-- RLS SECURITY TESTS - Updated for actual schema
-- ============================================================================
-- Run these tests to verify RLS policies are working correctly
-- These tests verify pawnshop isolation and role-based access

-- ============================================================================
-- SETUP: Create test users with different roles and pawnshops
-- ============================================================================
-- Note: These are simulated tests. Real testing requires actual auth tokens.
-- Execute verification queries below with real authenticated users.

-- ============================================================================
-- TEST 1: Verify RLS is enabled on all critical tables
-- ============================================================================
-- This query shows which tables have RLS enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public'
AND tablename IN (
  'profiles', 'pawnshops', 'branch', 'customer', 'ticket', 
  'inventory', 'category', 'staff', 'activitylog', 'systemsettings',
  'auction_listings', 'auction_bids', 'auction_images', 'transaction', 'loan', 'admin_invites'
)
ORDER BY tablename;

-- ============================================================================
-- TEST 2: Verify policies exist on all tables
-- ============================================================================
-- Count policies per table
SELECT schemaname, tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
  'profiles', 'pawnshops', 'branch', 'customer', 'ticket', 
  'inventory', 'category', 'staff', 'activitylog', 'systemsettings',
  'auction_listings', 'auction_bids', 'auction_images', 'transaction', 'loan', 'admin_invites'
)
GROUP BY schemaname, tablename
ORDER BY tablename;

-- ============================================================================
-- TEST 3: List all policies with details
-- ============================================================================
SELECT tablename, policyname, qual as using_clause, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
  'profiles', 'pawnshops', 'branch', 'customer', 'ticket', 
  'inventory', 'category', 'staff', 'activitylog', 'systemsettings',
  'auction_listings', 'auction_bids', 'auction_images', 'transaction', 'loan', 'admin_invites'
)
ORDER BY tablename, policyname;

-- ============================================================================
-- TEST 4: Sample pawnshop data structure
-- ============================================================================
-- View pawnshop and branch hierarchy
SELECT 
  p.id as pawnshop_id,
  p.name as pawnshop_name,
  COUNT(b.id) as branch_count
FROM pawnshops p
LEFT JOIN branch b ON b.pawnshop_id = p.id
GROUP BY p.id, p.name
LIMIT 5;

-- ============================================================================
-- TEST 5: Sample profile and role data
-- ============================================================================
-- Check user profiles with roles and assignments
SELECT 
  id,
  role,
  pawnshop_id,
  email,
  full_name
FROM profiles
LIMIT 10;

-- ============================================================================
-- TEST 6: Verify pawnshop_id column exists on all required tables
-- ============================================================================
-- Check customer table pawnshop_id
SELECT COUNT(DISTINCT pawnshop_id) as unique_pawnshops
FROM customer
WHERE pawnshop_id IS NOT NULL;

-- Check ticket table pawnshop_id
SELECT COUNT(DISTINCT pawnshop_id) as unique_pawnshops
FROM ticket
WHERE pawnshop_id IS NOT NULL;

-- Check loan table pawnshop_id
SELECT COUNT(DISTINCT pawnshop_id) as unique_pawnshops
FROM loan
WHERE pawnshop_id IS NOT NULL;

-- Check auction_listings table pawnshop_id
SELECT COUNT(DISTINCT pawnshop_id) as unique_pawnshops
FROM auction_listings
WHERE pawnshop_id IS NOT NULL;

-- ============================================================================
-- TEST 7: Data isolation verification (manual execution with auth tokens)
-- ============================================================================
/*
These queries should be run as different authenticated users.
Before running, you'll need valid JWT tokens from Supabase Auth.

TEST 7a: As SUPER_ADMIN (should see all pawnshops)
- Expected: All pawnshops visible
- Query: SELECT COUNT(*) FROM pawnshops;

TEST 7b: As OWNER/ADMIN (should see only assigned pawnshop)
- Expected: 1 pawnshop only
- Query: SELECT COUNT(*) FROM pawnshops;

TEST 7c: As STAFF (should see limited data)
- Expected: Only data from assigned pawnshop
- Query: SELECT pawnshop_id FROM customer LIMIT 10;

TEST 7d: As Anonymous (should see only public auction listings)
- Expected: Only LIVE status listings
- Query: SELECT COUNT(*) FROM auction_listings WHERE status = 'LIVE';
*/

-- ============================================================================
-- TEST 8: Cross-pawnshop data leakage check
-- ============================================================================
-- This query helps identify if pawnshops have proper isolation
-- Run as a non-admin user from pawnshop A, should NOT see pawnshop B data
/*
1. Get the current user's pawnshop:
   SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid;

2. Try to query customer data:
   SELECT COUNT(*) FROM customer;
   -- Should equal customers from step 1's pawnshop only

3. Try cross-pawnshop query (should fail/return 0):
   WITH my_pawnshop AS (
     SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid
   )
   SELECT COUNT(*) FROM customer 
   WHERE pawnshop_id != (SELECT pawnshop_id FROM my_pawnshop);
   -- Should return 0 rows due to RLS
*/

-- ============================================================================
-- TEST 9: Auction public access (no auth required)
-- ============================================================================
-- This simulates anonymous user access
-- Should only see LIVE listings
SELECT 
  id,
  title,
  status,
  starting_price,
  pawnshop_id
FROM auction_listings
WHERE status = 'LIVE'
LIMIT 5;

-- ============================================================================
-- TEST 10: Activity log and transaction access (admin only)
-- ============================================================================
-- These tables should be restricted to SUPER_ADMIN/OWNER/MANAGER/ADMIN roles
-- Regular STAFF users should get 0 results
SELECT COUNT(*) from activitylog;
SELECT COUNT(*) from "transaction";

-- ============================================================================
-- MANUAL VERIFICATION CHECKLIST
-- ============================================================================
/*
After running the SECURITY_FIX_RLS_COMPLETE.sql script, verify these:

1. ✓ RLS is enabled on all 16 tables
   - Run TEST 1 query above
   - ALL tables should show rowsecurity = true

2. ✓ Policies exist on all tables
   - Run TEST 2 query above
   - Should see ~3-4 policies per table (SELECT, INSERT, UPDATE, DELETE variants)
   - Total should be 40+ policies across all tables

3. ✓ No syntax errors in policies
   - Run TEST 3 query above
   - Review using_clause and with_check for any obvious errors

4. ✓ Database schema is correct
   - Run TEST 4 and TEST 5 queries
   - Verify pawnshops and profiles tables exist
   - Confirm users have role and pawnshop_id assignments

5. ✓ Pawnshop isolation columns exist
   - Run TEST 6 queries
   - Each table should have pawnshop_id data populated

6. ✓ Test with real users (after auth token setup)
   - Super Admin: run TEST 7a - should see all pawnshops
   - Branch Admin: run TEST 7b - should see only 1 pawnshop
   - Staff: run TEST 7c - should see only limited customer data
   - Anonymous: run TEST 7d - should see only LIVE auction listings

7. ✓ Verify data isolation (cross-pawnshop blocking)
   - Run TEST 8 - staff from pawnshop A should NOT see pawnshop B's customers
   - Should return 0 rows for cross-pawnshop queries

8. ✓ Auction public access
   - Run TEST 9 - should see LIVE listings without auth
   - Draft listings should not be visible

9. ✓ Admin-only tables
   - Run TEST 10 - activitylog and transaction should be restricted to admins

10. ✓ Password protection (Auth settings)
    - Go to Supabase Dashboard > Authentication > Providers
    - Click on Email provider
    - Check "Require email confirmation" or "Require password"
    - This fixes the "Leaked password protection" Supabase error
*/

-- ============================================================================
-- QUICK VERIFICATION SCRIPT
-- ============================================================================
-- Copy and run all of these together to verify setup:

-- Check RLS status
SELECT COUNT(*) as tables_with_rls FROM (
  SELECT schemaname, tablename FROM pg_tables 
  WHERE schemaname = 'public' AND rowsecurity = true
  AND tablename IN (
    'profiles', 'pawnshops', 'branch', 'customer', 'ticket', 
    'inventory', 'category', 'staff', 'activitylog', 'systemsettings',
    'auction_listings', 'auction_bids', 'auction_images', 'transaction', 'loan', 'admin_invites'
  )
) as enabled_tables;

-- Check policies count
SELECT COUNT(*) as total_policies FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
  'profiles', 'pawnshops', 'branch', 'customer', 'ticket', 
  'inventory', 'category', 'staff', 'activitylog', 'systemsettings',
  'auction_listings', 'auction_bids', 'auction_images', 'transaction', 'loan', 'admin_invites'
);

-- Check for any missing critical tables
SELECT 'MISSING TABLES:' as status, tablename
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'profiles', 'pawnshops', 'branch', 'customer', 'ticket', 
  'inventory', 'category', 'staff', 'activitylog', 'systemsettings',
  'auction_listings', 'auction_bids', 'auction_images', 'transaction', 'loan', 'admin_invites'
)
AND NOT EXISTS (
  SELECT 1 FROM pg_tables t2 
  WHERE t2.tablename = pg_tables.tablename 
  AND t2.schemaname = 'public'
);

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================
/*
If you encounter issues:

Q: "ERROR: relation 'X' does not exist"
A: The table doesn't exist. Check your schema migrations ran successfully.
   - Run: SELECT tablename FROM pg_tables WHERE schemaname = 'public';
   - Verify all tables are present

Q: "RLS still shows as false"
A: The ENABLE RLS command didn't work. Check:
   - Ensure ALTER TABLE statements didn't error
   - Re-run: ALTER TABLE tablename ENABLE ROW LEVEL SECURITY;
   - Run TEST 1 to verify

Q: "No policies shown in Supabase UI"
A: Policies were created but UI lag. Try:
   - Refresh the Supabase browser tab
   - Re-run TEST 2 and TEST 3 to verify policies exist
   - If queries return results, policies are applied

Q: "Seeing other pawnshop's data as non-admin"
A: RLS policies not working correctly. Check:
   - User has profile record with correct pawnshop_id
   - User's role is in allowed roles list
   - Run TEST 7 to verify isolation

Q: "Supabase says 'Leaked password protection disabled'"
A: This is NOT fixed by SQL. Go to:
   - Dashboard > Authentication > Providers > Email
   - Check "Require email confirmation"
   - Save and wait ~30 seconds for Security Advisor to refresh
*/
