-- Ensure branding table exists in production databases that missed earlier DDL.
CREATE TABLE IF NOT EXISTS "public"."brandings" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "primaryColor" TEXT,
  "secondaryColor" TEXT,
  "accentColor" TEXT,
  "logoUrl" TEXT,
  "faviconUrl" TEXT,
  "theme" TEXT,
  "customCss" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "brandings_name_idx"
ON "public"."brandings" ("name");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pawnshops'
      AND column_name = 'branding_id'
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
