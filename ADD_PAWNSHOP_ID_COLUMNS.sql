-- ============================================================================
-- ADD MISSING pawnshop_id COLUMNS TO TABLES
-- ============================================================================
-- This script safely adds pawnshop_id column only if it doesn't exist
-- Some tables may already have it, so we use DO blocks to check first

-- ============================================================================
-- 1. ADD pawnshop_id TO TICKET TABLE (if not exists)
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ticket' AND column_name = 'pawnshop_id'
  ) THEN
    ALTER TABLE ticket ADD COLUMN pawnshop_id UUID REFERENCES pawnshops(id) ON DELETE CASCADE;
    CREATE INDEX idx_ticket_pawnshop_id ON ticket(pawnshop_id);
  END IF;
END $$;

-- ============================================================================
-- 2. ADD pawnshop_id TO LOAN TABLE (if not exists)
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loan' AND column_name = 'pawnshop_id'
  ) THEN
    ALTER TABLE loan ADD COLUMN pawnshop_id UUID REFERENCES pawnshops(id) ON DELETE CASCADE;
    CREATE INDEX idx_loan_pawnshop_id ON loan(pawnshop_id);
  END IF;
END $$;

-- ============================================================================
-- 3. ADD pawnshop_id TO INVENTORY TABLE (if not exists)
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = 'pawnshop_id'
  ) THEN
    ALTER TABLE inventory ADD COLUMN pawnshop_id UUID REFERENCES pawnshops(id) ON DELETE CASCADE;
    CREATE INDEX idx_inventory_pawnshop_id ON inventory(pawnshop_id);
  END IF;
END $$;

-- ============================================================================
-- 4. ADD pawnshop_id TO CATEGORY TABLE (if not exists)
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'category' AND column_name = 'pawnshop_id'
  ) THEN
    ALTER TABLE category ADD COLUMN pawnshop_id UUID REFERENCES pawnshops(id) ON DELETE CASCADE;
    CREATE INDEX idx_category_pawnshop_id ON category(pawnshop_id);
  END IF;
END $$;

-- ============================================================================
-- VERIFY COLUMNS EXIST
-- ============================================================================
-- Run this query to verify all columns exist:
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('customer', 'ticket', 'loan', 'inventory', 'category')
AND column_name = 'pawnshop_id'
ORDER BY table_name;
