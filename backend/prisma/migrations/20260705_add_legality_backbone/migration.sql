-- Migration: Add Legality Backbone (Phase 1 Thesis B Defense)
-- Date: July 5, 2026
-- Adds: ContractTemplates, Receipts, TOSAcceptance, LegalEntity, lifecycle status, enhanced proof types

-- 1. New Enums (created as types if not exist)
DO $$ BEGIN
  CREATE TYPE "public"."TicketLifecycleStatus" AS ENUM (
    'RECEIVED', 'APPRAISED', 'OFFER_MADE', 'CONTRACT_SIGNED', 'DISBURSED',
    'ACTIVE', 'GRACE_PERIOD', 'OVERDUE', 'REDEEMED', 'FORFEITED',
    'AUCTION_QUEUED', 'AUCTION_SOLD', 'AUCTION_UNSOLD', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ContractType" AS ENUM (
    'LOAN_CONTRACT', 'AUCTION_BIDDER_AGREEMENT', 'TERMS_OF_SERVICE',
    'CONSENT_FORM', 'REDEMPTION_RECEIPT', 'PRIVACY_POLICY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ReceiptType" AS ENUM (
    'PAYMENT', 'REDEMPTION', 'LOAN_DISBURSEMENT', 'AUCTION_SALE',
    'PENALTY', 'RENEWAL', 'SERVICE_FEE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend ProofRecordType (safe: adding values to existing enum in Postgres)
ALTER TYPE "public"."ProofRecordType" ADD VALUE IF NOT EXISTS 'RECEIPT_PROOF';
ALTER TYPE "public"."ProofRecordType" ADD VALUE IF NOT EXISTS 'BIDDER_AGREEMENT_PROOF';
ALTER TYPE "public"."ProofRecordType" ADD VALUE IF NOT EXISTS 'TOS_ACCEPTANCE_PROOF';
ALTER TYPE "public"."ProofRecordType" ADD VALUE IF NOT EXISTS 'REDEMPTION_PROOF';
ALTER TYPE "public"."ProofRecordType" ADD VALUE IF NOT EXISTS 'DISBURSEMENT_PROOF';

-- 2. New Tables

-- Contract Templates
CREATE TABLE IF NOT EXISTS "public"."contract_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "type" "public"."ContractType" NOT NULL,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "content" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '[]',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- Contract Clauses (reusable legal text)
CREATE TABLE IF NOT EXISTS "public"."contract_clauses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "type" "public"."ContractType",
  "content" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isMandatory" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contract_clauses_pkey" PRIMARY KEY ("id")
);

-- Receipts
CREATE TABLE IF NOT EXISTS "public"."receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receipt_number" TEXT NOT NULL,
  "pawnshop_id" UUID NOT NULL,
  "receipt_type" "public"."ReceiptType" NOT NULL,
  "reference_type" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "tax_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "customer_name" TEXT NOT NULL,
  "customer_address" TEXT,
  "line_items" JSONB NOT NULL DEFAULT '[]',
  "pdf_url" TEXT,
  "is_void" BOOLEAN NOT NULL DEFAULT false,
  "void_reason" TEXT,
  "generated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "generated_by" UUID NOT NULL,
  CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receipts_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE CASCADE,
  CONSTRAINT "receipts_pawnshop_id_receipt_number_key" UNIQUE ("pawnshop_id", "receipt_number")
);
CREATE INDEX IF NOT EXISTS "receipts_pawnshop_type_created_idx" ON "public"."receipts" ("pawnshop_id", "receipt_type", "generated_at");
CREATE INDEX IF NOT EXISTS "receipts_reference_idx" ON "public"."receipts" ("reference_type", "reference_id");

-- TOS Acceptance
CREATE TABLE IF NOT EXISTS "public"."tos_acceptances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "contract_type" "public"."ContractType" NOT NULL,
  "tos_version" TEXT NOT NULL,
  "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ip_address" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "tos_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tos_acceptances_profile_id_contract_type_key" UNIQUE ("profile_id", "contract_type"),
  CONSTRAINT "tos_acceptances_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "tos_acceptances_profile_idx" ON "public"."tos_acceptances" ("profile_id");

-- Legal Entity (pawnshop legal identity)
CREATE TABLE IF NOT EXISTS "public"."legal_entities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pawnshop_id" UUID NOT NULL,
  "legal_name" TEXT NOT NULL,
  "registration_number" TEXT,
  "tax_id" TEXT,
  "business_address" TEXT,
  "authorized_representative" TEXT,
  "representative_position" TEXT,
  "representative_contact" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_entities_pawnshop_id_key" UNIQUE ("pawnshop_id"),
  CONSTRAINT "legal_entities_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE CASCADE
);

-- 3. Alter existing tables

-- Add lifecycle fields to ticket
ALTER TABLE "public"."ticket"
ADD COLUMN IF NOT EXISTS "lifecycle_status" "public"."TicketLifecycleStatus" NOT NULL DEFAULT 'RECEIVED';

ALTER TABLE "public"."ticket"
ADD COLUMN IF NOT EXISTS "grace_period_end" TIMESTAMPTZ;

ALTER TABLE "public"."ticket"
ADD COLUMN IF NOT EXISTS "contract_id" UUID;

-- Add receipt_id to legal_proofs
ALTER TABLE "public"."legal_proofs"
ADD COLUMN IF NOT EXISTS "receipt_id" UUID;

CREATE INDEX IF NOT EXISTS "legal_proofs_receipt_id_idx" ON "public"."legal_proofs" ("receipt_id");

-- 4. Seed default contract templates
INSERT INTO "public"."contract_templates" ("name", "type", "version", "content", "variables") VALUES
('Pawn Loan Agreement', 'LOAN_CONTRACT', '1.0',
'<h1>PAWN LOAN AGREEMENT</h1>
<p><strong>Contract No:</strong> {{contractNumber}}</p>
<p><strong>Date:</strong> {{generatedDate}}</p>
<h2>PARTIES</h2>
<p><strong>Pawnshop:</strong> {{pawnshopLegalName}} (SEC Reg. No. {{registrationNumber}})</p>
<p><strong>Pawnee (Customer):</strong> {{customerName}} (ID: {{customerIdType}} - {{customerIdNumber}})</p>
<p><strong>Address:</strong> {{customerAddress}}</p>
<h2>TERMS AND CONDITIONS</h2>
<ol>
<li><strong>Loan Amount:</strong> PHP {{loanAmount}} — The Pawnee acknowledges receipt of the loan amount.</li>
<li><strong>Interest Rate:</strong> {{interestRate}}% per month.</li>
<li><strong>Service Fee:</strong> PHP {{serviceFee}} ({{serviceFeeRate}}% of loan amount).</li>
<li><strong>Loan Period:</strong> {{loanTerm}} days from {{loanDate}} to {{maturityDate}}.</li>
<li><strong>Grace Period:</strong> {{graceDays}} days after maturity date.</li>
<li><strong>Late Penalty:</strong> {{latePenaltyRate}}% per month of the principal after grace period.</li>
<li><strong>Collateral:</strong> {{itemDescription}} (Category: {{itemCategory}}, Estimated Weight: {{itemWeight}}).</li>
<li>The Pawnee agrees that the collateral secures the loan and all accrued interest, fees, and penalties.</li>
<li>If the loan is not redeemed within the grace period, the collateral shall be considered FORFEITED and the Pawnshop may dispose of the item through public auction or private sale without further notice.</li>
<li>Any excess from auction sale after deducting the loan amount, interest, penalties, and auction costs shall be held for the Pawnee for one (1) year.</li>
<li>The Pawnee may redeem the collateral at any time before forfeiture by paying all amounts due.</li>
<li>This agreement shall be governed by the laws of the Republic of the Philippines, particularly the Pawnshop Regulation Act.</li>
</ol>
<h2>SIGNATURES</h2>
<p><strong>Pawnee (Customer):</strong> _________________________ Date: ___________</p>
<p><strong>Pawnshop Representative:</strong> _________________________ Date: ___________</p>',
'["contractNumber","generatedDate","pawnshopLegalName","registrationNumber","customerName","customerIdType","customerIdNumber","customerAddress","loanAmount","interestRate","serviceFee","serviceFeeRate","loanTerm","loanDate","maturityDate","graceDays","latePenaltyRate","itemDescription","itemCategory","itemWeight"]'
),
('Auction Bidder Agreement', 'AUCTION_BIDDER_AGREEMENT', '1.0',
'<h1>AUCTION BIDDER AGREEMENT</h1>
<p><strong>Agreement No:</strong> {{agreementNumber}}</p>
<p><strong>Date:</strong> {{generatedDate}}</p>
<h2>PARTIES</h2>
<p><strong>Pawnshop:</strong> {{pawnshopLegalName}}</p>
<p><strong>Bidder:</strong> {{bidderName}} (User ID: {{bidderId}})</p>
<h2>TERMS AND CONDITIONS</h2>
<ol>
<li>The Bidder agrees that all bids placed are legally binding commitments to purchase.</li>
<li>The Bidder acknowledges that winning bids must be paid within {{complianceHours}} hours of auction close.</li>
<li>Failure to comply within the deadline will result in forfeiture of bidding rights and possible account suspension.</li>
<li>The Bidder confirms that they have inspected or had the opportunity to inspect the item.</li>
<li>All items are sold "AS IS" with no warranty or guarantee from the Pawnshop.</li>
<li>The Pawnshop reserves the right to reject any bid, cancel any listing, or suspend any bidder at its discretion.</li>
<li>Disputes shall be resolved in accordance with applicable Philippine laws.</li>
</ol>
<h2>ACKNOWLEDGMENT</h2>
<p>I acknowledge that I have read, understood, and agree to these terms.</p>
<p><strong>Bidder:</strong> _________________________ Date: ___________</p>',
'["agreementNumber","generatedDate","pawnshopLegalName","bidderName","bidderId","complianceHours"]'
),
('Terms of Service', 'TERMS_OF_SERVICE', '1.0',
'<h1>TERMS OF SERVICE</h1>
<p><strong>Version:</strong> {{version}}</p>
<p><strong>Last Updated:</strong> {{lastUpdated}}</p>
<h2>1. ACCEPTANCE OF TERMS</h2>
<p>By accessing and using the PawnGold platform, you agree to be bound by these Terms of Service.</p>
<h2>2. USER RESPONSIBILITIES</h2>
<p>You are responsible for maintaining the confidentiality of your account credentials.</p>
<h2>3. TRANSACTIONS</h2>
<p>All transactions conducted through the platform are legally binding. You agree to provide accurate information for all transactions.</p>
<h2>4. PRIVACY</h2>
<p>Your personal data will be handled in accordance with our Privacy Policy and the Data Privacy Act of 2012.</p>
<h2>5. LIMITATION OF LIABILITY</h2>
<p>The platform shall not be liable for any indirect, incidental, or consequential damages arising from use of the service.</p>',
'["version","lastUpdated"]'
)
ON CONFLICT DO NOTHING;

-- 5. Seed default legal clauses
INSERT INTO "public"."contract_clauses" ("name", "type", "content", "sortOrder", "isMandatory") VALUES
('Standard Forfeiture Clause', 'LOAN_CONTRACT', 'If the loan is not fully paid within the applicable grace period, the collateral shall be deemed forfeited. The pawnshop shall be entitled to sell or dispose of the item through public auction or private sale. Any proceeds exceeding the total obligation shall be held for the customer for one (1) year.', 1, true),
('Standard Interest Clause', 'LOAN_CONTRACT', 'Interest shall accrue monthly at the rate specified in this agreement. Unpaid interest shall not compound.', 2, true),
('Redemption Right Clause', 'LOAN_CONTRACT', 'The customer retains the right to redeem the collateral at any time before forfeiture by paying the principal amount plus all accrued interest, fees, and penalties.', 3, true),
('Bidder Binding Bid Clause', 'AUCTION_BIDDER_AGREEMENT', 'All bids placed are legally binding. A winning bidder who fails to complete payment shall be subject to bidding suspension and forfeiture of any deposits.', 1, true),
('As-Is Sale Clause', 'AUCTION_BIDDER_AGREEMENT', 'All auction items are sold in their current condition without any warranty, express or implied. Buyers acknowledge they have inspected or waived inspection of the item.', 2, true)
ON CONFLICT DO NOTHING;
