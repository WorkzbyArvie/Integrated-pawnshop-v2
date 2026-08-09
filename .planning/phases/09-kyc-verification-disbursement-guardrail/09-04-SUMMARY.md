---
phase: 09-kyc-verification-disbursement-guardrail
plan: 04
subsystem: database
tags: [kyc, supabase, rls, storage, seed, prisma, security]

# Dependency graph
requires:
  - phase: 09-kyc-verification-disbursement-guardrail
    plan: 01
    provides: kyc.view/kyc.verify permission definitions + MANAGER catalog rows (fresh-install path via migration edit); the SQL deliverable here completes the existing-tenant path (09-01 Task 3 cross-reference)
  - phase: 09-kyc-verification-disbursement-guardrail
    plan: 03
    provides: all kyc-documents read surfaces already mint signed URLs — the bucket flip in this plan's SQL cannot 403 them; SalesPos capture + review UI consume the PENDING row this plan seeds
provides:
  - SECURITY_KYC05_STORAGE_RLS.sql — idempotent Supabase SQL Editor script: kyc-documents bucket private flip, public-read policy recreated WITHOUT kyc-documents, storage_kyc_documents_authenticated_read (to authenticated, bucket_id = 'kyc-documents') so createSignedUrl minting passes the SELECT policy (COVERAGE.md row 13)
  - bidder_kyc RLS with three tiers: own-row read (auth.uid() = profile_id), tenant-staff read (join-through-profile via profiles.pawnshop_id), service-role bypass — drops precede every create (idempotent re-runs)
  - Idempotent MANAGER kyc.view/kyc.verify role_permissions inserts for EXISTING tenants (permissions-name join → UUID, ON CONFLICT DO NOTHING) — completes T-09-32
  - backend/prisma/seed-demo-kyc.ts — 3 VERIFIED demo customers + 1 PENDING demo row, dual-column Customer.kycStatus + CustomerKyc.status writes in one $transaction per demo (D-02), findFirst-reuse + CustomerKyc upsert on unique customerId (re-run safe), pawnshopId from DEMO_PAWN_SHOP_ID or first pawnshop, exit-early when none
affects: [verify-work UAT, post-execution UI review, supabase live apply (human step), 10-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Storage policy composition: SECURITY_KYC05_STORAGE_RLS.sql drops and recreates the exact policy names from SUPABASE_STORAGE_RLS_FIX.sql (storage_public_read_supported_buckets) so the two files compose safely; the new authenticated-scope policy (storage_kyc_documents_authenticated_read) is drop-if-exists'd before create so the whole script re-runs cleanly"
    - "RLS tenant tier without a tenant column on the target table: bidder_kyc has no pawnshop_id, so the tenant-staff tier joins through profiles (bidder_kyc.profile_id → profiles.pawnshop_id, matched against the caller's own profile pawnshop via auth.uid())"
    - "role_permissions seed for existing tenants resolves permission_id by joining permissions.name (UUID column) — the literal VALUES form in the plan text would fail on the UUID type; baseline-migration shape (INSERT ... SELECT ... JOIN permissions ... ON CONFLICT (role, permission_id) DO NOTHING) used instead"
    - "Demo seed idempotency: customer findFirst(fullName, contactNumber) → reuse or create; CustomerKyc upsert on unique customerId; both status columns written inside one interactive $transaction callback per demo row"

key-files:
  created:
    - SECURITY_KYC05_STORAGE_RLS.sql
    - backend/prisma/seed-demo-kyc.ts

key-decisions:
  - "Tenant-staff RLS tier joins through profiles only (p.pawnshop_id = caller profile's pawnshop_id), NOT staff: verified schema.prisma Staff (line 241) and the 20260201144928_regenerate migration DDL — the staff table has NO pawnshop_id column (only id, full_name, password, role, contact_number, branchid). The plan pre-authorized adjusting join columns ('adjust the join columns if the mapping differs, but keep the join-through-profile shape') — the join-through-profile shape is preserved, no schema change"
  - "Section C uses the permissions-name join (INSERT ... SELECT ... JOIN permissions p ON p.name = v.permission_name) instead of the plan's literal `values ('MANAGER','kyc.view')` snippet — role_permissions.permission_id is UUID, so the literal form would fail at runtime; the baseline migration (:253-361) is the exact shape (Rule 1 fix, plan text bug)"
  - "Seed live run succeeded (DB reachable): 4 customers + 4 CustomerKyc rows created; re-run reused the same UUIDs — idempotency verified live, not just by construction"
  - "storage_kyc_documents_authenticated_read created with drop-if-exists-before-create (the plan's invariant 'every drop has a matching create' holds: 5 drops ↔ 5 creates)"

patterns-established:
  - "Root-level SQL deliverable convention (SUPABASE_STORAGE_RLS_FIX.sql style): header comment block + short section labels; drops precede creates so the script is re-runnable in the Supabase SQL Editor"
  - "Dual-column KYC write invariant (D-02) applied to demo data: Customer.kycStatus + CustomerKyc.status set in the same $transaction callback for every demo row"
  - "Stage-only task-scoped files for commits; pre-existing unrelated working-tree changes left untouched"

requirements-completed: [KYC-05]

metrics:
  duration: 28
  completed: "2026-08-09"
---

# Phase 9 Plan 4: KYC-05 Storage/RLS Security SQL + Demo Seed Summary

## One-liner

Supabase SQL deliverable flipping `kyc-documents` to private with an authenticated-scope read policy for signed-URL minting, enabling 3-tier RLS on `bidder_kyc`, and granting MANAGER `kyc.view`/`kyc.verify` to existing tenants — plus an idempotent demo seed creating 3 VERIFIED + 1 PENDING dual-column KYC rows.

## What Was Built

### Task 1 — `SECURITY_KYC05_STORAGE_RLS.sql` (repo root)

Three sections, all idempotent (drops precede creates):

- **Section A (D-13, COVERAGE.md row 12-13):** `update storage.buckets set public = false where id = 'kyc-documents';` — drops and recreates `storage_public_read_supported_buckets` scoped to `('loan-documents','loan-contracts')` (kyc-documents removed); adds `storage_kyc_documents_authenticated_read` (`to authenticated`, `bucket_id = 'kyc-documents'`) so `createSignedUrl` callers pass the SELECT policy (09-03 review screens keep working post-flip). Upload/update/delete authenticated policies intentionally untouched.
- **Section B (D-12, T-09-31):** `alter table bidder_kyc enable row level security;` + three policies:
  - `bidder_kyc_own_row_read` — `for select using (auth.uid() = profile_id)`
  - `bidder_kyc_tenant_staff_read` — `for select` joining bidder_kyc.profile_id → profiles.pawnshop_id, matched against the caller profile's pawnshop_id (join-through-profile; adjusted because the `staff` table has no pawnshop_id — see Deviations)
  - `bidder_kyc_service_role_all` — `for all using (auth.role() = 'service_role')`
  - No end-user INSERT/UPDATE/DELETE policies — NestJS API writes via service role.
- **Section C (T-09-32, completes 09-01 Task 3 for live DBs):** `INSERT INTO role_permissions (role, permission_id) SELECT v.role, p.id FROM (VALUES ('MANAGER','kyc.view'), ('MANAGER','kyc.verify')) AS v(role, permission_name) JOIN permissions p ON p.name = v.permission_name ON CONFLICT (role, permission_id) DO NOTHING;` — matches the baseline migration shape; conflict target matches unique index `role_permissions_role_permission_id_key`.

### Task 2 — `backend/prisma/seed-demo-kyc.ts`

- Resolves pawnshopId: `DEMO_PAWN_SHOP_ID` env → `prisma.pawnshop.findFirst()` → clear log + exit(0) if none.
- 3 VERIFIED demo rows (matching seed.ts demo names): Juan Dela Cruz / 09123456789, Maria Clara / 09987654321, Arvie Owner / 09555444333 — each: find-or-create customer, then one `$transaction` callback writing `Customer.kycStatus = 'VERIFIED'` + `CustomerKyc` upsert (`status: 'VERIFIED'`, NATIONAL_ID / 12-digit PhilSys `123456789012`, demo doc URLs).
- 1 PENDING row: Pending Demo Customer / 09771234567 — same pattern with `kycStatus`/`status` `'PENDING'` (review-flow demo source, no review fields).
- No comments in source (AGENTS.md); auto-uuid Customer id; zero new dependencies (`tsx` already a devDependency).

## Verification Results

| Check | Result |
|-------|--------|
| SQL static invariants (drops↔creates, policy names, bucket strings, conflict target, authenticated SELECT policy) | ✅ 5 drops ↔ 5 creates; `storage_kyc_documents_authenticated_read` present (`to authenticated`, `bucket_id = 'kyc-documents'`); `on conflict (role, permission_id)` matches unique index; bucket ids match SUPABASE_STORAGE_RLS_FIX.sql exactly; `public = false` flip present |
| `cd backend && npx tsc --noEmit` | ✅ Zero errors in plan files (seed-demo-kyc.ts clean). 4 pre-existing errors in `approval/*.spec.ts` remain — out of scope, already logged in deferred-items.md |
| `npx tsx prisma/seed-demo-kyc.ts` (live, best-effort — D-14) | ✅ Succeeded: 4 customers created; re-run reused same UUIDs (idempotent, no duplicates) |
| Dual-column invariant (live query) | ✅ 3 rows `kycStatus=VERIFIED` + `customerKyc.status=VERIFIED`; 1 row `PENDING`/`PENDING` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tenant-staff RLS join column corrected — staff table has no pawnshop_id**
- **Found during:** Task 1
- **Issue:** Plan's literal join `profiles p join staff s on s.pawnshop_id = p.pawnshop_id ...` references `staff.pawnshop_id`, but the `staff` table has no such column (schema.prisma `Staff` :241-251: `id, full_name, password, role, contact_number, branchid`; confirmed in migration `20260201144928_regenerate` DDL). The statement would fail in the SQL Editor.
- **Fix:** Tenant-staff tier joins through profiles only — `bidder_kyc.profile_id → profiles.pawnshop_id` matched against the caller's own `profiles.pawnshop_id` (`select caller.pawnshop_id from profiles caller where caller.id = auth.uid()`). This is the plan-sanctioned adjustment ("adjust the join columns if the mapping differs, but keep the join-through-profile shape"); no schema change.
- **Files modified:** SECURITY_KYC05_STORAGE_RLS.sql
- **Commit:** 79446f2

**2. [Rule 1 - Bug] Section C uses permissions-name join instead of literal VALUES (UUID type)**
- **Found during:** Task 1
- **Issue:** Plan text `insert into role_permissions (role, permission_id) values ('MANAGER','kyc.view'), ...` would fail — `permission_id` is UUID, and `'kyc.view'` is text (no implicit cast). The baseline migration never inserts string names into that column; it joins `permissions` by name (`:253-361`).
- **Fix:** Adopted the baseline migration's exact `INSERT ... SELECT v.role, p.id FROM (VALUES ...) AS v(role, permission_name) JOIN permissions p ON p.name = v.permission_name ON CONFLICT (role, permission_id) DO NOTHING` shape. Conflict target still matches the unique index `role_permissions_role_permission_id_key`.
- **Files modified:** SECURITY_KYC05_STORAGE_RLS.sql
- **Commit:** 79446f2

No other deviations — Task 2 executed exactly as planned (and its live run exceeded the best-effort bar: DB was reachable, so idempotency is verified empirically).

## Auth Gates

None — no authenticated tooling invoked. The Supabase SQL Editor apply is a documented human step (deferred, not a gate): run `SECURITY_KYC05_STORAGE_RLS.sql` against the target project.

## Known Stubs

None. Demo doc URLs (`https://example.com/kyc-docs/...`) are intentional seed placeholders for the demo flow — real uploads via the SalesPos capture flow produce production URLs.

## Threat Flags

None — all security-relevant surface in this plan's files is covered by the plan's `<threat_model>` (T-09-30 storage read disclosure, T-09-31 bidder_kyc cross-tenant read, T-09-32 MANAGER grants, T-09-33 seed dual-column consistency, T-09-SC zero new deps). No new endpoints, auth paths, or schema changes introduced.

## Deferred / Human Steps

- **Human (deferred, documented in plan):** run `SECURITY_KYC05_STORAGE_RLS.sql` in the Supabase SQL Editor for the target project; verify `storage.buckets.public = false` for kyc-documents and `pg_policies` shows the three bidder_kyc policies. The seed has already been run live (rows exist), so the demo flow is immediately exercisable once the SQL is applied.
- **Pre-existing (out of scope):** 4 tsc errors in `backend/src/approval/*.spec.ts` — unchanged, tracked in deferred-items.md since 09-01.

## Self-Check: PASSED

- [x] SECURITY_KYC05_STORAGE_RLS.sql exists at repo root
- [x] backend/prisma/seed-demo-kyc.ts exists and compiles clean
- [x] Commits 79446f2 (SQL) and b0c8623 (seed) present in git log
- [x] SQL invariants verified by regex scan (5 drops/5 creates, policy names, conflict target, bucket strings)
- [x] Live seed run + idempotent re-run verified (4 rows, dual-column statuses)

---

*Phase: 09-kyc-verification-disbursement-guardrail*
