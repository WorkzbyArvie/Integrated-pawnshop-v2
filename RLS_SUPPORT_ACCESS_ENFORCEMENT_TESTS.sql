-- ============================================================================
-- VALIDATION TESTS: SUPPORT-ACCESS GATED RLS
-- ============================================================================
-- Run after applying:
-- 1) TENANT_GOVERNANCE_MIGRATION.sql
-- 2) RLS_SUPER_ADMIN_SUPPORT_ACCESS_ENFORCEMENT.sql
--
-- This file provides diagnostic queries for manual verification in SQL Editor.
-- ============================================================================

-- 1) Confirm helper functions exist
SELECT proname
FROM pg_proc
WHERE proname IN (
  'app_current_user_role',
  'app_current_user_pawnshop_id',
  'app_has_active_support_access',
  'app_can_read_operational',
  'app_can_write_operational'
)
ORDER BY proname;

-- 2) Confirm policies exist on critical tables
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('pawnshops', 'customer', 'ticket', 'loan', 'transaction', 'inventory', 'support_access_requests', 'support_access_grants', 'tenant_audit_logs')
ORDER BY tablename, policyname;

-- 3) Confirm no old broad super-admin policies remain
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname ILIKE '%super_admin%all%'
ORDER BY tablename, policyname;

-- 4) Confirm grant lifecycle data shape
SELECT
  g.id,
  g.pawnshop_id,
  g.granted_to,
  g.status,
  g.granted_at,
  g.expires_at,
  g.revoked_at
FROM public.support_access_grants g
ORDER BY g.granted_at DESC
LIMIT 20;

-- 5) Confirm requests are auditable
SELECT
  a.id,
  a.pawnshop_id,
  a.actor_user_id,
  a.action,
  a.created_at,
  a.metadata
FROM public.tenant_audit_logs a
ORDER BY a.created_at DESC
LIMIT 30;
