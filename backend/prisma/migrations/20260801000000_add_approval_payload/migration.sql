-- Migration: Add ApprovalRecord.payload JSONB column (Phase 8, Plan 1)
-- Date: August 1, 2026
-- Additive only: single ADD COLUMN, nullable, no backfill (table currently unused).
-- Style mirrors 20260731120000_v2_schema_baseline (schema-qualified public.* DDL).

ALTER TABLE "public"."approval_records" ADD COLUMN "payload" JSONB;
