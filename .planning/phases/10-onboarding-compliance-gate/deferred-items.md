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
