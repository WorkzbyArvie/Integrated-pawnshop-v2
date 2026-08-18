-- AlterTable
ALTER TABLE "public"."subscriptions" ADD COLUMN IF NOT EXISTS "pending_tier" "public"."SubscriptionTier";
