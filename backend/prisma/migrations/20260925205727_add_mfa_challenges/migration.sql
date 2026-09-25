CREATE TABLE IF NOT EXISTS "public"."mfa_email_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "session_id" TEXT,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_email_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."mfa_session_assertions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_session_assertions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mfa_email_challenges_profile_id_purpose_idx"
    ON "public"."mfa_email_challenges"("profile_id", "purpose");

CREATE INDEX IF NOT EXISTS "mfa_email_challenges_expires_at_idx"
    ON "public"."mfa_email_challenges"("expires_at");

CREATE INDEX IF NOT EXISTS "mfa_session_assertions_profile_id_session_id_idx"
    ON "public"."mfa_session_assertions"("profile_id", "session_id");

CREATE INDEX IF NOT EXISTS "mfa_session_assertions_expires_at_idx"
    ON "public"."mfa_session_assertions"("expires_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'mfa_email_challenges_profile_id_fkey'
          AND conrelid = '"public"."mfa_email_challenges"'::regclass
    ) THEN
        ALTER TABLE "public"."mfa_email_challenges"
            ADD CONSTRAINT "mfa_email_challenges_profile_id_fkey"
            FOREIGN KEY ("profile_id")
            REFERENCES "public"."profiles"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'mfa_session_assertions_profile_id_fkey'
          AND conrelid = '"public"."mfa_session_assertions"'::regclass
    ) THEN
        ALTER TABLE "public"."mfa_session_assertions"
            ADD CONSTRAINT "mfa_session_assertions_profile_id_fkey"
            FOREIGN KEY ("profile_id")
            REFERENCES "public"."profiles"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "public"."mfa_email_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."mfa_session_assertions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "public"."mfa_email_challenges" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "public"."mfa_session_assertions" FROM anon, authenticated;
