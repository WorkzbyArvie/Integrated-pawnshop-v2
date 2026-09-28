-- Re-scope the forced-password rollout to accounts that actually need it.
--
-- The original backfill in 20260925205726_add_credential_state inserted
-- `must_change_password = true` with reason `PRE_ROLLOUT_LEGACY` for every
-- existing profile, without evaluating whether the account's password was weak.
-- That forced every pre-existing user through a change they did not need, which
-- is not the intent: only accounts with a known-weak or administrator-issued
-- password should be compelled to change it.
--
-- Two corrections are applied here.
--
-- 1. Accounts that already changed their password after being marked are
--    released. The password they set is the one now in force, so continuing to
--    demand a change re-prompts a compliant user forever.
UPDATE "public"."credential_states" cs
SET "must_change_password" = false,
    "resolved_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE cs."must_change_password" = true
  AND cs."reason" = 'PRE_ROLLOUT_LEGACY'
  AND EXISTS (
        SELECT 1
        FROM "public"."security_logs" sl
        WHERE sl."profile_id" = cs."profile_id"
          AND sl."action" IN ('PASSWORD_CHANGED', 'PASSWORD_CHANGED_VIA_RECOVERY')
          AND sl."created_at" >= COALESCE(cs."marked_at", cs."created_at")
      );

-- 2. Accounts whose only basis for being flagged was the blanket rollout, and
--    which have never completed a change, are released as well. A password that
--    was not issued or reset by this system is not known to be weak, so it must
--    not block access.
--
--    Accounts provisioned or reset by an administrator keep their flag: those
--    passwords are issued by the system and are known not to be private.
UPDATE "public"."credential_states" cs
SET "must_change_password" = false,
    "reason" = NULL,
    "resolved_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE cs."must_change_password" = true
  AND cs."reason" = 'PRE_ROLLOUT_LEGACY'
  AND NOT EXISTS (
        SELECT 1
        FROM "public"."security_logs" sl
        WHERE sl."profile_id" = cs."profile_id"
          AND sl."action" IN ('PASSWORD_CHANGED', 'PASSWORD_CHANGED_VIA_RECOVERY')
      );
