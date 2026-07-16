-- ============================================================================
-- RLS POLICIES FOR PAWNSHOP SYSTEM
-- ============================================================================
-- This script sets up Row Level Security policies for role-based access control
-- Run this in your Supabase SQL editor (Database > SQL Editor)

-- =========================================================================
-- 8. AUCTION TABLES - Public read for live listings, admin manage own
-- =========================================================================

ALTER TABLE auction_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_images ENABLE ROW LEVEL SECURITY;

-- Auction listings: public can read live listings
DROP POLICY IF EXISTS "auction_listings_public_select_live" ON auction_listings;
CREATE POLICY "auction_listings_public_select_live"
ON auction_listings
FOR SELECT
TO anon, authenticated
USING (
  status = 'LIVE'
);

-- Auction listings: pawnshop admins can manage their own listings
DROP POLICY IF EXISTS "auction_listings_admin_manage" ON auction_listings;
CREATE POLICY "auction_listings_admin_manage"
ON auction_listings
FOR ALL
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN', 'ADMIN')
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN', 'ADMIN')
);

-- Auction images: public can read images of live listings
DROP POLICY IF EXISTS "auction_images_public_select_live" ON auction_images;
CREATE POLICY "auction_images_public_select_live"
ON auction_images
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM auction_listings l
    WHERE l.id = listing_id AND l.status = 'LIVE'
  )
);

-- Auction images: pawnshop admins can manage images for their listings
DROP POLICY IF EXISTS "auction_images_admin_manage" ON auction_images;
CREATE POLICY "auction_images_admin_manage"
ON auction_images
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM auction_listings l
    WHERE l.id = listing_id
    AND l.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN', 'ADMIN')
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM auction_listings l
    WHERE l.id = listing_id
    AND l.pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  )
  AND (SELECT role FROM profiles WHERE id = auth.uid()::uuid) IN ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'BRANCH_ADMIN', 'ADMIN')
);

-- Auction bids: authenticated users can place bids on live listings
DROP POLICY IF EXISTS "auction_bids_authenticated_insert" ON auction_bids;
CREATE POLICY "auction_bids_authenticated_insert"
ON auction_bids
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM auction_listings l
    WHERE l.id = listing_id AND l.status = 'LIVE'
  )
);

-- Auction bids: public can read bids for live listings
DROP POLICY IF EXISTS "auction_bids_public_select_live" ON auction_bids;
CREATE POLICY "auction_bids_public_select_live"
ON auction_bids
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM auction_listings l
    WHERE l.id = listing_id AND l.status = 'LIVE'
  )
);

-- ============================================================================
-- 1. PAWNSHOPS TABLE - Allow Super Admin to see all, Branch Admin to see their own
-- ============================================================================

-- DROP existing policies if they exist
DROP POLICY IF EXISTS "super_admin_select_all_pawnshops" ON pawnshops;
DROP POLICY IF EXISTS "branch_admin_select_own_pawnshop" ON pawnshops;
DROP POLICY IF EXISTS "authenticated_can_select_pawnshops" ON pawnshops;

-- Policy: Super Admin can select all pawnshops
CREATE POLICY "super_admin_select_all_pawnshops"
ON pawnshops
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- Policy: Branch Admin can select their assigned pawnshop
CREATE POLICY "branch_admin_select_own_pawnshop"
ON pawnshops
FOR SELECT
TO authenticated
USING (
  id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  OR (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- ============================================================================
-- 2. PROFILES TABLE - Allow users to see all profiles (for staff management)
-- ============================================================================

DROP POLICY IF EXISTS "authenticated_can_select_profiles" ON profiles;
DROP POLICY IF EXISTS "super_admin_full_profiles_access" ON profiles;
DROP POLICY IF EXISTS "branch_admin_select_own_profiles" ON profiles;

-- Policy: Allow users to read their own profile (required for login)
CREATE POLICY "users_see_own_profile"
ON profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()::uuid
);

-- Policy: Super Admin has full access to all profiles
CREATE POLICY "super_admin_full_profiles_access"
ON profiles
FOR ALL
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- Policy: Branch Admin can see profiles in their pawnshop
CREATE POLICY "branch_admin_select_own_profiles"
ON profiles
FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
  AND pawnshop_id IS NOT NULL
);

-- ============================================================================
-- 3. CUSTOMER TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "super_admin_select_all_customers" ON customer;
DROP POLICY IF EXISTS "branch_admin_select_own_customers" ON customer;

-- Policy: Super Admin can select all customers
CREATE POLICY "super_admin_select_all_customers"
ON customer
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- Policy: Branch Admin can select customers in their pawnshop
CREATE POLICY "branch_admin_select_own_customers"
ON customer
FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Insert new customers (with pawnshop_id isolation)
DROP POLICY IF EXISTS "authenticated_insert_customer" ON customer;
CREATE POLICY "authenticated_insert_customer"
ON customer
FOR INSERT
TO authenticated
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Update customers in own pawnshop
DROP POLICY IF EXISTS "authenticated_update_customer" ON customer;
CREATE POLICY "authenticated_update_customer"
ON customer
FOR UPDATE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Delete customers in own pawnshop
DROP POLICY IF EXISTS "authenticated_delete_customer" ON customer;
CREATE POLICY "authenticated_delete_customer"
ON customer
FOR DELETE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- ============================================================================
-- 4. TICKET TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "super_admin_select_all_tickets" ON ticket;
DROP POLICY IF EXISTS "branch_admin_select_own_tickets" ON ticket;

-- Policy: Super Admin can select all tickets
CREATE POLICY "super_admin_select_all_tickets"
ON ticket
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- Policy: Branch Admin can select tickets in their pawnshop
CREATE POLICY "branch_admin_select_own_tickets"
ON ticket
FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Insert new tickets
DROP POLICY IF EXISTS "authenticated_insert_ticket" ON ticket;
CREATE POLICY "authenticated_insert_ticket"
ON ticket
FOR INSERT
TO authenticated
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Update tickets in own pawnshop
DROP POLICY IF EXISTS "authenticated_update_ticket" ON ticket;
CREATE POLICY "authenticated_update_ticket"
ON ticket
FOR UPDATE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
)
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Delete tickets in own pawnshop
DROP POLICY IF EXISTS "authenticated_delete_ticket" ON ticket;
CREATE POLICY "authenticated_delete_ticket"
ON ticket
FOR DELETE
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- ============================================================================
-- 5. LOAN TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "super_admin_select_all_loans" ON loan;
DROP POLICY IF EXISTS "branch_admin_select_own_loans" ON loan;

-- Policy: Super Admin can select all loans
CREATE POLICY "super_admin_select_all_loans"
ON loan
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- Policy: Branch Admin can select loans in their pawnshop
CREATE POLICY "branch_admin_select_own_loans"
ON loan
FOR SELECT
TO authenticated
USING (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- Policy: Insert new loans
DROP POLICY IF EXISTS "authenticated_insert_loan" ON loan;
CREATE POLICY "authenticated_insert_loan"
ON loan
FOR INSERT
TO authenticated
WITH CHECK (
  pawnshop_id = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- ============================================================================
-- 6. INVENTORY TABLE - Isolate by pawnshop_id
-- ============================================================================

DROP POLICY IF EXISTS "super_admin_select_all_inventory" ON inventory;
DROP POLICY IF EXISTS "branch_admin_select_own_inventory" ON inventory;

-- Policy: Super Admin can select all inventory
CREATE POLICY "super_admin_select_all_inventory"
ON inventory
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM profiles WHERE id = auth.uid()::uuid) = 'SUPER_ADMIN'
);

-- Policy: Branch Admin can select inventory in their pawnshop
-- NOTE: inventory table does not contain pawnshop_id; use ticket->pawnshop_id join
CREATE POLICY "branch_admin_select_own_inventory"
ON inventory
FOR SELECT
TO authenticated
USING (
  (SELECT pawnshop_id FROM ticket WHERE id = inventory.ticketid) = (SELECT pawnshop_id FROM profiles WHERE id = auth.uid()::uuid)
);

-- ============================================================================
-- 7. TRANSACTION TABLE - Allow authenticated users to access
-- NOTE: This table doesn't have pawnshop_id, so we allow all authenticated users
-- ============================================================================

DROP POLICY IF EXISTS "super_admin_select_all_transactions" ON "transaction";
DROP POLICY IF EXISTS "branch_admin_select_own_transactions" ON "transaction";
DROP POLICY IF EXISTS "authenticated_select_transactions" ON "transaction";

-- Policy: All authenticated users can select transactions
CREATE POLICY "authenticated_select_transactions"
ON "transaction"
FOR SELECT
TO authenticated
USING (true);

-- ============================================================================
-- FINAL: Verify RLS is enabled on all tables
-- ============================================================================

-- These commands check RLS status (for informational purposes)
-- SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- ============================================================================
-- NOTE: Make sure your profiles table has the right data:
-- - Set role = 'SUPER_ADMIN' for superadmin@pawngold.com user (pawnshop_id = NULL)
-- - Set role = 'BRANCH_ADMIN' for branch admins (pawnshop_id = their assigned pawnshop UUID)
-- ============================================================================
