-- Link each branch to the owner profile that created it.

ALTER TABLE "public"."branch"
ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'branch_owner_user_id_fkey'
      AND conrelid = 'public.branch'::regclass
  ) THEN
    ALTER TABLE "public"."branch"
    ADD CONSTRAINT "branch_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id")
      REFERENCES "public"."profiles"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "branch_owner_user_id_idx"
ON "public"."branch" ("owner_user_id");

-- Backfill existing branches with the current pawnshop owner where possible.
UPDATE "public"."branch" b
SET "owner_user_id" = owner_row.id
FROM (
  SELECT DISTINCT ON (p.pawnshop_id)
    p.pawnshop_id,
    p.id
  FROM "public"."profiles" p
  WHERE UPPER(COALESCE(p.role, '')) = 'OWNER'
    AND p.pawnshop_id IS NOT NULL
  ORDER BY p.pawnshop_id, p.created_at ASC, p.id ASC
) owner_row
WHERE b.pawnshop_id = owner_row.pawnshop_id
  AND b.owner_user_id IS NULL;