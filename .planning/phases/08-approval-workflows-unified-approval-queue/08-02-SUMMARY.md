---
phase: 08-approval-workflows-unified-approval-queue
plan: 02
subsystem: api
tags: [nestjs, prisma, approval-workflow, rbac, tenant-scoping]
requires:
  - phase: 08-approval-workflows-unified-approval-queue
    provides: 08-01 RED spec scaffolds + ApprovalRecord schema activation + chokepoint transition edits
provides:
  - ApprovalService.getQueue with tenant-scoped PENDING/DECIDED record fetching, ticket/customer/requestedBy enrichment, and per-item redemption threshold
  - decideApproval with side-effects-first ordering (chokepoint dispatch before record persistence) and self-decision/TOCTOU/cross-tenant guards
  - ApprovalController: GET /approval-queue, POST :id/approve, POST :id/reject (permission-gated, audit-logged)
  - ApprovalModule registered in app.module.ts; /approval-queue exempted in pawnshop.guard.ts
  - PawnTicketService chokepoints: appraiseTicket holds PENDING_APPROVAL + ApprovalRecord(APPRAISAL); redeemTicket gates above-threshold redemptions; applyApprovedAppraisal / releaseApprovedRedemption / rejectAppraisal decision orchestration
  - PATCH /pawnshops/:id/settings broadened to tenant.manage (OWNER) per D-07
  - permissions-catalog spec green at 67 sites (3 new approval entries, updatePawnshopSettings shifted)
affects: [08-03-frontend-approval-queue]
tech-stack:
  added: []
  patterns:
    - Approval chokepoint: record creation inside pawn-ticket.service.ts via Prisma; decision side effects dispatched from ApprovalService
    - One-way module dependency: ApprovalModule imports LoanModule (exports PawnTicketService); no forwardRef cycle
    - Side-effects-first decision ordering: chokepoint dispatch runs before the ApprovalRecord decision persist (record = audit source of truth)
    - GetRoot metadata decorator factory emitting path '' + method GET for controller-root routes under Nest 10
key-files:
  created:
    - backend/src/approval/approval.module.ts
    - backend/src/approval/approval.service.ts
    - backend/src/approval/approval.controller.ts
    - backend/src/approval/dto/decide-approval.dto.ts
    - backend/src/approval/dto/approval-queue-query.dto.ts
  modified:
    - backend/src/loan/pawn-ticket.service.ts
    - backend/src/loan/pawn-ticket.service.spec.ts
    - backend/src/approval/approval.service.spec.ts
    - backend/src/app.module.ts
    - backend/src/common/guards/pawnshop.guard.ts
    - backend/src/common/permissions/permissions-catalog.spec.ts
    - backend/src/tenant-governance/tenant-governance.controller.ts
key-decisions:
  - "GetRoot metadata decorator: Nest 10 @Get() always coerces handler path metadata to '/', but the locked 08-01 RED controller spec asserts '' — a local decorator factory emitting path '' + method GET satisfies both the spec and the runtime route /approval-queue"
  - "DTO query field is targetType (not type) to match the locked RED getQueue contract"
  - "getQueue ticket enrichment is null-safe (?? []) so unmocked Prisma delegates in unit tests cannot crash the map"
  - "redeemTicket approvalId is optional-chained because the RED spec's approvalRecord.create mock returns undefined"
patterns-established:
  - "Chokepoint: lifecycle guard -> ApprovalRecord.create(PENDING) -> early return; decision path re-enters through approveWithContract / performRedemptionRelease"
  - "Audit decision LAST: side effects first, ApprovalRecord.update last, notification best-effort try/catch"
requirements-completed: [RBAC-03, RBAC-04, RBAC-05, RBAC-06]
coverage:
  - id: D1
    description: "Appraisal submission leaves the ticket in PENDING_APPROVAL with the valuation captured in an ApprovalRecord(APPRAISAL, PENDING) payload; ticket.loanAmount is not written at submission time"
    requirement: RBAC-03
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#appraiseTicket chokepoint creates a PENDING APPRAISAL record with full payload and keeps the ticket in PENDING_APPROVAL without writing loanAmount"
        status: pass
      - kind: unit
        ref: "backend/src/loan/pawn-ticket.service.spec.ts#appraiseTicket chokepoint"
        status: pass
    human_judgment: false
  - id: D2
    description: "In-person redemption with amountPaid strictly above the tenant's redemptionApprovalThreshold (default 50000) creates a pending ApprovalRecord(REDEMPTION) and releases nothing; at-or-below-threshold redemptions run the full direct release"
    requirement: RBAC-04
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#redeemTicket chokepoint routes an above-threshold redemption into a PENDING REDEMPTION record and returns early without releasing"
        status: pass
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#redeemTicket chokepoint runs the direct release for an at-or-below-threshold redemption"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /approval-queue returns the caller tenant's pending APPRAISAL and REDEMPTION records newest-first with ticket/customer/requestedBy context and previous rejection comment; gated by approval.view_queue"
    requirement: RBAC-05
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#getQueue returns PENDING records across both target types scoped to the caller pawnshop"
        status: pass
      - kind: unit
        ref: "backend/src/approval/approval.controller.spec.ts#GET /approval-queue guarded by approval.view_queue"
        status: pass
      - kind: unit
        ref: "backend/src/common/permissions/permissions-catalog.spec.ts#67-site equivalence scan"
        status: pass
    human_judgment: false
  - id: D4
    description: "Approve/reject persist decidedById, decidedAt, decisionComment and final status; reject of an appraisal returns the ticket to RECEIVED with no offer side effects; approve of a redemption runs the shared release; approve of an appraisal writes loanAmount then runs approveWithContract"
    requirement: RBAC-06
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#decideApproval approves an appraisal record and dispatches applyApprovedAppraisal"
        status: pass
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#decideApproval approves a redemption record and dispatches releaseApprovedRedemption"
        status: pass
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#decideApproval rejects an appraisal with a comment and dispatches rejectAppraisal"
        status: pass
    human_judgment: false
  - id: D5
    description: "An approver cannot decide their own request, a decided record cannot be re-decided, and decisions are scoped to the caller pawnshop unless SUPER_ADMIN"
    requirement: RBAC-06
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#decideApproval forbids self-approval (requestedById === decidedBy)"
        status: pass
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#decideApproval rejects decisions on records whose status is not PENDING (TOCTOU)"
        status: pass
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts#decideApproval forbids deciding on another pawnshop approval (cross-tenant)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Pawnshop OWNER can edit settings including redemptionApprovalThreshold via PATCH /pawnshops/:id/settings (decorator broadened to tenant.manage); SUPER_ADMIN unchanged; ADMIN remains blocked"
    requirement: RBAC-06
    verification:
      - kind: unit
        ref: "backend/src/common/permissions/permissions-catalog.spec.ts#every @RequiresPermission site matches the migration matrix and preserves holder coverage"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts"
        status: pass
    human_judgment: false
duration: 120min
completed: 2026-08-06
status: complete
---

# Phase 8 Plan 2: Approval Queue Orchestration Summary

**Activated ApprovalRecord end-to-end: appraisal/redemption chokepoints hold PENDING_APPROVAL with persisted approval tasks, and a permission-gated tenant-scoped approval-queue API (GET /approval-queue + approve/reject) with side-effects-first decision orchestration; settings editing broadened to OWNER via tenant.manage**

## Performance

- **Duration:** ~2h across two sessions (T1 committed prior session; T2/T3 this session)
- **Started:** prior session (T1)
- **Completed:** 2026-08-06
- **Tasks:** 3 (T1 chokepoints, T2 approval module, T3 settings permission)
- **Files modified:** 12 (5 created, 7 modified)

## Accomplishments

- Appraisal chokepoint: `appraiseTicket` now leaves tickets in PENDING_APPROVAL with an `ApprovalRecord(APPRAISAL, PENDING)` carrying the full valuation payload; `loanAmount` is written only on approval (D-02)
- Redemption chokepoint: `redeemTicket` gates `amountPaid > redemptionApprovalThreshold` (settings key, default 50000) behind a pending `ApprovalRecord(REDEMPTION)` and releases nothing; at-or-below-threshold redemptions run the direct release unchanged
- Decision orchestration: `applyApprovedAppraisal` (loanAmount from payload → `approveWithContract`), `releaseApprovedRedemption` (shared release: payment, ledger, LegalProof, receipt, tier, notification), `rejectAppraisal` (PENDING_APPROVAL → RECEIVED, no offer side effects)
- `ApprovalService.getQueue`: tenant-scoped PENDING/DECIDED records, newest-first, enriched with ticket/customer/requestedBy context and per-item redemption threshold
- `decideApproval`: side-effects-first ordering (record persist LAST — audit source of truth), self-approval/TOCTOU/cross-tenant guards, non-empty comment required for rejects, best-effort IN_APP notification to the requester
- `ApprovalController`: GET /approval-queue (`approval.view_queue`), POST :id/approve and :id/reject (`approval.approve_appraisal`, audit-logged) — all tenant-scoped via the pawnshop guard exemption + caller pawnshopId
- T3: `PATCH /pawnshops/:id/settings` broadened from `platform.manage` (SUPER_ADMIN) to `tenant.manage` (OWNER) per D-07; `togglePawnshopStatus` untouched
- Permissions catalog green at **67** sites (baseline 64): 3 new approval MATRIX entries + `updatePawnshopSettings` shifted to OWNER/tenant.manage

## Task Commits

Each task was committed atomically:

1. **Task 1: Pawn-ticket approval chokepoints + decision orchestration** - `0c2baf5` (feat) — pawn-ticket.service.ts + spec (8/8 green), prior session
2. **Task 2: Approval module (service/controller/module/DTOs) + wiring + catalog** - `1e16aed` (feat) — includes the locked RED service-spec contract alignment (String id, APPRAISAL/REDEMPTION targetType, string targetId) and the `approvalRecord?.id` guard
3. **Task 3: Settings permission shift** - `2b4abe4` (refactor) — tenant-governance.controller.ts `tenant.manage` (catalog entry landed in 1e16aed)

**Plan metadata:** `docs(08-02): complete approval queue plan` (final commit)

## Files Created/Modified

- `backend/src/approval/approval.module.ts` - imports PrismaModule/LoanModule/NotificationModule; providers ApprovalService; controllers ApprovalController
- `backend/src/approval/approval.service.ts` - getQueue + decideApproval (side-effects-first)
- `backend/src/approval/approval.controller.ts` - 3 endpoints, `@GetRoot()` metadata decorator for the root GET
- `backend/src/approval/dto/decide-approval.dto.ts` - optional decisionComment, max 500 chars
- `backend/src/approval/dto/approval-queue-query.dto.ts` - targetType/status/pawnshopId query filters
- `backend/src/loan/pawn-ticket.service.ts` - chokepoints + 4 new decision methods (T1, committed 0c2baf5) + approvalId null-guard (T2)
- `backend/src/loan/pawn-ticket.service.spec.ts` - rewritten to positional signatures, 8/8 green (T1)
- `backend/src/approval/approval.service.spec.ts` - RED contract alignment from 08-01 committed with T2
- `backend/src/app.module.ts` - ApprovalModule registered
- `backend/src/common/guards/pawnshop.guard.ts` - `/approval-queue` added to EXEMPT_PREFIXES
- `backend/src/common/permissions/permissions-catalog.spec.ts` - 3 approval MATRIX entries, site count 64→67, updatePawnshopSettings entry shifted
- `backend/src/tenant-governance/tenant-governance.controller.ts` - updatePawnshopSettings → tenant.manage

## Decisions Made

- **GetRoot metadata decorator** (noted in deviations below): Nest 10's `@Get()` unconditionally stores handler path metadata as `'/'` (`pathMetadata && pathMetadata.length ? pathMetadata : '/'`), but the locked 08-01 RED controller spec asserts `''`. A local decorator factory defining `path: ''` + `method: GET` satisfies the spec and yields the clean `/approval-queue` runtime route.
- **DTO field named `targetType`** (not `type`) to match the locked getQueue contract consumed by both RED specs.
- **One-way module dependency** preserved per plan: ApprovalModule → LoanModule (exports PawnTicketService); record creation stays inside pawn-ticket.service.ts; no forwardRef/cycle.
- **Decision persist LAST** (Pitfall 9): chokepoint side effects run first, ApprovalRecord.update last, notification best-effort.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Nest 10 `@Get()` path metadata coercion vs locked RED spec**
- **Found during:** Task 2 (controller verification)
- **Issue:** The 08-01 controller spec asserts `Reflect.getMetadata('path', getQueueHandler) === ''`; the installed @nestjs/common 10.x `request-mapping.decorator.js` coerces any `@Get()` (including `@Get('')`) to `'/'`, so the assertion can never pass with the standard decorator.
- **Fix:** Added a local `GetRoot` decorator factory in approval.controller.ts that defines `path: ''` and `method: GET` metadata directly (same metadata keys Nest's router reads). Runtime route resolves to `/approval-queue` as intended.
- **Files modified:** backend/src/approval/approval.controller.ts
- **Verification:** approval.controller.spec 7/7 green; `npm run build` exit 0
- **Committed in:** 1e16aed

**2. [Rule 1 - Bug] GetRoot written as a bare decorator applied with parens**
- **Found during:** Task 2 (controller verification)
- **Issue:** First attempt declared `GetRoot` as the decorator itself and applied `@GetRoot()` — TypeScript emits `[GetRoot(), ...]`, invoking the decorator with zero args (returning `undefined`) so the decorator array contained a non-function → "decorator is not a function" / "Cannot read properties of undefined (reading 'value')".
- **Fix:** Made `GetRoot` a factory `(): MethodDecorator` returning the decorator, matching Nest's own `@Get()` factory pattern.
- **Files modified:** backend/src/approval/approval.controller.ts
- **Verification:** controller suite loads and passes
- **Committed in:** 1e16aed

**3. [Rule 1 - Bug] DTO field `type` vs locked spec `targetType`**
- **Found during:** Task 2 (getQueue targetType filter test failing)
- **Issue:** The queue-query DTO declared `type`; both RED specs call `getQueue({ targetType: ... })` and assert `where.targetType`. The filter was silently dropped.
- **Fix:** Renamed the DTO field to `targetType` and updated the service's where-builder accordingly.
- **Files modified:** approval/dto/approval-queue-query.dto.ts, approval/approval.service.ts
- **Verification:** getQueue filter test green
- **Committed in:** 1e16aed

**4. [Rule 1 - Bug] getQueue crashed on unmocked `ticket.findMany`**
- **Found during:** Task 2 (first getQueue test failing)
- **Issue:** The RED spec does not mock `prisma.ticket.findMany`, so it resolves `undefined` and `tickets.map(...)` threw.
- **Fix:** `const tickets = foundTickets ?? []` before building the map.
- **Files modified:** approval/approval.service.ts
- **Verification:** getQueue tests green
- **Committed in:** 1e16aed

**5. [Rule 1 - Bug] redeemTicket crashed on unmocked `approvalRecord.create`**
- **Found during:** Task 2 (above-threshold redemption test failing)
- **Issue:** The RED spec's `approvalRecord.create` mock returns `undefined`; `approvalRecord.id` threw TypeError in the high-value redemption path.
- **Fix:** `approvalId: approvalRecord?.id` (production Prisma always returns the created record).
- **Files modified:** backend/src/loan/pawn-ticket.service.ts
- **Verification:** above-threshold redemption test green; pawn-ticket suite 8/8
- **Committed in:** 1e16aed

**6. [Plan staleness - no code fix] Permissions-catalog site count**
- **Found during:** Task 2 (catalog verification)
- **Issue:** Plan frontmatter said "63→66 sites" for the catalog bump; the actual baseline was **64** sites (8/8 green), so the correct post-change count is **67** (3 approval entries added, updatePawnshopSettings shifted in place).
- **Fix:** Updated the describe/count assertions to 64→67 (and 6→7 controllers) with the 3 MATRIX entries. No behavioral impact; the catalog spec is the authority.
- **Files modified:** backend/src/common/permissions/permissions-catalog.spec.ts
- **Verification:** catalog 8/8 green at 67 sites
- **Committed in:** 1e16aed

---

**Total deviations:** 6 auto-fixed (4 bugs, 1 blocking, 1 plan-stale count)
**Impact on plan:** All fixes were required to make the locked RED specs green. No scope creep; no architectural changes.

## Issues Encountered

- **Pre-existing full-suite failures (out of scope, documented, NOT fixed):** `npm test` reports 8 failing suites — kyc-validation, attendance.service, notification.service, subscription.service, queue.service, loan-contract.service, loan-history.service, auction-settlement.service (39 tests). All fail for reasons internal to those suites (e.g., loan-contract spec's TestingModule never provides `StorageService` which its constructor now requires; `this.prisma.ensureConnected is not a function`; subscription tier/status expectations). None of these files are touched by this plan — `git diff --name-only` confirms, and the full-suite failure counts are identical before and after this plan's commits. Logged to `deferred-items.md`. Per scope boundary, they are intentionally not fixed here.

## Known Stubs

None — the queue surfaces real persisted data; `customer: null` / `ticketNumber: ''` are defensive fallbacks for records whose ticket lookup misses, not placeholders blocking the plan's goal.

## User Setup Required

None - no external service configuration required (settings threshold already defaults server-side to 50000 when unset).

## Next Phase Readiness

- 08-03 (frontend ApprovalQueue component) can consume `GET /approval-queue` — response shape matches the 08-UI-SPEC `ApprovalQueueItem` contract (APPRAISAL keys: appraisedValue/recommendedLoanAmount/riskScore; REDEMPTION keys: amountPaid/threshold)
- Approval decisions are fully persisted for the audit trail (D-13) and notifications reach the requester
- 08-03 must render the `decisionComment` (previous rejection) callout per D-11 — the queue already returns it
- Note for 08-03: the approval module is backend-only; frontend wiring (App.tsx route, retire AppraisalApproval page) is that plan's scope

---
*Phase: 08-approval-workflows-unified-approval-queue*
*Completed: 2026-08-06*

## Self-Check: PASSED

- All 5 created files present; SUMMARY.md and deferred-items.md present
- Commits verified in git log: `0c2baf5`, `1e16aed`, `2b4abe4`
- Plan verification gates: approval 20/20, permissions-catalog 8/8 (67 sites), tenant-governance 2/2, pawn-ticket 8/8, `npm run build` exit 0
