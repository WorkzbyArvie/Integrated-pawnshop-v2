-- Tenant governance migration for multi-tenant privacy and controlled support access
-- Execute in Supabase SQL Editor before using /tenant-governance endpoints.

BEGIN;

CREATE TABLE IF NOT EXISTS public.support_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  requested_hours int NOT NULL DEFAULT 4 CHECK (requested_hours BETWEEN 1 AND 72),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz NULL,
  approval_notes text NULL
);

CREATE INDEX IF NOT EXISTS idx_support_access_requests_pawnshop
  ON public.support_access_requests(pawnshop_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.support_access_requests(id) ON DELETE CASCADE,
  pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  granted_to uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  approved_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_support_access_grants_scope
  ON public.support_access_grants(pawnshop_id, granted_to, status, expires_at);

CREATE TABLE IF NOT EXISTS public.tenant_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_logs_scope
  ON public.tenant_audit_logs(pawnshop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_module_configs (
  pawnshop_id uuid PRIMARY KEY REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  selected_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  staff_count int NOT NULL DEFAULT 1 CHECK (staff_count > 0),
  role_assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  configured_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_branding_profiles (
  pawnshop_id uuid PRIMARY KEY REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  logo_url text NULL,
  primary_color text NOT NULL DEFAULT '#D4AF37',
  secondary_color text NOT NULL DEFAULT '#141416',
  custom_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pawnshop_name text NOT NULL,
  owner_name text NOT NULL,
  owner_email text NOT NULL,
  contact_number text NULL,
  selected_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  staff_count int NOT NULL DEFAULT 1 CHECK (staff_count > 0),
  notes text NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONTACTED', 'APPROVED', 'REJECTED')),
  handled_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_registration_requests_status_created
  ON public.client_registration_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_registration_requests_owner_email
  ON public.client_registration_requests(lower(owner_email));

CREATE TABLE IF NOT EXISTS public.support_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_chat_conversations_scope
  ON public.support_chat_conversations(pawnshop_id, status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_chat_conversations(id) ON DELETE CASCADE,
  pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('TENANT', 'PLATFORM')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_chat_messages_conversation
  ON public.support_chat_messages(conversation_id, created_at ASC);

-- Multi-branch operational metadata (idempotent extension of existing branch table)
ALTER TABLE IF EXISTS public.branch
  ADD COLUMN IF NOT EXISTS manager_name text NULL;

ALTER TABLE IF EXISTS public.branch
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE IF EXISTS public.branch
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE IF EXISTS public.branch
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_branch_pawnshop_active_name
  ON public.branch(pawnshop_id, is_active, name);

-- Recommended: keep SUPER_ADMIN metadata-only access by not granting direct table reads for
-- loan, ticket, and transaction data outside tenant context.

COMMIT;
