# Deferred Items — Phase 08 Plan 01

Out-of-scope pre-existing failures observed during 08-01 execution. Per the
execution scope boundary (only auto-fix issues directly caused by the current
task's changes), these were logged, not fixed.

## Backend (8 jest suites) — pre-existing mock debt

`npm test` in backend/ fails on suites untouched by 08-01 (`git diff HEAD~4..HEAD`
touches only the 7 plan files):

- `src/kyc/kyc-validation.spec.ts`
- `src/subscription/subscription.service.spec.ts`
- `src/attendance/attendance.service.spec.ts`
- `src/notification/notification.service.spec.ts`
- `src/queue/queue.service.spec.ts`
- `src/loan/loan-contract.service.spec.ts`
- `src/auction/auction-settlement.service.spec.ts`
- `src/loan/loan-history.service.spec.ts`

Observed root causes (sampled runs):

- `TypeError: this.prisma.ensureConnected is not a function` — the services call
  `PrismaService.ensureConnected` (exists at `backend/src/prisma.service.ts:151`)
  but the specs' mocked PrismaService objects do not define it.
- `TypeError: Cannot read properties of undefined (reading 'findUnique')` — spec
  prisma mocks are missing nested model delegates the service touches.

Fix owner: a future test-hygiene pass (repair the specs' PrismaService mocks),
NOT part of Phase 8 RBAC work.

## Frontend (2 vitest cases) — pre-existing failures

- `src/components/__tests__/AuctionQueue.test.tsx` — "returns an item to the vault":
  `Auction queue fetch error: TypeError: Cannot read properties of undefined (reading 'getItem')`
  (localStorage not stubbed for the component's fetch path)
- `src/components/__tests__/InventoryVault.test.tsx` — "marks active items for auction":
  `supabase.from(...).select(...).in is not a function` (mock chain incomplete)

Both are unrelated to the new `ApprovalQueue.test.tsx` scaffold.

## Expected RED (NOT deferred — closes in 08-02/08-03)

- backend: `src/approval/approval.service.spec.ts` + `approval.controller.spec.ts`
  (`Cannot find module './approval.service' / './approval.controller'`)
- frontend: `src/components/__tests__/ApprovalQueue.test.tsx`
  (`Failed to resolve import "../ApprovalQueue"`)
