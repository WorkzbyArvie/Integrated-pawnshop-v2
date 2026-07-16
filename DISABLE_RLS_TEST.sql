-- ============================================================================
-- DISABLE RLS TEMPORARILY TO TEST
-- ============================================================================
-- If RLS is causing issues, disabling it will help us debug
-- Run this to see if the app works without RLS

-- Disable RLS on all tables
ALTER TABLE pawnshops DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE customer DISABLE ROW LEVEL SECURITY;
ALTER TABLE ticket DISABLE ROW LEVEL SECURITY;
ALTER TABLE loan DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction" DISABLE ROW LEVEL SECURITY;
ALTER TABLE category DISABLE ROW LEVEL SECURITY;

-- Verify RLS is disabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('pawnshops', 'profiles', 'customer', 'ticket', 'loan', 'inventory', 'transaction', 'category')
ORDER BY tablename;
