-- Performance indexes for faster queue + history loading
-- 2026-08-11

-- Approval queue: cover the (pawnshop_id, status) filter together with the
-- createdAt DESC sort used by /approval-queue
CREATE INDEX "approval_records_pawnshop_id_status_created_at_idx"
  ON "public"."approval_records" ("pawnshop_id", "status", "created_at");

-- Loan full-history: payments filtered by loan_id then sorted by processed_at DESC
CREATE INDEX "payments_loan_id_processed_at_idx"
  ON "public"."payments" ("loan_id", "processed_at");

-- Customer dashboard / history: payments filtered by customer_id
CREATE INDEX "payments_customer_id_idx"
  ON "public"."payments" ("customer_id");

-- Loan full-history: penalties filtered by loan_id
CREATE INDEX "penalties_loan_id_idx"
  ON "public"."penalties" ("loan_id");
