-- ============================================================================
-- RLS HARD ENFORCEMENT: SUPER_ADMIN SUPPORT ACCESS GATING
-- ============================================================================
-- Purpose:
-- 1) Keep SUPER_ADMIN metadata visibility, but block direct operational data access.
-- 2) Allow temporary operational read access only when support grant is ACTIVE.
-- 3) Preserve tenant isolation for non-super-admin users by pawnshop scope.
--
-- Run this AFTER:
-- - SECURITY_FIX_RLS_COMPLETE.sql
-- - TENANT_GOVERNANCE_MIGRATION.sql
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0) Ensure RLS is enabled on governance tables used by access checks
-- --------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.support_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenant_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.support_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.support_chat_messages ENABLE ROW LEVEL SECURITY;

-- Idempotency cleanup for policies created by this script
DROP POLICY IF EXISTS support_access_requests_super_admin_read ON public.support_access_requests;
DROP POLICY IF EXISTS support_access_requests_super_admin_insert ON public.support_access_requests;
DROP POLICY IF EXISTS support_access_requests_tenant_read ON public.support_access_requests;
DROP POLICY IF EXISTS support_access_requests_tenant_approve_update ON public.support_access_requests;

DROP POLICY IF EXISTS support_access_grants_super_admin_read ON public.support_access_grants;
DROP POLICY IF EXISTS support_access_grants_tenant_read ON public.support_access_grants;
DROP POLICY IF EXISTS support_access_grants_revoke ON public.support_access_grants;

DROP POLICY IF EXISTS tenant_audit_logs_super_admin_read ON public.tenant_audit_logs;
DROP POLICY IF EXISTS tenant_audit_logs_tenant_read ON public.tenant_audit_logs;
DROP POLICY IF EXISTS tenant_audit_logs_system_insert ON public.tenant_audit_logs;

DROP POLICY IF EXISTS client_registration_requests_public_insert ON public.client_registration_requests;
DROP POLICY IF EXISTS client_registration_requests_super_admin_read ON public.client_registration_requests;
DROP POLICY IF EXISTS client_registration_requests_super_admin_update ON public.client_registration_requests;

DROP POLICY IF EXISTS customer_read_tenant_or_granted_support ON public.customer;
DROP POLICY IF EXISTS customer_write_tenant_only ON public.customer;
DROP POLICY IF EXISTS customer_update_tenant_only ON public.customer;
DROP POLICY IF EXISTS customer_delete_tenant_only ON public.customer;

DROP POLICY IF EXISTS ticket_read_tenant_or_granted_support ON public.ticket;
DROP POLICY IF EXISTS ticket_write_tenant_only ON public.ticket;
DROP POLICY IF EXISTS ticket_update_tenant_only ON public.ticket;
DROP POLICY IF EXISTS ticket_delete_tenant_only ON public.ticket;

DROP POLICY IF EXISTS loan_read_tenant_or_granted_support ON public.loan;
DROP POLICY IF EXISTS loan_write_tenant_only ON public.loan;
DROP POLICY IF EXISTS loan_update_tenant_only ON public.loan;
DROP POLICY IF EXISTS loan_delete_tenant_only ON public.loan;

DROP POLICY IF EXISTS transaction_read_tenant_or_granted_support ON public."transaction";
DROP POLICY IF EXISTS transaction_write_tenant_only ON public."transaction";
DROP POLICY IF EXISTS transaction_update_tenant_only ON public."transaction";
DROP POLICY IF EXISTS transaction_delete_tenant_only ON public."transaction";

DROP POLICY IF EXISTS inventory_read_tenant_or_granted_support ON public.inventory;
DROP POLICY IF EXISTS inventory_write_tenant_only ON public.inventory;
DROP POLICY IF EXISTS inventory_update_tenant_only ON public.inventory;
DROP POLICY IF EXISTS inventory_delete_tenant_only ON public.inventory;
DROP POLICY IF EXISTS branch_read_tenant_or_granted_support ON public.branch;
DROP POLICY IF EXISTS branch_write_tenant_only ON public.branch;
DROP POLICY IF EXISTS branch_update_tenant_only ON public.branch;
DROP POLICY IF EXISTS branch_delete_tenant_only ON public.branch;
DROP POLICY IF EXISTS support_chat_conversations_read ON public.support_chat_conversations;
DROP POLICY IF EXISTS support_chat_conversations_insert ON public.support_chat_conversations;
DROP POLICY IF EXISTS support_chat_conversations_update ON public.support_chat_conversations;
DROP POLICY IF EXISTS support_chat_messages_read ON public.support_chat_messages;
DROP POLICY IF EXISTS support_chat_messages_insert ON public.support_chat_messages;

DROP POLICY IF EXISTS pawnshops_super_admin_metadata_read ON public.pawnshops;

-- --------------------------------------------------------------------------
-- 1) Helper functions for policy logic
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((SELECT role::text FROM public.profiles WHERE id = auth.uid()::uuid), 'UNKNOWN');
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_pawnshop_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT pawnshop_id FROM public.profiles WHERE id = auth.uid()::uuid;
$$;

CREATE OR REPLACE FUNCTION public.app_has_active_support_access(target_pawnshop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.support_access_grants g
    WHERE g.pawnshop_id = target_pawnshop
      AND g.granted_to = auth.uid()::uuid
      AND g.status = 'ACTIVE'
      AND g.expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.app_can_read_operational(target_pawnshop uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_role text;
  v_my_pawnshop uuid;
BEGIN
  v_role := public.app_current_user_role();
  v_my_pawnshop := public.app_current_user_pawnshop_id();

  IF v_role = 'SUPER_ADMIN' THEN
    RETURN public.app_has_active_support_access(target_pawnshop);
  END IF;

  RETURN target_pawnshop IS NOT NULL AND v_my_pawnshop = target_pawnshop;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_can_write_operational(target_pawnshop uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_role text;
  v_my_pawnshop uuid;
BEGIN
  v_role := public.app_current_user_role();
  v_my_pawnshop := public.app_current_user_pawnshop_id();

  -- SUPER_ADMIN is intentionally read-only even with support access grants.
  IF v_role = 'SUPER_ADMIN' THEN
    RETURN false;
  END IF;

  IF v_role NOT IN ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'BRANCH_ADMIN') THEN
    RETURN false;
  END IF;

  RETURN target_pawnshop IS NOT NULL AND v_my_pawnshop = target_pawnshop;
END;
$$;

-- --------------------------------------------------------------------------
-- 2) Governance table policies
-- --------------------------------------------------------------------------

-- support_access_requests
DROP POLICY IF EXISTS support_access_requests_super_admin_read ON public.support_access_requests;
DROP POLICY IF EXISTS support_access_requests_super_admin_insert ON public.support_access_requests;
DROP POLICY IF EXISTS support_access_requests_tenant_read ON public.support_access_requests;
DROP POLICY IF EXISTS support_access_requests_tenant_approve_update ON public.support_access_requests;

CREATE POLICY support_access_requests_super_admin_read
ON public.support_access_requests FOR SELECT
TO authenticated
USING (public.app_current_user_role() = 'SUPER_ADMIN');

CREATE POLICY support_access_requests_super_admin_insert
ON public.support_access_requests FOR INSERT
TO authenticated
WITH CHECK (
  public.app_current_user_role() = 'SUPER_ADMIN'
  AND requested_by = auth.uid()::uuid
);

CREATE POLICY support_access_requests_tenant_read
ON public.support_access_requests FOR SELECT
TO authenticated
USING (
  pawnshop_id = public.app_current_user_pawnshop_id()
  AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
);

CREATE POLICY support_access_requests_tenant_approve_update
ON public.support_access_requests FOR UPDATE
TO authenticated
USING (
  pawnshop_id = public.app_current_user_pawnshop_id()
  AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
)
WITH CHECK (
  pawnshop_id = public.app_current_user_pawnshop_id()
  AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
);

-- support_access_grants
DROP POLICY IF EXISTS support_access_grants_super_admin_read ON public.support_access_grants;
DROP POLICY IF EXISTS support_access_grants_tenant_read ON public.support_access_grants;
DROP POLICY IF EXISTS support_access_grants_revoke ON public.support_access_grants;

CREATE POLICY support_access_grants_super_admin_read
ON public.support_access_grants FOR SELECT
TO authenticated
USING (granted_to = auth.uid()::uuid OR public.app_current_user_role() = 'SUPER_ADMIN');

CREATE POLICY support_access_grants_tenant_read
ON public.support_access_grants FOR SELECT
TO authenticated
USING (
  pawnshop_id = public.app_current_user_pawnshop_id()
  AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
);

CREATE POLICY support_access_grants_revoke
ON public.support_access_grants FOR UPDATE
TO authenticated
USING (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
  )
)
WITH CHECK (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
  )
);

-- tenant_audit_logs
DROP POLICY IF EXISTS tenant_audit_logs_super_admin_read ON public.tenant_audit_logs;
DROP POLICY IF EXISTS tenant_audit_logs_tenant_read ON public.tenant_audit_logs;
DROP POLICY IF EXISTS tenant_audit_logs_system_insert ON public.tenant_audit_logs;

CREATE POLICY tenant_audit_logs_super_admin_read
ON public.tenant_audit_logs FOR SELECT
TO authenticated
USING (public.app_current_user_role() = 'SUPER_ADMIN');

CREATE POLICY tenant_audit_logs_tenant_read
ON public.tenant_audit_logs FOR SELECT
TO authenticated
USING (
  pawnshop_id = public.app_current_user_pawnshop_id()
  AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
);

CREATE POLICY tenant_audit_logs_system_insert
ON public.tenant_audit_logs FOR INSERT
TO authenticated
WITH CHECK (actor_user_id = auth.uid()::uuid);

-- client_registration_requests
CREATE POLICY client_registration_requests_public_insert
ON public.client_registration_requests FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY client_registration_requests_super_admin_read
ON public.client_registration_requests FOR SELECT
TO authenticated
USING (public.app_current_user_role() = 'SUPER_ADMIN');

CREATE POLICY client_registration_requests_super_admin_update
ON public.client_registration_requests FOR UPDATE
TO authenticated
USING (public.app_current_user_role() = 'SUPER_ADMIN')
WITH CHECK (public.app_current_user_role() = 'SUPER_ADMIN');

-- support_chat_conversations
CREATE POLICY support_chat_conversations_read
ON public.support_chat_conversations FOR SELECT
TO authenticated
USING (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN', 'MANAGER')
  )
);

CREATE POLICY support_chat_conversations_insert
ON public.support_chat_conversations FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.app_current_user_role() = 'SUPER_ADMIN'
    AND created_by = auth.uid()::uuid
  )
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN', 'MANAGER')
    AND created_by = auth.uid()::uuid
  )
);

CREATE POLICY support_chat_conversations_update
ON public.support_chat_conversations FOR UPDATE
TO authenticated
USING (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
  )
)
WITH CHECK (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN')
  )
);

-- support_chat_messages
CREATE POLICY support_chat_messages_read
ON public.support_chat_messages FOR SELECT
TO authenticated
USING (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN', 'MANAGER', 'STAFF')
  )
);

CREATE POLICY support_chat_messages_insert
ON public.support_chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.app_current_user_role() = 'SUPER_ADMIN'
    AND sender_role = 'PLATFORM'
    AND sender_id = auth.uid()::uuid
  )
  OR (
    pawnshop_id = public.app_current_user_pawnshop_id()
    AND public.app_current_user_role() IN ('OWNER', 'ADMIN', 'BRANCH_ADMIN', 'MANAGER', 'STAFF')
    AND sender_role = 'TENANT'
    AND sender_id = auth.uid()::uuid
  )
);

-- --------------------------------------------------------------------------
-- 3) Replace permissive SUPER_ADMIN operational data policies
-- --------------------------------------------------------------------------

-- CUSTOMER
DROP POLICY IF EXISTS customer_super_admin_all ON public.customer;
DROP POLICY IF EXISTS super_admin_select_all_customers ON public.customer;
DROP POLICY IF EXISTS customer_pawnshop_isolation ON public.customer;
DROP POLICY IF EXISTS branch_admin_select_own_customers ON public.customer;
DROP POLICY IF EXISTS customer_insert ON public.customer;
DROP POLICY IF EXISTS authenticated_insert_customer ON public.customer;
DROP POLICY IF EXISTS customer_update ON public.customer;
DROP POLICY IF EXISTS authenticated_update_customer ON public.customer;
DROP POLICY IF EXISTS customer_delete ON public.customer;
DROP POLICY IF EXISTS authenticated_delete_customer ON public.customer;

CREATE POLICY customer_read_tenant_or_granted_support
ON public.customer FOR SELECT
TO authenticated
USING (public.app_can_read_operational(pawnshop_id));

CREATE POLICY customer_write_tenant_only
ON public.customer FOR INSERT
TO authenticated
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY customer_update_tenant_only
ON public.customer FOR UPDATE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id))
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY customer_delete_tenant_only
ON public.customer FOR DELETE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id));

-- TICKET
DROP POLICY IF EXISTS ticket_super_admin_all ON public.ticket;
DROP POLICY IF EXISTS super_admin_select_all_tickets ON public.ticket;
DROP POLICY IF EXISTS ticket_pawnshop_isolation ON public.ticket;
DROP POLICY IF EXISTS branch_admin_select_own_tickets ON public.ticket;
DROP POLICY IF EXISTS ticket_insert ON public.ticket;
DROP POLICY IF EXISTS authenticated_insert_ticket ON public.ticket;
DROP POLICY IF EXISTS ticket_update ON public.ticket;
DROP POLICY IF EXISTS authenticated_update_ticket ON public.ticket;
DROP POLICY IF EXISTS ticket_delete ON public.ticket;
DROP POLICY IF EXISTS authenticated_delete_ticket ON public.ticket;

CREATE POLICY ticket_read_tenant_or_granted_support
ON public.ticket FOR SELECT
TO authenticated
USING (public.app_can_read_operational(pawnshop_id));

CREATE POLICY ticket_write_tenant_only
ON public.ticket FOR INSERT
TO authenticated
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY ticket_update_tenant_only
ON public.ticket FOR UPDATE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id))
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY ticket_delete_tenant_only
ON public.ticket FOR DELETE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id));

-- LOAN
DROP POLICY IF EXISTS loan_super_admin_all ON public.loan;
DROP POLICY IF EXISTS super_admin_select_all_loans ON public.loan;
DROP POLICY IF EXISTS loan_pawnshop_isolation ON public.loan;

CREATE POLICY loan_read_tenant_or_granted_support
ON public.loan FOR SELECT
TO authenticated
USING (public.app_can_read_operational(pawnshop_id));

CREATE POLICY loan_write_tenant_only
ON public.loan FOR INSERT
TO authenticated
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY loan_update_tenant_only
ON public.loan FOR UPDATE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id))
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY loan_delete_tenant_only
ON public.loan FOR DELETE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id));

-- TRANSACTION (table name is quoted in PostgreSQL because reserved word)
DROP POLICY IF EXISTS transaction_super_admin_all ON public."transaction";
DROP POLICY IF EXISTS super_admin_select_all_transactions ON public."transaction";

CREATE POLICY transaction_read_tenant_or_granted_support
ON public."transaction" FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_read_operational(t.pawnshop_id)
  )
);

CREATE POLICY transaction_write_tenant_only
ON public."transaction" FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
);

CREATE POLICY transaction_update_tenant_only
ON public."transaction" FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
);

CREATE POLICY transaction_delete_tenant_only
ON public."transaction" FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
);

-- INVENTORY
DROP POLICY IF EXISTS inventory_super_admin_all ON public.inventory;
DROP POLICY IF EXISTS super_admin_select_all_inventory ON public.inventory;
DROP POLICY IF EXISTS inventory_pawnshop_isolation ON public.inventory;

CREATE POLICY inventory_read_tenant_or_granted_support
ON public.inventory FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_read_operational(t.pawnshop_id)
  )
);

CREATE POLICY inventory_write_tenant_only
ON public.inventory FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
);

CREATE POLICY inventory_update_tenant_only
ON public.inventory FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
);

CREATE POLICY inventory_delete_tenant_only
ON public.inventory FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ticket t
    WHERE t.id = ticketid
      AND public.app_can_write_operational(t.pawnshop_id)
  )
);

-- BRANCH
DROP POLICY IF EXISTS branch_super_admin_all ON public.branch;
DROP POLICY IF EXISTS branch_pawnshop_isolation ON public.branch;

CREATE POLICY branch_read_tenant_or_granted_support
ON public.branch FOR SELECT
TO authenticated
USING (public.app_can_read_operational(pawnshop_id));

CREATE POLICY branch_write_tenant_only
ON public.branch FOR INSERT
TO authenticated
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY branch_update_tenant_only
ON public.branch FOR UPDATE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id))
WITH CHECK (public.app_can_write_operational(pawnshop_id));

CREATE POLICY branch_delete_tenant_only
ON public.branch FOR DELETE
TO authenticated
USING (public.app_can_write_operational(pawnshop_id));

-- --------------------------------------------------------------------------
-- 4) Keep SUPER_ADMIN metadata visibility on pawnshops (no operational rows)
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS pawnshops_super_admin_all ON public.pawnshops;
DROP POLICY IF EXISTS super_admin_select_all_pawnshops ON public.pawnshops;

CREATE POLICY pawnshops_super_admin_metadata_read
ON public.pawnshops FOR SELECT
TO authenticated
USING (
  public.app_current_user_role() = 'SUPER_ADMIN'
  OR id = public.app_current_user_pawnshop_id()
);

-- --------------------------------------------------------------------------
-- 5) Maintenance helper: mark expired grants
-- --------------------------------------------------------------------------
UPDATE public.support_access_grants
SET status = 'EXPIRED'
WHERE status = 'ACTIVE'
  AND expires_at <= now();

COMMIT;
