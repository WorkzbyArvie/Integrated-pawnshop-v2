-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "public"."SystemReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'HIDDEN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."system_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "pawnshop_id" UUID,
    "rating" INTEGER NOT NULL,
    "title" VARCHAR(160),
    "comment" VARCHAR(2000) NOT NULL,
    "status" "public"."SystemReviewStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_reviews_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."system_reviews"
    ADD CONSTRAINT "system_reviews_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."system_reviews"
    ADD CONSTRAINT "system_reviews_pawnshop_id_fkey"
    FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "system_reviews_profile_id_key" ON "public"."system_reviews"("profile_id");

-- CreateIndex
CREATE INDEX "system_reviews_pawnshop_id_idx" ON "public"."system_reviews"("pawnshop_id");

-- CreateIndex
CREATE INDEX "system_reviews_status_created_at_idx" ON "public"."system_reviews"("status", "created_at");