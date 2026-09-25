CREATE TABLE IF NOT EXISTS "public"."credential_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_email" TEXT,
    "marked_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credential_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credential_states_profile_id_key"
    ON "public"."credential_states"("profile_id");

CREATE INDEX IF NOT EXISTS "credential_states_must_change_password_idx"
    ON "public"."credential_states"("must_change_password");

ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "actor_profile_id" UUID;
ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "target_profile_id" UUID;
ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "pawnshop_id" UUID;
ALTER TABLE "public"."security_logs" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "security_logs_pawnshop_id_created_at_idx"
    ON "public"."security_logs"("pawnshop_id", "created_at");

CREATE INDEX IF NOT EXISTS "security_logs_actor_profile_id_created_at_idx"
    ON "public"."security_logs"("actor_profile_id", "created_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'credential_states_profile_id_fkey'
          AND conrelid = '"public"."credential_states"'::regclass
    ) THEN
        ALTER TABLE "public"."credential_states"
            ADD CONSTRAINT "credential_states_profile_id_fkey"
            FOREIGN KEY ("profile_id")
            REFERENCES "public"."profiles"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

INSERT INTO "public"."credential_states" (
    "profile_id",
    "must_change_password",
    "reason",
    "marked_at",
    "created_at",
    "updated_at"
)
SELECT
    p."id",
    true,
    'PRE_ROLLOUT_LEGACY',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "public"."profiles" p
WHERE NOT EXISTS (
    SELECT 1
    FROM "public"."credential_states" cs
    WHERE cs."profile_id" = p."id"
);

INSERT INTO "public"."role_permissions" ("role", "permission_id")
SELECT v.role, p."id"
FROM (VALUES
    ('ADMIN', 'user.manage_staff'),
    ('SUPER_ADMIN', 'user.manage_staff')
) AS v(role, permission_name)
JOIN "public"."permissions" p
    ON p."name" = v.permission_name
WHERE NOT EXISTS (
    SELECT 1
    FROM "public"."role_permissions" rp
    WHERE rp."role" = v.role
      AND rp."permission_id" = p."id"
)
ON CONFLICT ("role", "permission_id") DO NOTHING;

ALTER TABLE "public"."credential_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."security_logs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "public"."credential_states" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "public"."security_logs" FROM anon, authenticated;
