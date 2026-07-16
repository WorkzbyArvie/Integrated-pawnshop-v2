-- ============================================================================
-- DISABLE ALL RLS AND DROP ALL POLICIES FOR FUNCTIONALITY TESTING
-- ============================================================================
-- Purpose: Temporarily disable all RLS policies to allow anon key access
--          while we focus on functionality. Security will be re-enabled later.
-- ============================================================================

-- 1. DISABLE RLS ON ALL TABLES
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pawnshops DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.category DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.systemsettings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.activitylog DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invites DISABLE ROW LEVEL SECURITY;

-- 2. DROP ALL EXISTING POLICIES (optional, but safe cleanup)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all access for testing" ON public.profiles;
DROP POLICY IF EXISTS "Allow service role full access" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Super Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_see_own_pawnshop_profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_all_access" ON public.profiles;

DROP POLICY IF EXISTS "pawnshops_branch_admin_own" ON public.pawnshops;
DROP POLICY IF EXISTS "pawnshops_super_admin_all_access" ON public.pawnshops;

DROP POLICY IF EXISTS "customer_branch_admin_own_pawnshop" ON public.customer;
DROP POLICY IF EXISTS "customer_super_admin_all_access" ON public.customer;

DROP POLICY IF EXISTS "ticket_branch_admin_own_pawnshop" ON public.ticket;
DROP POLICY IF EXISTS "ticket_super_admin_all_access" ON public.ticket;

DROP POLICY IF EXISTS "loan_branch_admin_own_pawnshop" ON public.loan;
DROP POLICY IF EXISTS "loan_super_admin_all_access" ON public.loan;

DROP POLICY IF EXISTS "inventory_branch_admin_own_pawnshop" ON public.inventory;
DROP POLICY IF EXISTS "inventory_super_admin_all_access" ON public.inventory;

DROP POLICY IF EXISTS "transaction_all_authenticated" ON public.transaction;

-- 3. VERIFY RLS IS DISABLED
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
