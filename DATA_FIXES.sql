-- ============================================================================
-- DATA FIXES FOR PROFILES TABLE
-- ============================================================================
-- Run this in your Supabase SQL editor to ensure proper role assignment

-- Ensure Super Admin has NULL pawnshop_id (no branch assignment)
UPDATE profiles
SET pawnshop_id = NULL
WHERE email = 'superadmin@pawngold.com'
  AND role = 'SUPER_ADMIN';

-- Ensure BRANCH_ADMIN accounts have their pawnshop_id set
-- (Based on your current data, arviesamala2005@gmail.com should already have one)
UPDATE profiles
SET role = 'BRANCH_ADMIN'
WHERE email = 'arviesamala2005@gmail.com';

-- For any staff users, ensure role is 'STAFF'
-- Uncomment and adjust as needed:
-- UPDATE profiles SET role = 'STAFF' WHERE email = 'staff@pawngold.com';

-- Verify the updates
SELECT id, email, role, pawnshop_id, created_at FROM profiles ORDER BY created_at DESC;
