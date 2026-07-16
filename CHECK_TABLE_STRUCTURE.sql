-- ============================================================================
-- CHECK ACTUAL TABLE NAMES IN DATABASE
-- ============================================================================
-- Run this to see what the actual table names and relationships are

-- List all tables in public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- Check the pawnshops table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'pawnshops'
ORDER BY ordinal_position;

-- Check the profiles table structure  
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- Check the customer table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'customer'
ORDER BY ordinal_position;

-- Check the ticket table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ticket'
ORDER BY ordinal_position;
