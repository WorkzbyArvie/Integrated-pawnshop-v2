# Deferred Items — Phase 10.1

Out-of-scope discoveries recorded during plan 10.1-09 execution. These were **not** caused by
plan 10.1-09 changes and were deliberately not fixed (scope boundary).

| Plan | Item | Status | Evidence |
|------|------|--------|----------|
| 10.1-09 | `frontend/src/lib/kycDocs.test.ts` — "rejects when supabase returns an error" and "rejects when no signedUrl is returned" fail | Pre-existing, untouched by 10.1-09 | Full `npx vitest run` at plan close: 3 failures, all in files outside this plan's file set |
| 10.1-09 | `frontend/src/components/__tests__/InventoryVault.test.tsx` — "marks active items for auction" fails | Pre-existing, untouched by 10.1-09 | Same run; no 10.1-09 change touches `InventoryVault` |

Focused verification for this plan (`PasswordField`, `ResetPassword`, `ForcedPasswordChangeGate`,
`AccountSecurityPage`) passes 25/25 with `npx tsc --noEmit` clean.

The same two out-of-scope failures were re-observed during plan 10.1-05 and remain untouched:

| Plan | Item | Status | Evidence |
|------|------|--------|----------|
| 10.1-05 | `frontend/src/lib/kycDocs.test.ts` — "rejects when supabase returns an error" and "rejects when no signedUrl is returned" fail | Pre-existing, untouched by 10.1-05 | Full `npx vitest run` at plan close: 3 failures, all in files outside this plan's file set |
| 10.1-05 | `frontend/src/components/__tests__/InventoryVault.test.tsx` — "marks active items for auction" fails | Pre-existing, untouched by 10.1-05 | Same run; no 10.1-05 change touches `InventoryVault` or `kycDocs` |

