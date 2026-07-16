-- ============================================================================
-- COMPREHENSIVE RLS FIX - RUN ALL OF THIS
-- ============================================================================
-- This script will fix everything: data + RLS policies

-- ============================================================================
-- STEP 1: CHECK & FIX PROFILES DATA
-- ============================================================================
-- Ensure superadmin has correct role and NULL pawnshop_id
UPDATE profiles 
SET role = 'SUPER_ADMIN', pawnshop_id = NULL
WHERE email = 'superadmin@pawngold.com';

-- Ensure branch admin has BRANCH_ADMIN role
UPDATE profiles
SET role = 'BRANCH_ADMIN'
WHERE email = 'arviesamala2005@gmail.com'
AND role IS DISTINCT FROM 'BRANCH_ADMIN';

-- Check current state
SELECT id, email, role, pawnshop_id FROM profiles ORDER BY created_at DESC LIMIT 10;

-- ============================================================================
-- STEP 2: DROP ALL OLD POLICIES
-- ============================================================================
-- Drop all existing policies from pawnshops table
DROP POLICY IF EXISTS "super_admin_select_all_pawnshops" ON pawnshops;
DROP POLICY IF EXISTS "branch_admin_select_own_pawnshop" ON pawnshops;
DROP POLICY IF EXISTS "authenticated_can_select_pawnshops" ON pawnshops;

-- Drop all profiles policies
DROP POLICY IF EXISTS "super_admin_full_profiles_access" ON profiles;
DROP POLICY IF EXISTS "branch_admin_select_own_profiles" ON profiles;
DROP POLICY IF EXISTS "authenticated_can_select_profiles" ON profiles;

-- Drop all customer policies
DROP POLICY IF EXISTS "super_admin_select_all_customers" ON customer;
DROP POLICY IF EXISTS "branch_admin_select_own_customers" ON customer;
DROP POLICY IF EXISTS "authenticated_insert_customer" ON customer;
DROP POLICY IF EXISTS "authenticated_update_customer" ON customer;
DROP POLICY IF EXISTS "authenticated_delete_customer" ON customer;

-- Drop all ticket policies
DROP POLICY IF EXISTS "super_admin_select_all_tickets" ON ticket;
DROP POLICY IF EXISTS "branch_admin_select_own_tickets" ON ticket;
DROP POLICY IF EXISTS "authenticated_insert_ticket" ON ticket;
DROP POLICY IF EXISTS "authenticated_update_ticket" ON ticket;
DROP POLICY IF EXISTS "authenticated_delete_ticket" ON ticket;

-- Drop all loan policies
DROP POLICY IF EXISTS "super_admin_select_all_loans" ON loan;
DROP POLICY IF EXISTS "branch_admin_select_own_loans" ON loan;
DROP POLICY IF EXISTS "authenticated_insert_loan" ON loan;

-- Drop all inventory policies
DROP POLICY IF EXISTS "super_admin_select_all_inventory" ON inventory;
DROP POLICY IF EXISTS "branch_admin_select_own_inventory" ON inventory;

-- Drop all transaction policies
DROP POLICY IF EXISTS "super_admin_select_all_transactions" ON "transaction";
DROP POLICY IF EXISTS "branch_admin_select_own_transactions" ON "transaction";
DROP POLICY IF EXISTS "authenticated_select_transactions" ON "transaction";

-- ============================================================================
-- STEP 3: CREATE NEW SIMPLIFIED RLS POLICIES
-- ============================================================================

-- ============================================================================
-- PAWNSHOPS TABLE - SIMPLIFIED
-- ============================================================================
-- Super Admin: Allow ALL access
CREATE POLICY "pawnshops_super_admin_all_access"
ON pawnshops
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
);

-- Branch Admin: Allow access to their own pawnshop
CREATE POLICY "pawnshops_branch_admin_own"
ON pawnshops
FOR ALL
TO authenticated
USING (
  id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
);

-- ============================================================================
-- PROFILES TABLE - SIMPLIFIED
-- ============================================================================
-- Super Admin: Allow ALL access
CREATE POLICY "profiles_super_admin_all_access"
ON profiles
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
);

-- All users: See profiles in their pawnshop
CREATE POLICY "profiles_see_own_pawnshop_profiles"
ON profiles
FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
);

-- ============================================================================
-- CUSTOMER TABLE - SIMPLIFIED
-- ============================================================================
-- Super Admin: Allow ALL access
CREATE POLICY "customer_super_admin_all_access"
ON customer
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
);

-- Branch Admin: Access own pawnshop customers
CREATE POLICY "customer_branch_admin_own_pawnshop"
ON customer
FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
);

-- ============================================================================
-- TICKET TABLE - SIMPLIFIED
-- ============================================================================
-- Super Admin: Allow ALL access
CREATE POLICY "ticket_super_admin_all_access"
ON ticket
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
);

-- Branch Admin: Access own pawnshop tickets
CREATE POLICY "ticket_branch_admin_own_pawnshop"
ON ticket
FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
);

-- ============================================================================
-- LOAN TABLE - SIMPLIFIED
-- ============================================================================
-- Super Admin: Allow ALL access
CREATE POLICY "loan_super_admin_all_access"
ON loan
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
);

-- Branch Admin: Access own pawnshop loans
CREATE POLICY "loan_branch_admin_own_pawnshop"
ON loan
FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
);

-- ============================================================================
-- INVENTORY TABLE - SIMPLIFIED
-- ============================================================================
-- Super Admin: Allow ALL access
CREATE POLICY "inventory_super_admin_all_access"
ON inventory
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'SUPER_ADMIN'
  )
);

-- Branch Admin: Access own pawnshop inventory
CREATE POLICY "inventory_branch_admin_own_pawnshop"
ON inventory
FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid())
);

-- ============================================================================
-- TRANSACTION TABLE - ALLOW ALL AUTHENTICATED
-- ============================================================================
-- Note: Transaction table doesn't have pawnshop_id, so we allow all authenticated users
CREATE POLICY "transaction_all_authenticated"
ON "transaction"
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ============================================================================
-- VERIFICATION QUERIES - RUN THESE TO TEST
-- ============================================================================
-- Check if RLS is enabled on all tables
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('pawnshops', 'profiles', 'customer', 'ticket', 'loan', 'inventory', 'transaction')
ORDER BY tablename;

-- Check policies on pawnshops table
SELECT policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'pawnshops'
ORDER BY policyname;

-- Check profiles data
SELECT id, email, role, pawnshop_id
FROM profiles
ORDER BY created_at DESC
LIMIT 10;
