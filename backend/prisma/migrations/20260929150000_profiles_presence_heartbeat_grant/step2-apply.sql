-- =============================================================================
-- PawnGold - STEP 2: apply only if step 1 returned CONFIRMED.
-- =============================================================================
--
-- The presence heartbeat.
--
-- The dashboard writes `is_online` and `last_seen_at` on the signed-in user's own
-- `profiles` row, straight from the browser to PostgREST. That is the only write
-- the browser makes to any locked table.
--
-- The lock migration granted exactly that and nothing more:
--
--     CREATE POLICY "profiles_update_own" ON public.profiles
--       FOR UPDATE TO authenticated
--       USING (id = auth.uid()) WITH CHECK (id = auth.uid());
--
--     REVOKE ALL ON public.profiles FROM anon, authenticated;
--     GRANT UPDATE (is_online, last_seen_at) ON public.profiles TO authenticated;
--
-- A Postgres UPDATE policy is evaluated by reading the row it is deciding
-- about, and this one qualifies on the `id` column. `REVOKE ALL` removed table-
-- level SELECT, and the column grant covers only the two presence columns, so
-- `authenticated` cannot read `id`. The policy therefore cannot be evaluated and
-- every heartbeat is refused. Observed in the deployed app as:
--
--     PATCH https://<project>.supabase.co/rest/v1/profiles?id=eq.<uuid>
--     403 (Forbidden)
--
-- This fails closed and quietly, which is why it is easy to miss: no user can
-- ever be marked online, so "STAFF ON DUTY" reads 0 and the whole platform looks
-- unstaffed, with no error anywhere the staff would notice.
--
-- The grant below is column-scoped to `id` on purpose.
--
--   * It exposes a UUID the caller already knows - it is `auth.uid()`, the
--     subject of their own token. It reveals nothing about any other row.
--   * It does NOT reopen the breach condition the lock closed. The lock's
--     containment rested on there being no anon/authenticated read path into the
--     six tables; a SELECT on one column of one of them, pinned to the caller's
--     own id by the policy, is not a read path. It cannot enumerate rows, and it
--     cannot return another user's id, email, role or tenant.
--   * It must NOT be widened. `role` is the column that matters: a
--     table-level or multi-column SELECT including `role` would let a signed-in
--     STAFF read roles across the platform, and a broader UPDATE would let them
--     write their own role to OWNER and satisfy every @Roles() check in the
--     backend. rls-containment.spec.ts asserts this grant stays single-column and
--     name-free, and fails if it ever widens to include `role`.
--
-- If step 1 returns REFUTED, do not run this. It would be granting something the
-- role can already do, and the real cause of the 403 is elsewhere.
-- =============================================================================

BEGIN;

GRANT SELECT (id) ON public.profiles TO authenticated;

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification - a single statement, one grid. Expected one row:
--   authenticated_select_on_id = 1
--   authenticated_select_on_role = 0   <- the column that must stay unreachable
--   profiles_force_rls = t
--   authenticated_update_columns = 2   <- is_online, last_seen_at. Not 3.
-- -----------------------------------------------------------------------------

SELECT
  (SELECT count(*) FROM information_schema.column_privileges
     WHERE grantee = 'authenticated' AND table_schema = 'public'
       AND table_name = 'profiles' AND column_name = 'id') AS authenticated_select_on_id,
  (SELECT count(*) FROM information_schema.column_privileges
     WHERE grantee = 'authenticated' AND table_schema = 'public'
       AND table_name = 'profiles' AND column_name = 'role') AS authenticated_select_on_role,
  (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'profiles') AS profiles_force_rls,
  (SELECT count(DISTINCT column_name) FROM information_schema.column_privileges
     WHERE grantee = 'authenticated' AND table_schema = 'public'
       AND table_name = 'profiles' AND privilege_type = 'UPDATE') AS authenticated_update_columns,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles') AS policies_on_profiles;

-- -----------------------------------------------------------------------------
-- Rollback, if the heartbeat must be withdrawn again. Note the consequence:
-- presence tracking stops working again and every user reads offline. This is
-- the correct failure direction - denied, not permissive.
--
--   REVOKE SELECT (id) ON public.profiles FROM authenticated;
--
-- Do NOT run the Postgres suggestion to add back table grants. On a 42501
-- Postgres emits a generic `HINT: Grant SELECT ... TO anon`. That hint is
-- boilerplate, it is not specific to this policy, and following it would
-- re-create the breach the lock closed. RLS would still deny, but the only
-- remaining barrier would be a single policy someone could later drop.
-- =============================================================================
