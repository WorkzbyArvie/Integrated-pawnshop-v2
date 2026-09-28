-- Additive only: one nullable column. No data backfill, no constraint change,
-- no rewrite of existing rows. Safe to apply to a live database.
--
-- Purpose: records when a waiting customer was told they were next.
--
-- This is what makes a no-show distinguishable from a system failure. Without
-- it, a customer marked absent after a failed notification is indistinguishable
-- from one who genuinely did not come, and the shop cannot tell the difference
-- when deciding whether to reinstate them.
--
-- Paired with the QueueStatus.NO_SHOW value, which has always existed in the
-- enum but had no writer.
ALTER TABLE "queue_tickets"
  ADD COLUMN IF NOT EXISTS "notified_at" TIMESTAMP(3);

-- The call-ahead sweep scans for waiting tickets that have not yet been warned,
-- so it needs this index to stay cheap as the table grows.
CREATE INDEX IF NOT EXISTS "queue_tickets_call_ahead_idx"
  ON "queue_tickets" ("pawnshop_id", "status", "notified_at");
