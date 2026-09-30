-- Online pawn applications: a quote and a booking, not a loan.
--
-- A loan requires physical possession of the collateral, so an application can
-- never become one on its own. What it does is move everything that does *not*
-- need the item in the customer's hands - pricing, identity evidence, compliance
-- - ahead of the visit, and hold the quoted rate for a window.
--
-- The priced figures are stored rather than recomputed. A rate table that
-- changes tomorrow must not silently change what an application said yesterday,
-- the same reason the ticket stores `appraised_value` and `interest_rate`.
--
-- `kyc_status` starts at PENDING, not VERIFIED: capturing documents is not
-- verification. A reviewer adjudicates and records who and when, in
-- `reviewed_by` / `reviewed_at`.

CREATE TYPE "public"."PawnReservationStatus" AS ENUM (
  'PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'CONVERTED', 'DECLINED'
);

CREATE TABLE "public"."pawn_reservation" (
  "id"                       UUID         NOT NULL,
  "reference"                TEXT         NOT NULL,
  "status"                   "public"."PawnReservationStatus" NOT NULL DEFAULT 'PENDING',
  "pawnshop_id"              UUID         NOT NULL,
  "branch_id"                INTEGER,
  "expires_at"               TIMESTAMP(3) NOT NULL,

  "customer_name"            TEXT         NOT NULL,
  "contact_number"           TEXT         NOT NULL,
  "address"                  TEXT         NOT NULL,

  "item_category"            TEXT         NOT NULL,
  "item_description"         TEXT,
  "weight_grams"             DOUBLE PRECISION NOT NULL,
  "purity_percent"           DOUBLE PRECISION,
  "photo_urls"               JSON         NOT NULL DEFAULT '[]',

  "appraised_value"          DOUBLE PRECISION NOT NULL,
  "recommended_loan_amount"  DOUBLE PRECISION NOT NULL,
  "gram_rate"                DOUBLE PRECISION NOT NULL,
  "ltv_ratio"                DOUBLE PRECISION NOT NULL,
  "term_days"                INTEGER      NOT NULL,
  "maturity_date"            TIMESTAMP(3) NOT NULL,
  "grace_period_days"        INTEGER      NOT NULL,
  "below_statutory_minimum"  BOOLEAN      NOT NULL DEFAULT false,
  "risk_score"               INTEGER,
  "risk_band"                TEXT,
  "rate_summary"             JSON,

  "id_type"                  "public"."KycIdType",
  "id_number"                TEXT,
  "id_front_url"             TEXT,
  "id_back_url"              TEXT,
  "selfie_url"               TEXT,
  "kyc_status"               "public"."KycStatus" NOT NULL DEFAULT 'PENDING',
  "verification_data"        JSON,

  "reviewed_by"              UUID,
  "reviewed_at"              TIMESTAMP(3),
  "rejection_reason"         TEXT,
  "converted_ticket_id"      INTEGER,

  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pawn_reservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pawn_reservation_reference_key"
  ON "public"."pawn_reservation"("reference");
CREATE INDEX "pawn_reservation_pawnshop_id_status_idx"
  ON "public"."pawn_reservation"("pawnshop_id", "status");
CREATE INDEX "pawn_reservation_status_expires_at_idx"
  ON "public"."pawn_reservation"("status", "expires_at");

ALTER TABLE "public"."pawn_reservation"
  ADD CONSTRAINT "pawn_reservation_pawnshop_id_fkey"
  FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."pawn_reservation"
  ADD CONSTRAINT "pawn_reservation_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "public"."pawn_reservation" IS
  'An online pawn application: a quoted figure and a booking. Not a loan - a loan requires physical possession of the collateral.';
COMMENT ON COLUMN "public"."pawn_reservation"."kyc_status" IS
  'Starts PENDING. Capturing identity documents is not verification; a reviewer adjudicates.';
COMMENT ON COLUMN "public"."pawn_reservation"."recommended_loan_amount" IS
  'Snapshot of the quote at the moment it was given, not recomputed from today''s rate table.';
