-- =============================================================================
-- Lock the last six tables: RLS on, no browser read paths
-- =============================================================================
--
-- The browser no longer reads any of these tables directly. Every read that used
-- to go through the Supabase anon key now goes through the backend, which
-- resolves the tenant from the authenticated principal. So these tables get the
-- same treatment as the 42 already-hardened tables: RLS enabled and forced, with
-- no policies for anon or authenticated.
--
-- `profiles` is the one exception. The browser still writes its own presence
-- heartbeat, so it keeps a row-scoped UPDATE policy - and, critically, a
-- column-scoped grant, because a row policy alone would still let any user
-- UPDATE their own `role` to OWNER. See the notes on that grant below.
--
-- The backend is unaffected: `postgres` and `supabase_admin` both have
-- rolbypassrls = true, which overrides FORCE ROW LEVEL SECURITY.
--
-- Verified against the live project on 2026-09-29. Review the verification
-- block at the bottom before deploying.
--
-- Rollback: the statements are idempotent and reversible. To reopen a table,
-- run the commented ROLLBACK block at the very end.

-- -----------------------------------------------------------------------------
-- 1. Helper functions
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so a policy on `profiles` can read `profiles` without
-- re-triggering the policy (PostgreSQL 42P17, infinite recursion). This is the
-- same fix backend/scripts/fix-rls-recursion.js applied; it is recreated here so
-- this migration is self-contained and does not depend on that script having
-- been run.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_pawnshop_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pawnshop_id FROM public.profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_pawnshop_id() TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. customer — PII. The browser no longer reads it.
-- -----------------------------------------------------------------------------

ALTER TABLE public.customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_super_admin_all_access" ON public.customer;
DROP POLICY IF EXISTS "customer_branch_admin_own_pawnshop" ON public.customer;
DROP POLICY IF EXISTS "customer_access" ON public.customer;

-- -----------------------------------------------------------------------------
-- 3. ticket — the browser no longer reads it. (See the Realtime note below.)
-- -----------------------------------------------------------------------------

ALTER TABLE public.ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_super_admin_all_access" ON public.ticket;
DROP POLICY IF EXISTS "ticket_branch_admin_own_pawnshop" ON public.ticket;
DROP POLICY IF EXISTS "ticket_access" ON public.ticket;

-- -----------------------------------------------------------------------------
-- 4. pawnshops — feature settings and branding now come from the backend.
-- -----------------------------------------------------------------------------

ALTER TABLE public.pawnshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pawnshops FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pawnshops_super_admin_all" ON public.pawnshops;
DROP POLICY IF EXISTS "pawnshops_own_pawnshop" ON public.pawnshops;
DROP POLICY IF EXISTS "pawnshops_own" ON public.pawnshops;
DROP POLICY IF EXISTS "pawnshops_admin_all" ON public.pawnshops;
DROP POLICY IF EXISTS "pawnshops_admin_manage" ON public.pawnshops;

-- -----------------------------------------------------------------------------
-- 5. branch — the branch name now comes from the tenant-scoped branch list.
-- -----------------------------------------------------------------------------

ALTER TABLE public.branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branch_super_admin_all" ON public.branch;
DROP POLICY IF EXISTS "branch_pawnshop_isolation" ON public.branch;
DROP POLICY IF EXISTS "branch_own_pawnshop" ON public.branch;
DROP POLICY IF EXISTS "branch_admin_manage" ON public.branch;

-- -----------------------------------------------------------------------------
-- 6. loan_applications — nothing in the browser reads this table.
--    Note the plural: the browser previously queried a singular
--    `loan_application` that does not exist, so that read was 404ing silently.
-- -----------------------------------------------------------------------------

ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_applications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_applications_access" ON public.loan_applications;

-- -----------------------------------------------------------------------------
-- 7. profiles — the one table the browser still writes
-- -----------------------------------------------------------------------------
--
-- The dashboard sets `is_online` and `last_seen_at` on the signed-in user's own
-- row, so a row-scoped UPDATE policy is required.
--
-- The row policy alone is NOT sufficient. `USING (id = auth.uid())` permits
-- updating *any column* of your own row, which includes `role` - so a signed-in
-- STAFF could set their own role to OWNER and pass every `@Roles()` check in the
-- backend. The column-scoped grant below is what actually prevents that. Keep
-- the two together; neither is sufficient without the other.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_users_see_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_see_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_same_pawnshop" ON public.profiles;
DROP POLICY IF EXISTS "profiles_same_pawnshop_read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_pawnshop_isolation" ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_row" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_see_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Column-scoped write. The presence heartbeat is the only write the browser
-- makes, so it is the only write it is granted.
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT UPDATE (is_online, last_seen_at) ON public.profiles TO authenticated;

-- The browser has no read path to `profiles` any more: the session bootstrap,
-- the staff roster and the owner status all go through the backend. Leaving
-- anon/authenticated with no SELECT is deliberate.

-- -----------------------------------------------------------------------------
-- 8. No anon access anywhere in this set
-- -----------------------------------------------------------------------------

REVOKE ALL ON public.customer           FROM anon, authenticated;
REVOKE ALL ON public.ticket             FROM anon, authenticated;
REVOKE ALL ON public.pawnshops          FROM anon, authenticated;
REVOKE ALL ON public.branch             FROM anon, authenticated;
REVOKE ALL ON public.loan_applications  FROM anon, authenticated;

-- =============================================================================
-- Verification - run after applying
-- =============================================================================
--
-- Expect every count to be 0. A non-zero count means a policy survived that
-- should not have.
--
--   SET ROLE anon;
--   SELECT count(*) FROM public.customer;          -- expect 0
--   SELECT count(*) FROM public.ticket;            -- expect 0
--   SELECT count(*) FROM public.pawnshops;         -- expect 0
--   SELECT count(*) FROM public.branch;            -- expect 0
--   SELECT count(*) FROM public.loan_applications; -- expect 0
--   SELECT count(*) FROM public.profiles;          -- expect 0
--   RESET ROLE;
--
-- RLS flags, all six expected true/true:
--
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class
--   WHERE relname IN ('customer','ticket','pawnshops','branch',
--                     'loan_applications','profiles');
--
-- Confirm the backend still writes. As `postgres` (bypasses RLS):
--
--   SELECT count(*) FROM public.profiles WHERE is_online;
--
-- =============================================================================
-- Realtime behaviour change - read this before deploying
-- =============================================================================
--
-- Dashboard.tsx subscribes to `postgres_changes` on the `ticket` table. Supabase
-- Realtime applies RLS to the subscriber, so with no SELECT policy on `ticket`
-- that subscription will stop delivering events and the dashboard will stop
-- live-updating. It will still load correctly on mount and on manual refresh,
-- because the data now comes from GET /analytics/branch-activity.
--
-- This is the intended trade: live cross-tenant ticket events versus a table
-- that any holder of the public anon key can read in full. If live updates
-- matter for the defense demo, the follow-up is a Realtime broadcast fed by a
-- database trigger rather than a browser SELECT policy on `ticket`.
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
-- BEGIN;
--   DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
--   GRANT ALL ON public.profiles TO authenticated;
--   ALTER TABLE public.profiles NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
--   -- repeat DISABLE/NO FORCE for customer, ticket, pawnshops, branch,
--   -- loan_applications
--   -- re-apply the previous policies from SECURITY_FIX_RLS_COMPLETE.sql and
--   -- RLS_SUPER_ADMIN_SUPPORT_ACCESS_ENFORCEMENT.sql if they are still wanted
-- COMMIT;
--
-- Note: rolling back re-opens the cross-tenant read paths that the code-side
-- commits c8c9409..c8447a7 closed. The code is now safe without this migration,
-- so rolling back costs you the anon-key containment and nothing else.

-- -----------------------------------------------------------------------------
-- TRANSACTION
--
-- No BEGIN/COMMIT here, deliberately. Prisma wraps every migration in a
-- transaction on PostgreSQL, so a nested BEGIN is at best a no-op and at worst
-- commits Prisma's transaction before its bookkeeping runs.
--
-- The cost of getting that wrong was a deploy that failed with
-- "current transaction is aborted, commands ignored until end of transaction
-- block" instead of the real error - which was a column name that did not
-- exist. An aborted transaction reports the abort, not the cause, and Prisma
-- logs what Postgres said last. The genuine error is now visible in the log,
-- which is the only reason to care about this.
--
-- If you are running one of these by hand in the SQL editor rather than through
-- the pipeline, wrap your paste in BEGIN/COMMIT yourself.