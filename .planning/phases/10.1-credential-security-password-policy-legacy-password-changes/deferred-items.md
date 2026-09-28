# Deferred Items — Phase 10.1

Out-of-scope discoveries recorded during plan 10.1-09 execution. These were **not** caused by
plan 10.1-09 changes and were deliberately not fixed (scope boundary).

| Plan | Item | Status | Evidence |
|------|------|--------|----------|
| 10.1-09 | `frontend/src/lib/kycDocs.test.ts` — "rejects when supabase returns an error" and "rejects when no signedUrl is returned" fail | Pre-existing, untouched by 10.1-09 | Full `npx vitest run` at plan close: 3 failures, all in files outside this plan's file set |
| 10.1-09 | `frontend/src/components/__tests__/InventoryVault.test.tsx` — "marks active items for auction" fails | Pre-existing, untouched by 10.1-09 | Same run; no 10.1-09 change touches `InventoryVault` |

Focused verification for this plan (`PasswordField`, `ResetPassword`, `ForcedPasswordChangeGate`,
`AccountSecurityPage`) passes 25/25 with `npx tsc --noEmit` clean.

The same two out-of-scope failures were re-observed during plan 10.1-14:

| Plan | Item | Status | Evidence |
|------|------|--------|----------|
| 10.1-14 | `frontend/src/lib/kycDocs.test.ts` — "rejects when supabase returns an error" and "rejects when no signedUrl is returned" fail | Pre-existing, untouched by 10.1-14 | Full `npx vitest run` at plan close: 3 failures in 2 files, both outside this plan's file set |
| 10.1-14 | `frontend/src/components/__tests__/InventoryVault.test.tsx` — "marks active items for auction" fails | Pre-existing, untouched by 10.1-14 | Same run; no 10.1-14 change touches `InventoryVault` or `kycDocs` |

The same two out-of-scope failures were re-observed during plan 10.1-05 and remain untouched:

| Plan | Item | Status | Evidence |
|------|------|--------|----------|
| 10.1-05 | `frontend/src/lib/kycDocs.test.ts` — "rejects when supabase returns an error" and "rejects when no signedUrl is returned" fail | Pre-existing, untouched by 10.1-05 | Full `npx vitest run` at plan close: 3 failures, all in files outside this plan's file set |
| 10.1-05 | `frontend/src/components/__tests__/InventoryVault.test.tsx` — "marks active items for auction" fails | Pre-existing, untouched by 10.1-05 | Same run; no 10.1-05 change touches `InventoryVault` or `kycDocs` |

## Cross-plan handoff from 10.1-04 (assigned to 10.1-12, not fixed here)

Plan 10.1-04 added `@RequiresPermission(PERMISSIONS['user.manage_staff'])` to
`POST /staff/:id/password`, which makes that route newly counted by the permission-catalog
regression. Two assertions in `backend/src/common/permissions/permissions-catalog.spec.ts`
are therefore red until plan 10.1-12 runs. This is the plan's declared
"T-10.1-35" disposition — 10.1-12 owns the catalog/matrix/guard contract and excludes that
file from 10.1-04's `files_modified`, so it was deliberately **not** fixed here.

| Plan | Item | Status | Evidence |
|------|------|--------|----------|
| 10.1-04 | `permissions-catalog.spec.ts` — "finds all 82 guarded endpoints across the controllers" now counts **83** | Owned by 10.1-12 (its stated acceptance is exactly 83 guarded endpoints after the one new permission-gated route) | Full `npx jest --runInBand` at 10.1-04 close: `Expected: 82 / Received: 83` |
| 10.1-04 | `permissions-catalog.spec.ts` — "every @RequiresPermission site matches the migration matrix" has no `MATRIX['app.controller.ts::changeStaffPassword']` entry | Owned by 10.1-12 (action line 121: "Add the exact staff-reset tuple to the catalog MATRIX") | Same run: `expect(entry).toBeDefined()` → `Received: undefined` |

10.1-04's own verification passes without those assertions: the three focused suites
(56 tests) and `npx tsc --noEmit` are green. All other 46 backend suites (641 tests) pass.

