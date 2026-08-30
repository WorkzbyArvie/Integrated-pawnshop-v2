-- AddAuctionListingDetailsAndEdits: persist item detail fields on auction listings + LISTING_EDIT approvals

ALTER TABLE "auction_listings"
  ADD COLUMN IF NOT EXISTS "item_condition" TEXT,
  ADD COLUMN IF NOT EXISTS "item_specifications" TEXT,
  ADD COLUMN IF NOT EXISTS "provenance_details" TEXT,
  ADD COLUMN IF NOT EXISTS "disclosure_notes" TEXT;

ALTER TYPE "ApprovalTargetType" ADD VALUE IF NOT EXISTS 'LISTING_EDIT';
