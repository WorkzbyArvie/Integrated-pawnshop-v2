# Deferred Items — Phase 09 (kyc-verification-disbursement-guardrail)

Out-of-scope discoveries logged during 09-01 execution. NOT fixed by the plan (scope boundary).

## Pre-existing tsc errors in approval specs (found during 09-01 Task 1 verification)

- **File:** backend/src/approval/approval.controller.spec.ts
- **Lines:** 31, 42, 57
- **Error:** TS2345 — `{ id: string; pawnshopId: string; role: string; }` is not assignable to parameter of type `Request<...>` (missing get/header/accepts... and 98 more)
- **File:** backend/src/approval/approval.service.spec.ts
- **Line:** 412
- **Error:** TS2339 — Property 'requiresApproval' does not exist on the union type

**Root cause:** committed spec files vs dirty uncommitted prior-work sources
(`backend/src/approval/approval.service.ts`, `backend/src/loan/pawn-ticket.service.ts`).
The committed specs were written against newer source signatures that have not landed.

**Why deferred:** files are untouched by 09-01; per deviation-rule scope boundary, pre-existing
failures in unrelated files are not auto-fixed.

**Resolution owner:** the pending approval/pawn-ticket source work (or a dedicated cleanup
commit that updates these specs to match current signatures).

**Impact:** `npx tsc --noEmit` reports exactly these 4 errors; zero errors in 09-01 plan files.
Jest (transpile-only) is unaffected — all 42 plan tests plus approval suites pass.
