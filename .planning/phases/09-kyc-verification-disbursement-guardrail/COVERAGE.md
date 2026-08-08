# Phase 9 — API Coverage: Supabase Storage Capability Surface

> **Gate:** api-coverage (Supabase SDK detected — `createSignedUrl` integrated this phase).
> **Scope:** Every Supabase storage capability the phase touches, with INTEGRATE / OPT-OUT decisions.
> **Verified against:** `frontend/src/lib/supabaseClient.ts`, `SUPABASE_STORAGE_RLS_FIX.sql` (repo root), RESEARCH.md § Pattern 5 / § Security Domain, PATTERNS.md § kycDocs.

| Capability | API / SQL Surface | Decision | Reason |
|------------|-------------------|----------|--------|
| Signed URL creation | `supabase.storage.from('kyc-documents').createSignedUrl(path, expiresIn)` (JS v2) | **INTEGRATE** | D-13: all `kyc-documents` rendering (BidderKycReview.tsx:185-193, new CustomerKycReview.tsx, SuperAdminComplianceOverview.tsx:552-568, TrialRequestsPanel.tsx:484-505) mints signed URLs via the shared `getSignedKycDocUrl(storedUrl, ttl?)` helper in `frontend/src/lib/kycDocs.ts`. TTL default 3600s (platform cap 604800s — never exceed). |
| Public URL formation | `supabase.storage.from(...).getPublicUrl(path)` | **INTEGRATE (producer-only)** | Retained ONLY at upload-producer sites (SalesPos.tsx:114, InventoryVault.tsx:156, OwnerComplianceDashboard.tsx:153, PendingAccessDashboard.tsx:166, AuctionMarketplace.tsx:515) to form the stored URL string. The string is parseable back to an object path by `storagePathFromPublicUrl` — no data migration needed. NEVER used for rendering after the bucket flip. |
| Object upload | `supabase.storage.from('kyc-documents').upload(path, file, opts)` | **INTEGRATE (unchanged)** | Existing upload flow untouched; `storage_auth_upload_supported_buckets` INSERT policy retained. |
| Bucket privacy flip | SQL: `update storage.buckets set public = false where id = 'kyc-documents';` | **INTEGRATE** | KYC-05 / D-13. Delivered in `SECURITY_KYC05_STORAGE_RLS.sql` (repo root, SUPABASE_STORAGE_RLS_FIX.sql convention). Manual Supabase SQL Editor apply (D-14). Only `kyc-documents` flips; `loan-documents`/`loan-contracts` stay public (out of scope). |
| storage.objects SELECT policy | SQL: drop `storage_public_read_supported_buckets` (`to public`); create `storage_kyc_documents_authenticated_read` (`to authenticated`, `bucket_id = 'kyc-documents'`) | **INTEGRATE** | `createSignedUrl` requires the caller to pass the SELECT policy on the object. The `to public` row is dropped — otherwise documents remain publicly downloadable regardless of bucket visibility. |
| `bidder_kyc` RLS | SQL: `alter table public.bidder_kyc enable row level security;` + 3-tier policies | **INTEGRATE** | D-12: (a) own-row `auth.uid() = profile_id`, (b) tenant-staff join through `profiles.pawnshop_id` (bidder profile → pawnshop matches caller profile's pawnshop), (c) `service_role` implicit bypass (documented, not enforced). No schema change to `BidderKyc`. |
| Signed URL expiry policy | `expiresIn` TTL parameter | **INTEGRATE** | 3600s default; re-mint on dialog open (review sessions can exceed 1h). Platform caps at 604800s — helper never exceeds it. |
| Batch signed URLs | `createSignedUrls(paths, ttl)` | **OPT-OUT** | Review dialogs show at most 3 documents one at a time; per-doc `createSignedUrl` is sufficient. |
| File download | `download(path)` | **OPT-OUT** | Review use case is open-in-new-tab via signed URL; no download flow in phase scope. |
| Bucket management (JS) | `createBucket` / `deleteBucket` / `updateBucket` | **OPT-OUT** | Bucket mutation ships as SQL deliverable (Supabase SQL Editor), consistent with existing `SUPABASE_STORAGE_RLS_FIX.sql` convention. |
| Path-scoped policies | `storage.foldername(name)` | **OPT-OUT** | Bucket-level `bucket_id = 'kyc-documents'` SELECT policy is sufficient for this phase's surface. |
| Object delete | `remove(paths)` | **OPT-OUT** | No deletion flows in phase scope. |
