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
