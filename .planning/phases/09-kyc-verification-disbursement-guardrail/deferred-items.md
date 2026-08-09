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

## Pre-existing full-suite failures (found during 09-02 verification)

Full backend run (`npm test`) reports 8 failing suites / 38 failed tests — ALL pre-existing,
in files 09-02 does not touch. Verified: failures reproduce at HEAD for the dirty-tree suites;
none import this plan's changed files except approval.service.spec.ts (see below).

- **notification** — pre-existing failures
- **attendance** — pre-existing failures
- **subscription** — pre-existing failures
- **queue** — pre-existing failures
- **auction-settlement** — pre-existing failures
- **loan-contract** — pre-existing failures
- **loan-history.service.spec.ts** — DI failure at HEAD: spec's test module provides 5 providers
  vs 6 constructor deps (missing `NotificationService`); `getLoanFullHistory('1')` string-vs-number
  transient tsc noise appears when loan.service.ts sits at HEAD (pre-existing string-ID changes not
  applied) — vanishes once the pre-existing hunks are restored
- **approval.service.spec.ts** — imports `PawnTicketService` but fails on a stale mock (missing
  `ticket.count`) and pre-existing approval.service.ts behavior (status PENDING vs APPROVED)

**Root cause:** uncommitted prior-work sources (approval/pawn-ticket/loan string-ID signatures)
vs committed specs; the working tree intentionally carries these changes outside the GSD flow.

**Why deferred:** files untouched by 09-02; per deviation-rule scope boundary, pre-existing
failures in unrelated files are not auto-fixed.

**Resolution owner:** the pending approval/pawn-ticket/loan source work (or a dedicated cleanup
commit that updates these specs to match current signatures).

**Impact:** 09-02 plan tests are green — 22/22 across pawn-ticket.service, loan.service, app.service.
The 8 failing suites are tracked here for the verifier; none are caused by 09-02 changes.

## Pre-existing frontend vitest failures (found during 09-03 verification)

Full frontend run (`npx vitest run`) reports 2 failing tests — BOTH pre-existing, in files
09-03 does not touch (verified: `git status` clean for both test files AND their components;
neither imports any 09-03 file).

- **InventoryVault.test.tsx** > "marks active items for auction" — `TypeError: supabase.from(...).select(...).in is not a function`
- **AuctionQueue.test.tsx** > "returns an item to the vault" — same mock-chain limitation

**Root cause:** the test files' `vi.mock` of supabaseClient provides a chain stub that lacks
`.in()` on the inventory/auction item queries; pre-existing mock coverage gap.

**Why deferred:** files untouched by 09-03 (which only adds kycDocs helper, KycStatusBadge,
DocLink, CustomerKycReview, and modifies BidderKycReview/types.ts/App.tsx/SalesPos.tsx);
per deviation-rule scope boundary, pre-existing failures in unrelated files are not auto-fixed.

**Resolution owner:** a dedicated test-infra cleanup commit extending the supabase mock chain.

**Impact:** 09-03 plan tests are green — 14/14 in Task 1 (kycDocs + KycStatusBadge); full suite
reports exactly these 2 pre-existing failures.

