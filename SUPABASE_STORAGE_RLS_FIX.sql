-- Fix Supabase Storage upload failures:
-- "new row violates row-level security policy"
--
-- Run this in Supabase SQL Editor for the target project.

-- 1) Ensure expected buckets exist.
insert into storage.buckets (id, name, public)
values
  ('kyc-documents', 'kyc-documents', true),
  ('loan-documents', 'loan-documents', true),
  ('loan-contracts', 'loan-contracts', true)
on conflict (id) do nothing;

-- 2) Remove old policies if they already exist (safe re-run).
drop policy if exists "storage_public_read_supported_buckets" on storage.objects;
drop policy if exists "storage_auth_upload_supported_buckets" on storage.objects;
drop policy if exists "storage_auth_update_supported_buckets" on storage.objects;
drop policy if exists "storage_auth_delete_supported_buckets" on storage.objects;

-- 3) Create Storage RLS policies for app buckets.
-- Read objects from supported buckets (public + authenticated users).
create policy "storage_public_read_supported_buckets"
on storage.objects
for select
to public
using (
  bucket_id in ('kyc-documents', 'loan-documents', 'loan-contracts')
);

-- Allow authenticated users to upload objects to supported buckets.
create policy "storage_auth_upload_supported_buckets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('kyc-documents', 'loan-documents', 'loan-contracts')
);

-- Allow authenticated users to update their uploaded objects in supported buckets.
create policy "storage_auth_update_supported_buckets"
on storage.objects
for update
to authenticated
using (
  bucket_id in ('kyc-documents', 'loan-documents', 'loan-contracts')
)
with check (
  bucket_id in ('kyc-documents', 'loan-documents', 'loan-contracts')
);

-- Allow authenticated users to delete objects in supported buckets.
create policy "storage_auth_delete_supported_buckets"
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('kyc-documents', 'loan-documents', 'loan-contracts')
);
