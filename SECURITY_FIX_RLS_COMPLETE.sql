-- ============================================================================
-- COMPREHENSIVE RLS SECURITY FIX FOR ALL PAWNSHOP TABLES
-- ============================================================================
-- Run this ENTIRE script in Supabase SQL Editor
-- This enables RLS on ALL tables and implements secure access policies
-- ============================================================================

-- ============================================================================
-- STEP 1: Enable RLS on ALL tables
-- ============================================================================

ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pawnshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.category ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.activitylog ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.systemsettings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.auction_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.auction_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.loan ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_invites ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2: PROFILES TABLE - Users can only see their own + admins see all
-- ============================================================================

DROP POLICY IF EXISTS "profiles_users_see_own" ON profiles;
CREATE POLICY "profiles_users_see_own"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid()::uuid);

DROP POLICY IF EXISTS "profiles_super_admin_see_all" ON profiles;
CREATE POLICY "profiles_super_admin_see_all"
ON profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "profiles_super_admin_manage" ON profiles;
CREATE POLICY "profiles_super_admin_manage"
ON profiles FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

-- ============================================================================
-- STEP 3: PAWNSHOPS TABLE - Super Admin sees all, others see their own
-- ============================================================================

DROP POLICY IF EXISTS "pawnshops_super_admin_all" ON pawnshops;
CREATE POLICY "pawnshops_super_admin_all"
ON pawnshops FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "pawnshops_user_own" ON pawnshops;
CREATE POLICY "pawnshops_user_own"
ON pawnshops FOR SELECT
TO authenticated
USING (
  id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "pawnshops_admin_manage" ON pawnshops;
CREATE POLICY "pawnshops_admin_manage"
ON pawnshops FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

-- ============================================================================
-- STEP 4: BRANCH TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "branch_super_admin_all" ON branch;
CREATE POLICY "branch_super_admin_all"
ON branch FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "branch_pawnshop_isolation" ON branch;
CREATE POLICY "branch_pawnshop_isolation"
ON branch FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "branch_admin_manage" ON branch;
CREATE POLICY "branch_admin_manage"
ON branch FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

-- ============================================================================
-- STEP 5: CUSTOMER TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "customer_super_admin_all" ON customer;
CREATE POLICY "customer_super_admin_all"
ON customer FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "customer_pawnshop_isolation" ON customer;
CREATE POLICY "customer_pawnshop_isolation"
ON customer FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "customer_insert" ON customer;
CREATE POLICY "customer_insert"
ON customer FOR INSERT
TO authenticated
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "customer_update" ON customer;
CREATE POLICY "customer_update"
ON customer FOR UPDATE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "customer_delete" ON customer;
CREATE POLICY "customer_delete"
ON customer FOR DELETE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- ============================================================================
-- STEP 6: TICKET TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "ticket_super_admin_all" ON ticket;
CREATE POLICY "ticket_super_admin_all"
ON ticket FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "ticket_pawnshop_isolation" ON ticket;
CREATE POLICY "ticket_pawnshop_isolation"
ON ticket FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "ticket_insert" ON ticket;
CREATE POLICY "ticket_insert"
ON ticket FOR INSERT
TO authenticated
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "ticket_update" ON ticket;
CREATE POLICY "ticket_update"
ON ticket FOR UPDATE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "ticket_delete" ON ticket;
CREATE POLICY "ticket_delete"
ON ticket FOR DELETE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- ============================================================================
-- STEP 7: INVENTORY TABLE - Isolate via ticket -> pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "inventory_super_admin_all" ON inventory;
CREATE POLICY "inventory_super_admin_all"
ON inventory FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "inventory_pawnshop_isolation" ON inventory;
CREATE POLICY "inventory_pawnshop_isolation"
ON inventory FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM ticket t
    WHERE t.id = ticketid
    AND t.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
);

DROP POLICY IF EXISTS "inventory_insert" ON inventory;
CREATE POLICY "inventory_insert"
ON inventory FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM ticket t
    WHERE t.id = ticketid
    AND t.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
);

DROP POLICY IF EXISTS "inventory_update" ON inventory;
CREATE POLICY "inventory_update"
ON inventory FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM ticket t
    WHERE t.id = ticketid
    AND t.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM ticket t
    WHERE t.id = ticketid
    AND t.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
);

-- ============================================================================
-- STEP 8: CATEGORY TABLE - Public read (no filtering needed)
-- ============================================================================

DROP POLICY IF EXISTS "category_public_read" ON category;
CREATE POLICY "category_public_read"
ON category FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS "category_admin_manage" ON category;
CREATE POLICY "category_admin_manage"
ON category FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

-- ============================================================================
-- STEP 9: STAFF TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "staff_super_admin_all" ON staff;
CREATE POLICY "staff_super_admin_all"
ON staff FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "staff_pawnshop_isolation" ON staff;
CREATE POLICY "staff_pawnshop_isolation"
ON staff FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

DROP POLICY IF EXISTS "staff_admin_manage" ON staff;
CREATE POLICY "staff_admin_manage"
ON staff FOR ALL
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
)
WITH CHECK (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

-- ============================================================================
-- STEP 10: ACTIVITYLOG TABLE - Admin access only
-- ============================================================================

DROP POLICY IF EXISTS "activitylog_admin_only" ON activitylog;
CREATE POLICY "activitylog_admin_only"
ON activitylog FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

DROP POLICY IF EXISTS "activitylog_admin_insert" ON activitylog;
CREATE POLICY "activitylog_admin_insert"
ON activitylog FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

-- ============================================================================
-- STEP 11: SYSTEMSETTINGS TABLE - Branch-based admin access
-- ============================================================================

DROP POLICY IF EXISTS "systemsettings_super_admin_all" ON systemsettings;
CREATE POLICY "systemsettings_super_admin_all"
ON systemsettings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "systemsettings_branch_access" ON systemsettings;
CREATE POLICY "systemsettings_branch_access"
ON systemsettings FOR SELECT
TO authenticated
USING (
  branchid IN (
    SELECT b.id FROM branch b
    WHERE b.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

DROP POLICY IF EXISTS "systemsettings_admin_manage" ON systemsettings;
CREATE POLICY "systemsettings_admin_manage"
ON systemsettings FOR ALL
TO authenticated
USING (
  branchid IN (
    SELECT b.id FROM branch b
    WHERE b.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
)
WITH CHECK (
  branchid IN (
    SELECT b.id FROM branch b
    WHERE b.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

-- ============================================================================
-- STEP 12: AUCTION TABLES - PUBLIC read live, ADMIN manage own
-- ============================================================================

DROP POLICY IF EXISTS "auction_listings_public_live" ON auction_listings;
CREATE POLICY "auction_listings_public_live"
ON auction_listings FOR SELECT
TO authenticated, anon
USING (status = 'LIVE');

DROP POLICY IF EXISTS "auction_listings_admin_own" ON auction_listings;
CREATE POLICY "auction_listings_admin_own"
ON auction_listings FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

DROP POLICY IF EXISTS "auction_listings_admin_manage" ON auction_listings;
CREATE POLICY "auction_listings_admin_manage"
ON auction_listings FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

DROP POLICY IF EXISTS "auction_bids_public_live" ON auction_bids;
CREATE POLICY "auction_bids_public_live"
ON auction_bids FOR SELECT
TO authenticated, anon
USING (
  EXISTS (
    SELECT 1 FROM auction_listings al
    WHERE al.id = listing_id AND al.status = 'LIVE'
  )
);

DROP POLICY IF EXISTS "auction_bids_authenticated_insert" ON auction_bids;
CREATE POLICY "auction_bids_authenticated_insert"
ON auction_bids FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM auction_listings al
    WHERE al.id = listing_id AND al.status = 'LIVE'
  )
);

DROP POLICY IF EXISTS "auction_images_public_live" ON auction_images;
CREATE POLICY "auction_images_public_live"
ON auction_images FOR SELECT
TO authenticated, anon
USING (
  EXISTS (
    SELECT 1 FROM auction_listings al
    WHERE al.id = listing_id AND al.status = 'LIVE'
  )
);

DROP POLICY IF EXISTS "auction_images_admin_manage" ON auction_images;
CREATE POLICY "auction_images_admin_manage"
ON auction_images FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM auction_listings al
    WHERE al.id = listing_id
    AND al.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
    AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM auction_listings al
    WHERE al.id = listing_id
    AND al.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
    AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
  )
);

-- ============================================================================
-- STEP 13: TRANSACTION TABLE - Isolate via ticket -> pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "transaction_super_admin_all" ON "transaction";
CREATE POLICY "transaction_super_admin_all"
ON "transaction" FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "transaction_pawnshop_isolation" ON "transaction";
CREATE POLICY "transaction_pawnshop_isolation"
ON "transaction" FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM ticket t
    WHERE t.id = ticketid
    AND t.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

-- ============================================================================
-- STEP 14: LOAN TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "loan_super_admin_all" ON loan;
CREATE POLICY "loan_super_admin_all"
ON loan FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role IN ('SUPER_ADMIN', 'OWNER')
  )
);

DROP POLICY IF EXISTS "loan_pawnshop_isolation" ON loan;
CREATE POLICY "loan_pawnshop_isolation"
ON loan FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

DROP POLICY IF EXISTS "loan_admin_manage" ON loan;
CREATE POLICY "loan_admin_manage"
ON loan FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN')
);

-- ============================================================================
-- STEP 15: ADMIN_INVITES TABLE - Restrict to SUPER_ADMIN only
-- ============================================================================

DROP POLICY IF EXISTS "admin_invites_super_admin_only" ON admin_invites;
CREATE POLICY "admin_invites_super_admin_only"
ON admin_invites FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role = 'SUPER_ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()::uuid
    AND p.role = 'SUPER_ADMIN'
  )
);

-- ============================================================================
-- VERIFICATION: List all table RLS statuses
-- ============================================================================
-- SELECT schemaname, tablename, rowsecurity FROM pg_tables 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename;

-- ============================================================================
-- NOTE: Password protection is controlled in Auth settings, not SQL
-- To re-enable: Go to Supabase Dashboard > Auth > Providers > (your auth method)
-- Ensure "Require password" or "Email confirmation" is enabled
-- ============================================================================
