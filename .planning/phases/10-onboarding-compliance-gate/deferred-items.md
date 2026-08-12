# Deferred Items — Phase 10 (Onboarding Compliance Gate)

Out-of-scope discoveries logged during plan execution per the scope-boundary rule.
Do NOT fix within Phase 10 plan tasks. Re-evaluate at the wave-merge / full-suite gate.

## Full backend test suite: 6 pre-existing failing suites (not caused by 10-01)

- **Found during:** 10-01 verification (full `npm test` in backend)
- **Date:** 2026-08-11
- **Failure pattern:** DI wiring errors in test modules, e.g.
  `LoanService` cannot resolve `NotificationService` in
  `loan/loan-history.service.spec.ts` (`Nest can't resolve dependencies`),
  and `attendance.service.spec.ts` "Cannot read properties of undefined
  (reading 'findUnique')".
- **Failing suites:**
  1. `backend/src/attendance/attendance.service.spec.ts`
  2. `backend/src/notification/notification.service.spec.ts`
  3. `backend/src/queue/queue.service.spec.ts`
  4. `backend/src/auction/auction-settlement.service.spec.ts`
  5. `backend/src/loan/loan-contract.service.spec.ts`
  6. `backend/src/loan/loan-history.service.spec.ts`
- **Root cause (hypothesis):** The working tree carries uncommitted edits to
  the corresponding service modules (`loan.service.ts`, `pawn-ticket.service.ts`,
  `attendance.service.ts`, `auction.service.ts`, etc.) from other workstreams;
  their specs were not updated in lockstep. The failures exist at HEAD and are
  independent of the 10-01 commits (which touch only tenant-governance files
  and a type-only approval spec change — none imported by the failing suites).
- **Impact on 10-01:** None. Scoped gates pass:
  `npx tsc --noEmit` (exit 0) and
  `npm test -- --testPathPattern="tenant-governance" --silent` (7/7 pass).
- **Action required:** Owner of the loan/attendance/notification/queue/auction
  workstreams should update the affected specs (add `NotificationService` mock
  to loan test modules, etc.) before the wave merge / full-suite gate.

## Related pre-existing issue

- `approval/approval.controller.spec.ts` had a pre-existing TS2345 (`caller`
  plain object not assignable to `express.Request`) at HEAD that broke
  `npx tsc --noEmit`. This was FIXED during 10-01 as a Rule 3 blocker
  (`74f696d`, type-only `as any` on the mock — zero behavior change).
  Not deferred; recorded here for traceability.

## 10-02 confirmation: same 6 pre-existing failing suites (unchanged)

- **Found during:** 10-02 verification (full `npm test` in backend)
- **Date:** 2026-08-11
- **Result:** Identical 6 suites still fail at HEAD after the 10-02 commits
  (attendance, notification, queue, auction-settlement, loan-contract,
  loan-history). Sample root cause re-confirmed: `TypeError:
  this.prisma.ensureConnected is not a function` in
  `notification.service.spec.ts` (mock-prisma shape mismatch).
- **Impact on 10-02:** None. Scoped gates pass:
  `npx tsc --noEmit` (exit 0) and
  `npm test -- --testPathPattern="tenant-governance|permissions-catalog" --silent`
  (23/23 pass: 15 tenant-governance + 8 permissions-catalog).
  None of the failing suites import tenant-governance, rbac.guard, or
  permissions-catalog files.
- **Action:** unchanged from the 10-01 entry — owning workstreams must update
  the affected specs before the wave merge / full-suite gate.

## 10-03 confirmation: same 6 pre-existing failing suites (unchanged)

- **Found during:** 10-03 verification (full `npm test` in backend)
- **Date:** 2026-08-11
- **Result:** Identical 6 suites still fail at HEAD after the 10-03 commits
  (attendance, notification, queue, auction-settlement, loan-contract,
  loan-history). Sample root cause re-confirmed:
  `Nest can't resolve dependencies of the LoanService ... NotificationService`
  in `loan/loan-history.service.spec.ts` (test-module DI shape mismatch).
- **Impact on 10-03:** None. Scoped gates pass:
  `npx tsc --noEmit` (exit 0) and
  `npm test -- --testPathPattern="tenant-governance" --silent` (23/23 pass).
  None of the failing suites import tenant-governance files; this plan's
  commits touch only tenant-governance service/controller/spec.
- **Action:** unchanged — owning workstreams must update the affected specs
  before the wave merge / full-suite gate.

## Pre-existing uncommitted WIP in tenant-governance.controller.ts (NOT committed by 10-03)

- **Found during:** 10-03 Task 2 commit
- **Date:** 2026-08-11
- **Description:** The working tree carried (and still carries) an uncommitted
  `POST client-registrations/:requestId/submit` route wiring the already-committed
  `submitMyClientRegistrationRequest` service method. This WIP predates 10-03
  (present in the working tree before this plan started, not part of any
  10-03 task's `files_modified`). It was deliberately left uncommitted and
  untouched; the 10-03 controller commit staged only the `/me/status` hunk
  via `git add -p`.
- **Action:** The user should commit or discard this WIP on their own
  judgment — 10-03 did not assess its correctness.

## 10-04: pre-existing frontend tsc errors (48 lines, HEAD) — untouched

- **Found during:** 10-04 verification (`cd frontend && npx tsc --noEmit`)
- **Date:** 2026-08-11
- **Result:** 48 lines of TS errors exist at HEAD, predating phase 10. None of
  the 4 phase-10 files (onboardingStatus.ts, onboardingStatus.test.ts,
  TrialRequestsPanel.tsx, PendingAccessDashboard.tsx) appear in the error list —
  phase-10 work is delta-clean.
- **Categories:**
  1. Missing shadcn/ui peer deps (module-not-found):
     `react-hook-form`, `input-otp`, `react-resizable-panels`, `sonner`,
     `next-themes`, `react-day-picker`, `embla-carousel-react`, `cmdk`,
     `vaul` (files under `frontend/src/components/ui/`).
  2. Legacy unused/type issues: `App.tsx:1625` (TS2322), `AuctionMarketplace.tsx`
     (TS6133 unused), `Dashboard.tsx`, `InventoryVault.tsx`,
     `PendingApprovalPanel.tsx`, `AuctionSettlements.tsx`,
     `components/ui/chart.tsx` (recharts `payload` typing),
     `pages/admin/PlatformAnalytics.tsx` (unused imports + `additionalDays`),
     `pages/admin/OwnerComplianceDashboard.tsx` (unused `Document`).
- **Impact on 10-04:** None. `npx vitest run src/lib/__tests__/onboardingStatus.test.ts`
  passes 23/23 and `npm run build` succeeds (chunk-size + dynamic-import
  warnings only). The plan's "typecheck green" is interpreted delta-clean.
- **Action:** Before the defense demo, either `npm install` the missing shadcn
  peers or remove the unused `ui/` wrappers; sweep the legacy unused imports.
  This is part of the pre-defense cleanup, not a phase-10 gate.

## 10-04: Task 3 commit carried interleaved prior draft-flow WIP in PendingAccessDashboard.tsx

- **Found during:** 10-04 Task 3 commit (`68735f9`)
- **Date:** 2026-08-11
- **Description:** The working-tree version of `PendingAccessDashboard.tsx`
  already contained uncommitted draft-flow additions from prior owner-registration
  work (DRAFT create-on-upload in `handleUploadDocument`, `hasDraft` /
  `allRequiredDocsUploaded` submit gating, DRAFT cancellability). Task 3's
  banner/refresh hunks are interleaved with these edits in the same regions, so
  they could not be separated with `git add -p`; the file was committed whole
  with the prior WIP noted in the commit body.
- **Action:** Verified the file content is coherent and both feature sets are
  complete. No separate action required; recorded for traceability.

