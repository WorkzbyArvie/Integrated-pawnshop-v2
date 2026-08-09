-- ============================================================================
-- SECURITY_KYC05_STORAGE_RLS.sql — KYC-05 security closure
-- ============================================================================
-- Run this in the Supabase SQL Editor for the target project.
-- Idempotent: safe to re-run (every create is preceded by a drop if exists).
-- Purpose:
--   A) Flip the kyc-documents storage bucket to private and replace the public
--      read policy with an authenticated-scope SELECT policy so signed-URL
--      minting (createSignedUrl) works and documents are never publicly readable.
--   B) Enable RLS on bidder_kyc with three read tiers: own row, tenant staff
--      (join through profiles), and service-role bypass.
--   C) Grant MANAGER kyc.view / kyc.verify for existing tenants (fresh installs
--      already have these from the v2.0 baseline migration).

-- ----------------------------------------------------------------------------
-- Section A — kyc-documents bucket privacy (D-13)
-- ----------------------------------------------------------------------------
update storage.buckets set public = false where id = 'kyc-documents';

drop policy if exists "storage_public_read_supported_buckets" on storage.objects;
create policy "storage_public_read_supported_buckets"
on storage.objects
for select
to public
using (
  bucket_id in ('loan-documents', 'loan-contracts')
);

drop policy if exists "storage_kyc_documents_authenticated_read" on storage.objects;
create policy "storage_kyc_documents_authenticated_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'kyc-documents'
);

-- ----------------------------------------------------------------------------
-- Section B — bidder_kyc RLS (D-12)
-- ----------------------------------------------------------------------------
alter table bidder_kyc enable row level security;

drop policy if exists "bidder_kyc_own_row_read" on bidder_kyc;
create policy "bidder_kyc_own_row_read"
on bidder_kyc
for select
using (
  auth.uid() = profile_id
);

drop policy if exists "bidder_kyc_tenant_staff_read" on bidder_kyc;
create policy "bidder_kyc_tenant_staff_read"
on bidder_kyc
for select
using (
  exists (
    select 1
    from profiles p
    where p.id = bidder_kyc.profile_id
      and p.pawnshop_id is not null
      and p.pawnshop_id = (
        select caller.pawnshop_id from profiles caller where caller.id = auth.uid()
      )
  )
);

drop policy if exists "bidder_kyc_service_role_all" on bidder_kyc;
create policy "bidder_kyc_service_role_all"
on bidder_kyc
for all
using (
  auth.role() = 'service_role'
);

-- ----------------------------------------------------------------------------
-- Section C — MANAGER kyc grants for existing tenants (completes 09-01 Task 3)
-- ----------------------------------------------------------------------------
insert into role_permissions (role, permission_id)
select v.role, p.id
from (values
  ('MANAGER', 'kyc.view'),
  ('MANAGER', 'kyc.verify')
) as v(role, permission_name)
join permissions p on p.name = v.permission_name
on conflict (role, permission_id) do nothing;
