UPDATE "public"."profiles"
SET "password_hash" = NULL
WHERE "password_hash" IS NOT NULL;
