# Deferred Items — Phase 08 Plan 2

Out-of-scope discoveries logged during execution of 08-02 (not fixed, per scope boundary rule).

## Pre-existing failing test suites (baseline, unrelated to 08-02)

The following suites fail on `npm test` in the backend and were failing before this plan's commits
(confirmed: none of their files appear in `git diff --name-only` for this plan; full-suite failure
counts are identical before and after the 08-02 commits `0c2baf5`, `1e16aed`, `2b4abe4`):

| Suite | Failure signature |
|-------|-------------------|
| `kyc/kyc-validation.spec.ts` | mock delegate `findUnique` undefined at call time |
| `attendance/attendance.service.spec.ts` | `this.prisma.ensureConnected is not a function` |
| `notification/notification.service.spec.ts` | `this.prisma.ensureConnected is not a function` / mock `findUnique` undefined |
| `subscription/subscription.service.spec.ts` | tier/status/maxBranches expectations vs pre-existing working-copy changes in `subscription.service.ts` (out-of-scope uncommitted file) |
| `queue/queue.service.spec.ts` | mock `findUnique` undefined |
| `loan/loan-contract.service.spec.ts` | TestingModule never provides `StorageService`, which `LoanContractService`'s constructor now requires (index 3) |
| `loan/loan-history.service.spec.ts` | TestingModule compile failure (same dependency resolution family) |
| `auction/auction-settlement.service.spec.ts` | `expect(...).toThrow` mismatch / tier update noise |

Suggested remediation (future plan): update the loan-contract / loan-history specs to provide
`StorageService`; reconcile `PrismaService.ensureConnected` mocking for attendance/notification;
decide whether the uncommitted `subscription.service.ts` working-copy changes are wanted, then align
its spec. These are all test-infrastructure debts, not phase-08 regressions.

---

# Deferred Items — Phase 08 Plan 3 (frontend)

Out-of-scope discoveries logged during execution of 08-03 (not fixed, per scope boundary rule).

## Pre-existing failing frontend suites (baseline, unrelated to 08-03)

Fail on `npm test` in frontend/ and were failing before 08-03's commits (confirmed: neither file
appears in `git diff --name-only` for 08-03; suite totals identical before/after `da39236`,
`30d7b12`, `a960273`):

| Suite | Failure signature |
|-------|-------------------|
| `frontend/src/components/__tests__/AuctionQueue.test.tsx` | `returns an item to the vault` — SweetAlert2 crashes at `window.matchMedia('(prefers-color-scheme: dark)').addEventListener(...)` under jsdom (matchMedia not implemented) |
| `frontend/src/components/__tests__/InventoryVault.test.tsx` | "Gold Necklace" expectation mismatch (pre-existing) |

Suggested remediation (future plan): add a `window.matchMedia` stub to `frontend/src/test/setup.ts`
(alongside the localStorage polyfill) and reconcile the InventoryVault fixture.

## Query-param mismatch between the RED frontend scaffold and the backend DTO

RESOLVED in commit `013f12e`: the backend `ApprovalQueueQueryDto` now declares BOTH `type`
(the locked 08-01 frontend contract param) and `targetType` (the RED controller-spec param);
`ApprovalService.getQueue` honors `query.targetType ?? query.type`, so the server-side type
filter works for real frontend requests (which send `type`) instead of being silently dropped
by the whitelist ValidationPipe. Regression test added to `approval.service.spec.ts`. The
client-side tab filtering in the ApprovalQueue component remains as harmless redundancy.

