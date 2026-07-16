-- Add missing branding relation column expected by Prisma schema
ALTER TABLE "public"."pawnshops"
ADD COLUMN IF NOT EXISTS "branding_id" INTEGER;

CREATE INDEX IF NOT EXISTS "pawnshops_branding_id_idx"
ON "public"."pawnshops" ("branding_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'brandings'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pawnshops_branding_id_fkey'
      AND conrelid = 'public.pawnshops'::regclass
  ) THEN
    ALTER TABLE "public"."pawnshops"
    ADD CONSTRAINT "pawnshops_branding_id_fkey"
    FOREIGN KEY ("branding_id")
    REFERENCES "public"."brandings"("id")
    ON UPDATE CASCADE
    ON DELETE NO ACTION;
  END IF;
END
$$;
