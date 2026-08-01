-- Compliance Document Verification System
-- Run this SQL in Supabase SQL Editor

-- 1. Create enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComplianceDocType') THEN
    CREATE TYPE "ComplianceDocType" AS ENUM (
      'DTI_REGISTRATION', 'SEC_REGISTRATION', 'MAYORS_PERMIT', 'BIR_COR',
      'BSP_LICENSE', 'AMLC_REGISTRATION', 'GOVERNMENT_ID', 'PROOF_OF_ADDRESS',
      'FIRE_SAFETY_CERT', 'OCCUPANCY_PERMIT'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ComplianceDocStatus') THEN
    CREATE TYPE "ComplianceDocStatus" AS ENUM (
      'UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'
    );
  END IF;
END $$;

-- 2. Create table
CREATE TABLE IF NOT EXISTS "pawnshop_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "pawnshop_id" UUID NOT NULL REFERENCES "pawnshops"("id") ON DELETE CASCADE,
  "document_type" "ComplianceDocType" NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_url" TEXT NOT NULL,
  "file_size" INTEGER,
  "status" "ComplianceDocStatus" NOT NULL DEFAULT 'UPLOADED',
  "expiry_date" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "verified_by" UUID REFERENCES "profiles"("id"),
  "verified_at" TIMESTAMP(3),
  "uploaded_by" UUID NOT NULL REFERENCES "profiles"("id"),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS "pawnshop_documents_pawnshop_id_document_type_idx"
  ON "pawnshop_documents"("pawnshop_id", "document_type");

CREATE INDEX IF NOT EXISTS "pawnshop_documents_pawnshop_id_status_idx"
  ON "pawnshop_documents"("pawnshop_id", "status");
