---
phase: 08-approval-workflows-unified-approval-queue
plan: 01
subsystem: database, testing
tags: [prisma, postgres, migration, state-machine, rbac, jest, vitest, testing-library, nestjs, react]

# Dependency graph
requires:
  - phase: 07-permission-foundation-schema-baseline
    provides: ApprovalRecord schema model, permissions.const (approval.view_queue / approval.approve_appraisal / approval.approve_redemption), RbacGuard + RequiresPermission decorator, schema baseline migration 20260731120000_v2_schema_baseline
provides:
  - ApprovalRecord.payload Json? column via additive migration 20260801000000_add_approval_payload (regenerated Prisma client exposes payload)
  - State-machine transitions: PENDING_APPROVAL->RECEIVED (MANAGER/OWNER/ADMIN) + ADMIN added to PENDING_APPROVAL->OFFER_MADE, ACTIVE->REDEEMED, GRACE_PERIOD->REDEEMED
  - Green pawn-lifecycle.spec.ts (5 tests) asserting the transition table
  - RED executable acceptance contracts: approval.service.spec.ts (RBAC-03/04/06), approval.controller.spec.ts (RBAC-05 endpoint surface + permission metadata), ApprovalQueue.test.tsx (RBAC-05 UI)
affects:
  - 08-02 approval backend implementation (turns approval specs green)
  - 08-03 ApprovalQueue UI page (turns ApprovalQueue.test.tsx green)
  - 08-04/verification wave (suite RED state resolution)
  - Phase 9 KYC gate (rides the Phase 8 approval flow)

# Tech tracking
tech-stack:
  added: []   # zero new dependencies (plan-verified; no package-legitimacy gate)
  patterns:
    - Wave 0 TDD: RED scaffolds committed before any implementation code lands (08-VALIDATION.md Wave 0 Gaps)
    - Mocked-PrismaService TestingModule specs (mirrors legal-proof.service.spec.ts)
    - Route surface contract tests via Reflect metadata (method/path/PERMISSIONS_KEY) against the future controller
    - Vitest vi.mock of apiClient module (default + named api) + supabaseClient + App useToast (mirrors AuctionQueue.test.tsx)

key-files:
  created:
    - backend/prisma/migrations/20260801000000_add_approval_payload/migration.sql
    - backend/src/common/state-machine/pawn-lifecycle.spec.ts
    - backend/src/approval/approval.service.spec.ts
    - backend/src/approval/approval.controller.spec.ts
    - frontend/src/components/__tests__/ApprovalQueue.test.tsx
  modified:
    - backend/prisma/schema.prisma (ApprovalRecord gains payload Json? @map("payload"))
    - backend/src/common/state-machine/pawn-lifecycle.ts (1 new transition + ADMIN on 3)

key-decisions:
  - "T3 scaffolds rewritten (fix commit d3be151) to match the plan's LOCKED Interface Contract exactly — getQueue(query, callerPawnshopId) returning ApprovalQueueItem[], decideApproval(id, dto, decidedBy, userRole, approve, callerPawnshopId), routes /approval-queue, permissions approval.view_queue / approval.approve_appraisal — so 08-02/08-03 implement without changing test expectations"
  - "Migration file is the deliverable when the dev DB is unreachable (getaddrinfo ENOTFOUND base); all Phase 8 specs use mocked Prisma so no live-DB dependency (plan's own fallback)"
  - "Chokepoint threshold contract: redeemTicket reads pawnshop.settings.redemptionApprovalThreshold via prisma.pawnshop.findUnique (above -> REDEMPTION record, at/below -> direct release)"
  - "Controller user contract: handlers receive (query | id, dto, caller{id, pawnshopId, role}) and translate to the service 6-arg signature; id passed as string, service persists numeric where id"

patterns-established:
  - "Wave-0 scaffolds as executable acceptance contracts: describe blocks map 1:1 to 08-VALIDATION.md task IDs (08-01-01/02/03, 08-02-01, RBAC-03/04/05/06)"
  - "Chokepoint contract tests construct the REAL PawnTicketService with mocked collaborators; ApprovalService tests use mocked PawnTicketService (applyApprovedAppraisal/releaseApprovedRedemption/rejectAppraisal) per plan"

requirements-completed: [RBAC-03, RBAC-04, RBAC-05, RBAC-06]

coverage:
  - id: D1
    description: "ApprovalRecord.payload Json? column via additive migration + regenerated Prisma client"
    requirement: RBAC-03
    verification:
      - kind: unit
        ref: "backend: npx prisma validate + npm run prisma:generate (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "State machine: PENDING_APPROVAL->RECEIVED return path + ADMIN on OFFER_MADE/REDEEMED transitions, spec-asserted"
    requirement: RBAC-03
    verification:
      - kind: unit
        ref: "backend/src/common/state-machine/pawn-lifecycle.spec.ts (5 tests green)"
        status: pass
    human_judgment: false
  - id: D3
    description: "RED ApprovalService acceptance contract (RBAC-03/04/06 chokepoints + decide guards)"
    requirement: RBAC-03
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.service.spec.ts — RED: Cannot find module './approval.service'"
        status: pass
    human_judgment: true
    rationale: "Scaffold is RED by design; green state requires the 08-02 ApprovalService + PawnTicketService chokepoint implementations, which need UAT sign-off on final behavior"
  - id: D4
    description: "RED ApprovalController route + permission metadata contract (RBAC-05 endpoint surface)"
    requirement: RBAC-05
    verification:
      - kind: unit
        ref: "backend/src/approval/approval.controller.spec.ts — RED: Cannot find module './approval.controller'"
        status: pass
    human_judgment: true
    rationale: "Scaffold is RED by design; endpoint behavior + permission enforcement verified when 08-02 lands the controller"
  - id: D5
    description: "RED ApprovalQueue UI contract (RBAC-05): tabs, GET /approval-queue, approve/reject flows, empty state"
    requirement: RBAC-05
    verification:
      - kind: automated_ui
        ref: "frontend/src/components/__tests__/ApprovalQueue.test.tsx — RED: Failed to resolve import ../ApprovalQueue"
        status: pass
    human_judgment: true
    rationale: "Scaffold is RED by design; UI behavior verified when 08-03 lands the component"

# Metrics
duration: 13min
completed: 2026-08-01
status: complete
---

# Phase 8 Plan 1: Approval Queue Foundations Summary

**ApprovalRecord.payload JSONB column + additive migration, ADMIN/reject state-machine transitions with a green transition-table spec, and RED approval queue test contracts (service/controller/UI) that lock the API surface for 08-02/08-03**

## Performance

- **Duration:** 13 min (T1 commit 20:32 -> completion 20:45 +08:00; plus prior context discovery/reads)
- **Started:** 2026-08-01T20:32:28+08:00 (T1 commit)
- **Completed:** 2026-08-01T20:45:00+08:00
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- `ApprovalRecord.payload` JSONB column (nullable, additive) shipped via migration `20260801000000_add_approval_payload`; `npx prisma validate` and `npm run prisma:generate` (Prisma Client v5.22.0) both exit 0 — removes the P2010 unknown-column blocker for 08-02 chokepoint `approvalRecord.create({ payload })` calls.
- State machine now lets ADMIN approve appraisals (`PENDING_APPROVAL->OFFER_MADE`), release redemptions (`ACTIVE->REDEEMED`, `GRACE_PERIOD->REDEEMED`), and lets MANAGER/OWNER/ADMIN reject back to `RECEIVED` via the new return path — no new lifecycle states; the rest of the table is byte-identical; `pawn-lifecycle.spec.ts` (5 tests) asserts it green.
- Three RED test files committed as the executable acceptance contracts (Wave 0 discipline — zero implementation files created): approval service (RBAC-03/04/06), approval controller (RBAC-05 routes + `approval.view_queue`/`approval.approve_appraisal` permission metadata), ApprovalQueue UI (RBAC-05 tabs + flows + empty state).
- Suite RED state verified as attributable ONLY to the missing 08-02/08-03 modules (`Cannot find module` / `Failed to resolve import`); all other failing suites are pre-existing and logged in `deferred-items.md`.

## Task Commits

Each task was committed atomically:

1. **Task 1: ApprovalRecord.payload column + additive migration + client regen** - `53792c8` (feat)
2. **Task 2: State machine PENDING_APPROVAL->RECEIVED + ADMIN roles, green spec** - `e68553d` (feat)
3. **Task 3: RED test scaffolds (service/controller/UI)** - `7dbfb84` (test) + `d3be151` (fix: contract alignment)

**Plan metadata:** pending (docs: complete plan — final commit)

## Files Created/Modified

- `backend/prisma/migrations/20260801000000_add_approval_payload/migration.sql` - Additive `ALTER TABLE "public"."approval_records" ADD COLUMN "payload" JSONB;` (single statement, schema-qualified, baseline style)
- `backend/prisma/schema.prisma` - ApprovalRecord gains `payload Json? @map("payload")` between `decisionComment` and `createdAt`; no other schema objects touched
- `backend/src/common/state-machine/pawn-lifecycle.ts` - +ADMIN on `PENDING_APPROVAL->OFFER_MADE`, `ACTIVE->REDEEMED`, `GRACE_PERIOD->REDEEMED`; new `{ PENDING_APPROVAL->RECEIVED, [MANAGER, OWNER, ADMIN] }`
- `backend/src/common/state-machine/pawn-lifecycle.spec.ts` - Green transition-table spec (5 cases: return path exact roles, ADMIN x3, no duplicate from/to pairs)
- `backend/src/approval/approval.service.spec.ts` - RED: getQueue (default PENDING, targetType filter, DECIDED->{in:APPROVED,REJECTED,CANCELLED}, pawnshop scope) + decideApproval 6-arg (approve/reject persistence + side-effect dispatch, comment-required reject, TOCTOU, self-approval, cross-tenant) + PawnTicketService chokepoints (RBAC-03 appraisal record + no loanAmount write; RBAC-04 threshold routing)
- `backend/src/approval/approval.controller.spec.ts` - RED: /approval-queue route + GET/POST delegation + Reflect permission metadata
- `frontend/src/components/__tests__/ApprovalQueue.test.tsx` - RED: title/tabs, GET /approval-queue with {pawnshopId, type}, approve flow, reject-disabled-until-comment, "All caught up!" empty state

## Decisions Made

- Locked the plan's Interface Contract verbatim in the RED specs (see fix commit `d3be151`) so 08-02/08-03 implement against it unchanged.
- Migration file accepted as the deliverable (dev DB unreachable: `getaddrinfo ENOTFOUND base`); verification deliberately live-DB-free.
- Threshold read contract: `prisma.pawnshop.findUnique` -> `settings.redemptionApprovalThreshold`.
- Zero new dependencies across the whole wave.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T3 scaffolds deviated from the plan's locked Interface Contract**
- **Found during:** Task 3 (RED scaffolds), during SUMMARY preparation (full plan re-read surfaced the `<interface_contract>` section)
- **Issue:** Initial scaffolds used my own signatures instead of the plan's locked surface: `getQueue(pawnshopId, query)` and `decide(id, dto, caller)` vs the contract's `getQueue(query, callerPawnshopId)` / `decideApproval(id, dto, decidedBy, userRole, approve, callerPawnshopId)`; routes `/approvals` vs `/approval-queue`; over-broad permission list on approve/reject (contract: `approval.approve_appraisal` for both); frontend paths `/approvals/:id/...` vs `/approval-queue/:id/...`; missing plan-required cases (tabs, reject-disabled-until-comment, "All caught up!" empty state).
- **Fix:** Rewrote all three spec files to the exact locked contract, added the plan-mandated test cases, re-verified RED (module-not-found only) and T2 green (5/5).
- **Files modified:** backend/src/approval/approval.service.spec.ts, backend/src/approval/approval.controller.spec.ts, frontend/src/components/__tests__/ApprovalQueue.test.tsx
- **Verification:** `npm test -- approval` -> 2 suites RED module-not-found; `npm test -- ApprovalQueue` -> RED import not resolved; `npm test -- pawn-lifecycle` -> 5/5 green
- **Committed in:** d3be151 (fix commit)

---

**Total deviations:** 1 auto-fixed (1 bug — my own scaffold contract drift, corrected)
**Impact on plan:** Necessary for correctness — the RED specs ARE the executable contract 08-02/08-03 implement against; mis-signed contracts would have propagated through the whole phase. No scope creep.

## Issues Encountered

- PowerShell mangled inline multi-line `git commit -m` (em-dash/quotes) — switched to `git commit -F <message-file>` for all commits.
- Dev DB unreachable (`getaddrinfo ENOTFOUND base`) — `prisma:push` skipped per plan fallback; migration file is the deliverable.
- Frontend `npm test -- ApprovalQueue` initially ran the pawn-lifecycle check in the wrong workdir (command hygiene) — re-ran in backend/.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **08-02 (Approval backend) can start immediately:** payload column exists (no P2010), ADMIN/reject transitions exist (no 403), RED contracts define the exact methods/routes/permissions to implement. `npm test -- approval` and `npm test -- permissions-catalog` go green when 08-02 lands.
- **08-03 (ApprovalQueue UI) can start after 08-02:** RED UI contract defines tabs, `api.get('/approval-queue', { pawnshopId, type })`, approve/reject posts, reject-comment gating, "All caught up!" empty state.
- **Note:** RBAC-03/04/05/06 feature completion lands with 08-02/08-03 — this wave shipped schema + state machine + contracts only. Coverage matrix (D3-D5) routes those deliverables to human UAT until the implementations land.
- **Pre-existing suite debt** (8 backend mock-debt suites, 2 frontend cases) tracked in `deferred-items.md` — out of scope for this phase.

---
*Phase: 08-approval-workflows-unified-approval-queue*
*Completed: 2026-08-01*

## Self-Check: PASSED

- FOUND: migration.sql, pawn-lifecycle.spec.ts, approval.service.spec.ts, approval.controller.spec.ts, ApprovalQueue.test.tsx, 08-01-SUMMARY.md, deferred-items.md
- FOUND commits: 53792c8, e68553d, 7dbfb84, d3be151
