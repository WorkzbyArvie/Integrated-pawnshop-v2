# Phase 8: Approval Workflows & Unified Approval Queue - Research

**Researched:** 2026-08-01
**Domain:** RBAC-gated approval workflows (appraisal + redemption) with a unified queue and persisted audit trail
**Confidence:** HIGH

## Summary

Phase 8 activates the dead `ApprovalRecord` model (schema.prisma:1860) to gate two sensitive operations behind OWNER/ADMIN sign-off: (1) appraisal submission — the ticket holds in `PENDING_APPROVAL` instead of advancing to `APPRAISED`, and (2) redemptions above a per-tenant threshold (`redemptionApprovalThreshold`, default ₱50,000). All decisions persist to `ApprovalRecord` with approver identity, comment, and timestamp (RBAC-06), surfaced through one unified queue UI (`/approval-queue`) backed by a new `GET /approval-queue` endpoint (RBAC-05).

**Primary recommendation:** Build a new `backend/src/approval/` module (controller + service + module) with a **one-way dependency** on `LoanModule` (which already exports `PawnTicketService`). `appraiseTicket` and `redeemTicket` create `ApprovalRecord` rows directly via Prisma at their natural chokepoints; the approval service only lists and decides. This avoids the LoanModule ↔ ApprovalModule circular-dependency trap entirely (no `forwardRef` needed).

Three verified codebase gaps must be closed before implementation starts:
1. **Schema:** `ApprovalRecord` has **no `payload` column** — D-02 requires storing appraisal data (appraisedValue, riskScore, recommendedLoanAmount, itemCondition, appraisalNotes) in the record. Add `payload Json?` via a new additive migration.
2. **State machine:** `PENDING_APPROVAL -> RECEIVED` does **not** exist in `pawn-lifecycle.ts` — D-04's reject-to-reappraise path throws `BadRequestException` without it.
3. **Role matrix:** `ADMIN` is absent from `allowedRoles` on the approval transitions (`PENDING_APPROVAL->OFFER_MADE`, `ACTIVE/GRACE_PERIOD->REDEEMED`). D-01 names ADMIN as an approver; passing `userRole: 'ADMIN'` to `stateMachine.transition` today throws `ForbiddenException`. ADMIN must be added to the relevant transitions.

**Test-infrastructure warning:** `permissions-catalog.spec.ts` hard-asserts exactly 37 permissions, 101 role→permission mappings, and 63 guarded sites across 6 controllers. Any new guarded endpoint in a new `approval.controller.ts` **will fail** these tests unless the MATRIX is extended and the counts updated in the same change.

## Project Constraints (from AGENTS.md)

- **Monorepo:** `frontend/`, `backend/`, `auction-frontend/`, `mobile/`; Phase 8 touches `backend/` + `frontend/` only.
- **Backend-first** — database/logic before UI.
- **NestJS module convention:** controller, service, module, `dto/` folder.
- **Prisma:** snake_case for DB columns, camelCase for JS fields.
- **No comments in source** unless explicitly asked.
- **Prefer edit over write** for existing files.
- **Stack:** NestJS 10 + Prisma ORM 5.22 + PostgreSQL (Supabase) with RLS; React 19 + Vite 6 + TailwindCSS 4 + shadcn/Radix UI.
- **Thesis B mandate:** traceability (who-did-what-when), immutable proof for every transaction, realistic process flow, security (RLS, RBAC, input validation, rate limiting).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Appraisal Hold State
- **D-01:** When an appraiser submits a valuation, the ticket transitions `RECEIVED -> PENDING_APPROVAL` instead of the current `RECEIVED -> APPRAISED` in `appraiseTicket` (pawn-ticket.service.ts:377). `PENDING_APPROVAL` lifecycle status and the `RECEIVED -> PENDING_APPROVAL` / `PENDING_APPROVAL -> OFFER_MADE|CANCELLED` transitions already exist in the state machine (pawn-lifecycle.ts:8-10) - reuse them, do not add new states.
- **D-02:** Appraisal data (appraisedValue, riskScore, recommendedLoanAmount, itemCondition, appraisalNotes) is captured in the approval task (ApprovalRecord payload). The ticket's `loanAmount` field is only applied when the approval is granted - it must NOT be written to the ticket at appraisal-submission time (change current behavior at pawn-ticket.service.ts:388).
- **D-03:** Approval granted -> ticket advances `PENDING_APPROVAL -> OFFER_MADE`. The existing contract-generation / offer logic from `POST /pawn-tickets/:id/approve` remains the step that produces the offer - approval advances the ticket state so that existing offer action can run.
- **D-04:** Approval rejected -> ticket returns to `RECEIVED` (add a `PENDING_APPROVAL -> RECEIVED` return path to the state machine) with the rejection comment so the appraiser can edit and re-submit.

#### Redemption Threshold Config
- **D-05:** High-value threshold is stored per-tenant in `Pawnshop.settings` JSON under a namespaced key (e.g. `redemptionApprovalThreshold`), following the existing finance (`LEDGER_REQUESTS_SETTINGS_KEY`) and payroll (`PAYROLL_SETTINGS_KEY`) settings pattern (finance.service.ts:171, payroll.service.ts:68).
- **D-06:** Default threshold is 50,000 (PHP). Redemptions where `amountPaid` (redeem-ticket.dto.ts:5) exceeds the threshold require OWNER approval; at or below threshold proceeds directly (fast walk-in flow preserved).
- **D-07:** Threshold is editable via the existing `PATCH /pawnshops/:id/settings` endpoint (tenant-governance.controller.ts:385). No new settings surface is needed.

#### Unified Queue UX
- **D-08:** Build a new unified approval queue page (frontend route, e.g. `/approval-queue`) backed by a new `GET /approval-queue` endpoint that returns pending `ApprovalRecord` items across both target types (APPRAISAL, REDEMPTION).
- **D-09:** The page shows tabs/filters for Appraisal | Redemption, per-row approve/reject with a required comment on rejection, and a past-decision audit view showing approver identity, decision, comment, and timestamps.
- **D-10:** Consolidate/retire the existing `PendingApprovalPanel.tsx` and `AppraisalApproval.tsx` components in favor of the unified queue. Approval actions are gated by the `approval.view_queue` / `approval.approve_appraisal` / `approval.approve_redemption` permissions already seeded in Phase 7. The existing `/pawn-tickets/pending-approval` (ticket-creation approval) flow is a separate concern and remains available.

#### Approval Side Effects & Resubmission
- **D-11:** Appraisal reject -> ticket back to `RECEIVED`, appraiser re-appraises and re-submits (new approval task). Previous rejection comment must be visible to the appraiser for context.
- **D-12:** Redemption approve -> the existing `redeemTicket` release logic runs (payment, ledger entry, LegalProof, receipt, tier update, notification). Redemption reject -> ticket stays `ACTIVE`/`GRACE_PERIOD`, staff/cashier notified; can be re-requested.
- **D-13:** Every decision (approve AND reject) writes a persisted `ApprovalRecord` row with `decidedBy`, `decidedAt`, `decisionComment`, and `status`, satisfying the auditable trail requirement.

### the agent's Discretion
- Approval record field wiring (targetType/targetId mapping to tickets, amount population) — follow the ApprovalRecord schema (schema.prisma:1860).
- Whether the unified queue audit view shows full history vs recent-only — keep it full-history; it is cheap and supports thesis traceability.
- Self-approval prevention detail (e.g. requester cannot approve own request) — implement if straightforward.

### Deferred Ideas (OUT OF SCOPE)
- KYC verification gate on ticket creation/approval/disbursement — Phase 9 (depends on this phase's final approval flow shape).
- Contract management upgrade (signature image upload, item-specific redemption terms) — Phase 11.

None else — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RBAC-03 | Creating an appraisal (`CREATE_APPRAISAL`) generates an approval task; ticket does not advance to APPRAISED/OFFER until OWNER/ADMIN approves | `appraiseTicket` chokepoint (pawn-ticket.service.ts:364); `ApprovalRecord` model; `RECEIVED->PENDING_APPROVAL` transition exists (pawn-lifecycle.ts:8); missing `payload` column identified |
| RBAC-04 | Redemptions above configured threshold (`APPROVE_REDEMPTION`) require OWNER approval before release; below-threshold remain direct | `redeemTicket` chokepoint (:441); `Pawnshop.settings` JSON pattern (finance.service.ts:158-184); threshold key `redemptionApprovalThreshold` |
| RBAC-05 | Approval tasks surface in one unified approval queue UI (mount/consolidate `PendingApprovalPanel` / `AppraisalApproval`) with approver audit trail | New `GET /approval-queue` + `ApprovalModule`; frontend route `/approval-queue` in App.tsx TAB_TO_PATH/nav/render; existing permissions `approval.view_queue` etc. (permissions.const.ts:28-30) |
| RBAC-06 | Approval decisions persisted to a dedicated approval-record model (activate the dead `ApprovalRecord` table) | `ApprovalRecord` model (schema.prisma:1860) + migration `20260731120000_v2_schema_baseline` creates `approval_records`; D-13 decision fields verified (decidedById/decidedAt/decisionComment/status) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Approval record persistence | Database (Prisma `ApprovalRecord`) | — | Model + migration already exist; queue rows are plain rows |
| Appraisal submission → approval task | API / Backend | Database | `appraiseTicket` is the single chokepoint; creates record + transitions ticket |
| Threshold evaluation | API / Backend | Database (`Pawnshop.settings`) | Read settings JSON at `redeemTicket` top; branch to approval vs direct |
| Decision side effects (contract/offer, redemption release) | API / Backend | — | Reuse existing `approveWithContract` / `redeemTicket` services; never duplicate in frontend |
| Unified queue UI | Browser / Client | API | New frontend page; data from `GET /approval-queue`; permission-gated buttons |
| Audit trail | Database + API | — | `ApprovalRecord` rows + existing `@AuditLog` interceptor + LegalProof |
| Queue visibility gating | API (RbacGuard) | Browser (nav roles) | `approval.view_queue` / `approval.approve_appraisal` / `approval.approve_redemption` |

## Standard Stack

### Core

No new runtime packages are required. Phase 8 reuses the existing stack end-to-end.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| NestJS (existing) | ^10.0.0 | New `ApprovalModule` (controller/service/module/dto) | Project framework (AGENTS.md) |
| @prisma/client | ^5.22.0 (installed 5.22.0) | `ApprovalRecord` CRUD + payload Json column | Project ORM; model already present |
| class-validator / class-transformer | ^0.14.1 / ^0.5.1 | Decide DTO validation (required comment on reject) | Existing DTO convention |
| lucide-react | ^0.471.0 | Queue icons | Existing frontend icon set |
| sweetalert2 | ^11.26.24 | Approve/reject confirm modals | Existing pattern in AppraisalApproval/Redemption |
| Radix UI Tabs/Table/Dialog (vendored) | via `frontend/src/components/ui/` | Appraisal | Redemption tab filters, row table, comment dialog | shadcn components vendored; no `components.json` needed |

**Installation:** none. Verify with `npm ls @prisma/client --prefix backend`.

**Version verification:** local `prisma` = 5.22.0, `@prisma/client` = 5.22.0 (confirmed from `backend/node_modules`). NOTE: bare `npx prisma --version` resolved 7.9.1 (latest) — always run Prisma via `backend/package.json` scripts (`npm run prisma:generate`, `npm run prisma:push`) or `npx --no-install prisma` inside `backend/` to stay on 5.22.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| NotificationService (existing) | — | Notify approvers (new task), requester (decision), cashier (redemption reject) | D-11/D-12 notification requirements |
| apiClient.ts (existing) | — | `api.get('/approval-queue')`, `api.post('/approval-queue/:id/approve|reject')` | All frontend calls; auto-attaches auth + pawnshop-id headers |
| formatters.ts (existing) | — | `formatCurrency` (PHP en-PH) for amount display | Queue rows + threshold display |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `ApprovalModule` | Add endpoints to `PawnTicketController` | Mixing queue concerns into ticket controller bloats it; separate module keeps RBAC-catalog mapping clean |
| Direct Prisma record creation in `appraiseTicket`/`redeemTicket` | Inject `ApprovalService` into `PawnTicketService` | Creates LoanModule ↔ ApprovalModule circular dependency — avoid (see NestJS research below) |
| `forwardRef` for circular dependency | One-way dependency | Not needed if chokepoints write records directly; cleaner |

## Package Legitimacy Audit

> No new external packages are installed by this phase. Everything used (NestJS, Prisma, class-validator, lucide-react, sweetalert2, Radix UI, apiClient) is already pinned in `backend/package.json` / `frontend/package.json` and verified present in `node_modules`. The legitimacy gate is therefore **not triggered** for new installs.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none — no new packages required) | — | — | — | — | — | N/A |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
*No package installs are planned; do not add any new dependency without re-running the legitimacy gate.*

## Architecture Patterns

### System Architecture Diagram

```
Appraisal submission                 Redemption (in-person / online)
┌─────────────────────┐              ┌──────────────────────────────┐
│ appraiser → POST     │              │ cashier → POST               │
│ /pawn-tickets/:id/   │              │ /pawn-tickets/:id/redeem     │
│ appraise (RBAC:      │              │ (RBAC: pawn_ticket.redeem)   │
│  pawn_ticket.appraise)│             └──────────────┬───────────────┘
└──────────┬──────────┘                             │
           │ appraiseTicket (chokepoint)            │ redeemTicket (chokepoint)
           │                                        │
           ▼                                        ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│ 1. stateMachine: RECEIVED →  │   │ 1. read settings                 │
│    PENDING_APPROVAL (D-01)   │   │    redemptionApprovalThreshold   │
│ 2. create ApprovalRecord     │   │    (default 50000) (D-05/D-06)   │
│    {APPRAISAL, payload:      │   │ 2. amountPaid > threshold?       │
│    appraisedValue, riskScore,│   │    ├─ yes → create ApprovalRecord│
│    recommendedLoanAmount,...}│   │    │        {REDEMPTION, amount} │
│ 3. NO loanAmount write (D-02)│   │    │        → queue (no release) │
└──────────────┬───────────────┘   │    └─ no  → existing direct      │
               │                   │           release logic (fast    │
               ▼                   │           walk-in preserved)      │
┌──────────────────────────────┐   └──────────────────┬───────────────┘
│        ApprovalRecord        │                      │
│   status: PENDING (D-13)     │◄─────────────────────┘
└──────────────┬───────────────┘
               │ GET /approval-queue (RBAC: approval.view_queue)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Unified Approval Queue UI  (/approval-queue)                 │
│  Tabs: Appraisal | Redemption | Audit                        │
│  per row: Approve / Reject (comment required on reject)      │
└──────┬──────────────────────────┬─────────────────────────────┘
       │ approve (RBAC:           │ reject (RBAC:
       │  approval.approve_       │  approval.approve_...)
       │  appraisal|redemption)   │
       ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│ Appraisal:               │  │ Appraisal:                   │
│  apply loanAmount from   │  │  stateMachine: PENDING_      │
│  payload (D-02)          │  │  APPROVAL → RECEIVED (D-04)  │
│  stateMachine → OFFER_   │  │ Redemption:                  │
│  MADE (D-03)             │  │  ticket stays ACTIVE/GRACE   │
│  [existing approveWith-  │  │  notify cashier (D-12)       │
│  Contract runs offer]    │  └──────────────┬───────────────┘
│ Redemption:              │                 │
│  existing redeemTicket   │                 │
│  release logic (D-12)    │                 │
└───────────┬──────────────┘                 │
            │                                │
            ▼                                ▼
  Update ApprovalRecord: status=APPROVED/REJECTED,
  decidedById, decidedAt, decisionComment (D-13)
  + AuditLog + LegalProof where applicable
```

### Recommended Project Structure

```
backend/src/approval/                     # NEW module (Phase 8)
├── approval.module.ts                    # imports LoanModule, NotificationModule, PrismaModule
├── approval.controller.ts                # GET /approval-queue; POST /approval-queue/:id/approve|reject
├── approval.service.ts                   # list pending, decide, apply side effects
└── dto/
    ├── decide-approval.dto.ts            # decisionComment (required on reject), (optional) reason
    └── approval-queue-query.dto.ts       # type filter, status filter, pawnshopId/branchId
backend/src/common/state-machine/pawn-lifecycle.ts   # EDIT: add PENDING_APPROVAL→RECEIVED; add ADMIN to approval transitions
backend/src/loan/pawn-ticket.service.ts               # EDIT: appraiseTicket (D-01/D-02), redeemTicket threshold gate (D-05/D-06)
backend/prisma/schema.prisma                          # EDIT: ApprovalRecord += payload Json?
backend/prisma/migrations/YYYYMMDD_add_approval_payload/  # NEW additive migration
frontend/src/components/ApprovalQueue.tsx             # NEW unified queue page (replaces AppraisalApproval render)
frontend/src/App.tsx                                  # EDIT: TAB_TO_PATH + nav item + render (D-08/D-10)
```

### Pattern 1: Chokepoint Record Creation (no circular dependency)

**What:** `appraiseTicket` and `redeemTicket` create `ApprovalRecord` rows directly via `this.prisma` at their existing chokepoints. `ApprovalModule` only lists and decides, importing `LoanModule` one-way.

**When to use:** When the domain service (PawnTicketService) must not depend on the new module, and the new module must call back into the domain service for decision side effects.

```typescript
// inside appraiseTicket (after stateMachine.transition to PENDING_APPROVAL)
const approval = await this.prisma.approvalRecord.create({
  data: {
    pawnshopId: this.assertPawnshopId(ticket),
    targetType: 'APPRAISAL',
    targetId: String(ticket.id),
    amount: dto.appraisedValue,
    requestedById: appraisedBy,
    status: 'PENDING',
    payload: {
      appraisedValue: dto.appraisedValue,
      riskScore: dto.riskScore ?? 0,
      recommendedLoanAmount: dto.recommendedLoanAmount,
      itemCondition: dto.itemCondition,
      appraisalNotes: dto.appraisalNotes,
    } as Prisma.InputJsonValue,
  },
});
// NOTE: do NOT set ticket.loanAmount here (D-02)
```

### Pattern 2: Namespaced Tenant Settings (threshold)

**What:** Per-tenant threshold lives in `Pawnshop.settings` JSON under a namespaced key, read/written via the existing settings helpers.

**When to use:** Follows finance/payroll precedent (`LEDGER_REQUESTS_SETTINGS_KEY`, `PAYROLL_SETTINGS_KEY`).

```typescript
// in redeemTicket, before release logic:
const REDEMPTION_APPROVAL_THRESHOLD_KEY = 'redemptionApprovalThreshold';
const settings = (ticket.pawnshop?.settings as Record<string, unknown>) ?? {};
const threshold = Number(settings[REDEMPTION_APPROVAL_THRESHOLD_KEY] ?? 50_000);
if (dto.amountPaid > threshold) {
  // create ApprovalRecord { targetType: 'REDEMPTION', targetId: String(ticket.id), amount: dto.amountPaid, requestedById: processedBy }
  // return early: { requiresApproval: true, approvalId }
}
// ... existing direct release path unchanged
```

**Caution:** `redeemTicket` currently loads `include: { customer: true, loans: true }` (pawn-ticket.service.ts:442-445) — the threshold read needs `pawnshop.settings`, so extend the include (or read settings via a helper) in the same change.

### Pattern 3: Decide + Side Effects (transactional)

**What:** The approval service resolves a record and applies the domain side effect. Use a Prisma interactive transaction only if record-update + ticket-update must be atomic together (side effects like contract generation run inside `approveWithContract` already).

**When to use:** For appraisal approve (apply payload → transition → call existing offer action) and redemption approve (call existing `redeemTicket` release).

```typescript
async decideApproval(id: string, dto: DecideApprovalDto, decidedBy: string, userRole?: string) {
  const record = await this.prisma.approvalRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundException('Approval record not found');
  if (record.status !== 'PENDING') throw new BadRequestException('Record already decided');
  if (record.requestedById === decidedBy) throw new ForbiddenException('Cannot approve your own request'); // self-approval prevention (discretion)

  if (dto.approve) {
    if (record.targetType === 'APPRAISAL') {
      // apply recommendedLoanAmount from payload, transition via existing offer flow (D-03)
      await this.pawnTicketService.applyApprovedAppraisal(Number(record.targetId), record.payload, decidedBy, userRole);
    } else {
      await this.pawnTicketService.releaseApprovedRedemption(Number(record.targetId), { amountPaid: record.amount ?? 0 }, decidedBy, userRole); // D-12
    }
  }
  // else reject: appraisal → PENDING_APPROVAL → RECEIVED (D-04); redemption → no ticket change (D-12)

  return this.prisma.approvalRecord.update({
    where: { id },
    data: {
      status: dto.approve ? 'APPROVED' : 'REJECTED',
      decidedById: decidedBy,
      decidedAt: new Date(),
      decisionComment: dto.decisionComment,
    },
  }); // D-13 — always persisted
}
```

### Anti-Patterns to Avoid

- **Circular module dependency:** If `PawnTicketService` injects `ApprovalService` and `ApprovalService` injects `PawnTicketService`, NestJS fails to instantiate. Chokepoint record creation avoids this entirely.
- **Duplicating release/offer logic:** Never re-implement contract generation or redemption release in the approval service — call the existing `approveWithContract` / `redeemTicket` (D-03, D-12).
- **Hardcoding threshold:** Do not inline `50000` in services/UI — read from `Pawnshop.settings` with default fallback (D-06).
- **Mutating `loanAmount` at appraisal-submit:** Current code at pawn-ticket.service.ts:388 writes it — D-02 explicitly forbids; move to approval-granted path.
- **Overwriting entire settings object:** `PATCH /pawnshops/:id/settings` replaces the whole JSON (raw SQL `SET settings = ...`, tenant-governance.service.ts:2554). Write merges with existing settings, not wholesale replacement, to avoid clobbering finance/payroll keys.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Approval persistence | Custom queue table / in-memory store | Prisma `ApprovalRecord` model (already migrated) | Table + enums + FKs + indexes exist from Phase 7 baseline |
| Decision audit trail | Manual log arrays | `ApprovalRecord` row per decision + existing `@AuditLog` interceptor + LegalProof | Immutable who/when/what trail (thesis traceability) |
| RBAC gating | Inline role checks | `@RequiresPermission` + `RbacGuard` (Phase 7) | Permission catalog already seeded; guard is staffType-aware |
| Status transitions | `if/else` on lifecycleStatus | `StateMachineService.transition` (domain definitions in pawn-lifecycle.ts) | Single source of truth; throws on invalid transitions |
| Tenant config surface | New settings table/endpoint | `Pawnshop.settings` JSON + existing `PATCH /pawnshops/:id/settings` | D-07: no new settings surface |
| Contract/offer generation | Re-write offer flow | Existing `approveWithContract` (POST /pawn-tickets/:id/approve) | Already generates LoanApplication + Loan + Contract + LegalProof + notification |
| Redemption release | Re-write release | Existing `redeemTicket` body | Payment, ledger, LegalProof, receipt, tier, notification in one place |
| Notifications | Direct DB notification writes | `NotificationService.sendNotification` | Existing channels/types/recipients wiring |
| Queue UI primitives | Custom tab/table/dialog CSS | Vendored `components/ui/` (Radix Tabs/Table/Dialog) + sweetalert2 | Consistent Gilded Reserve theme |

**Key insight:** Phase 8 is mostly **orchestration over existing machinery** — the ApprovalRecord model, permission catalog, state machine, settings pattern, and release/offer services all exist. The plan's risk is wiring, not invention: chokepoints, one-way module deps, and the three schema/state/role gaps dominate.

## Common Pitfalls

### Pitfall 1: permissions-catalog.spec.ts hard counts break
**What goes wrong:** Adding `@RequiresPermission` sites to a new `approval.controller.ts` fails `permissions-catalog.spec.ts` ("63-site equivalence scan", "exactly 37 permissions", "101 mappings").
**Why it happens:** The spec (backend/src/common/permissions/permissions-catalog.spec.ts) scans all controller files and asserts exact totals plus a MATRIX entry per guarded site.
**How to avoid:** Extend `MATRIX` with the new controller's sites (`'approval.controller.ts::getQueue'`, `::approve`, `::reject`) and update the total count; keep permission names inside the existing 37 (no new permissions — `approval.*` already seeded).
**Warning signs:** `npm test` fails with "finds all 63 migrated endpoints" after adding the controller.

### Pitfall 2: ADMIN blocked by state machine allowedRoles
**What goes wrong:** D-01 names OWNER/ADMIN as approvers, but `pawn-lifecycle.ts` allows only `['MANAGER','OWNER']` on `PENDING_APPROVAL->OFFER_MADE` (line 9) and `ACTIVE/GRACE_PERIOD->REDEEMED` (lines 15,18). An ADMIN approver → `ForbiddenException` from `stateMachine.transition`.
**Why it happens:** Phase 7 catalog gave ADMIN the `approval.*` permissions, but the older state machine role lists were never updated.
**How to avoid:** Add `'ADMIN'` to `allowedRoles` on the approval-relevant transitions (`PENDING_APPROVAL->OFFER_MADE`, new `PENDING_APPROVAL->RECEIVED`, `ACTIVE->REDEEMED`, `GRACE_PERIOD->REDEEMED`). Update `state-machine` specs accordingly.
**Warning signs:** ADMIN sees the queue, clicks Approve, gets 403.

### Pitfall 3: Missing PENDING_APPROVAL -> RECEIVED transition (D-04)
**What goes wrong:** Reject path calls `stateMachine.transition(..., 'RECEIVED')` → `BadRequestException("Invalid transition")`.
**Why it happens:** The transition does not exist in `pawn-lifecycle.ts` today.
**How to avoid:** Add `{ from: 'PENDING_APPROVAL', to: 'RECEIVED', allowedRoles: ['MANAGER','OWNER','ADMIN'] }`.
**Warning signs:** Reject endpoint returns 400 on valid reject.

### Pitfall 4: ApprovalRecord has no payload column (D-02)
**What goes wrong:** `prisma.approvalRecord.create({ data: { payload } })` throws a Prisma unknown-field error / DB column missing.
**Why it happens:** The Phase 7 baseline created `approval_records` with only the columns listed in schema.prisma:1860-1882 — no Json payload.
**How to avoid:** Add `payload Json? @map("payload")` to the model + a new additive migration (idempotent style matching `20260731120000_v2_schema_baseline`), then `npm run prisma:generate`.
**Warning signs:** TypeScript error on `.payload`; runtime P2010 "column does not exist".

### Pitfall 5: Threshold settings read without pawnshop include
**What goes wrong:** `redeemTicket` loads `{ customer, loans }` but not `pawnshop.settings` — threshold read returns undefined → every redemption falls back to default or errors.
**Why it happens:** The include set predates the threshold requirement.
**How to avoid:** Extend the include with `pawnshop: { select: { settings: true } }` in the same edit that adds the gate.
**Warning signs:** Threshold never honored for tenants that configured it.

### Pitfall 6: Settings endpoint permission mismatch (D-07)
**What goes wrong:** The controller for `PATCH /pawnshops/:id/settings` is decorated `@RequiresPermission(PERMISSIONS['platform.manage'])` (tenant-governance.controller.ts:377-378) — **SUPER_ADMIN only** — while the service method asserts SUPER_ADMIN/OWNER/ADMIN (service:2542). Owner/Admin editing via this endpoint today is blocked at the guard.
**Why it happens:** Controller permission is stricter than the service check.
**How to avoid:** Verify intended ownership in discuss/plan: either keep SUPER_ADMIN-only editing (thesis demo path) or broaden the controller permission to `tenant.manage` (OWNER/ADMIN) — a deliberate decision, not an accident.
**Warning signs:** Owner attempts threshold edit → 403.

### Pitfall 7: Overwriting Pawnshop.settings wholesale
**What goes wrong:** `PATCH /pawnshops/:id/settings` replaces the full JSON; a client that sends only `{ redemptionApprovalThreshold }` wipes finance/payroll keys.
**Why it happens:** Raw SQL `SET settings = <payload>` (tenant-governance.service.ts:2554).
**How to avoid:** Frontend sends merged settings; or read-modify-write in the calling code.
**Warning signs:** Ledger approval requests disappear after a settings save.

### Pitfall 8: Frontend keeps calling dead endpoints
**What goes wrong:** After D-10, the queue UI calls `/approval-queue` but `AppraisalApproval.tsx`/`PendingApprovalPanel.tsx` (old endpoints `/pawn-tickets/pending-approval`, `/pawn-tickets/:id/approve` for the ticket-creation flow) are confused with the new queue.
**Why it happens:** Two distinct approval flows coexist (ticket-creation approval vs. Phase 8 appraisal/redemption approval).
**How to avoid:** Retire the two components' nav/render in App.tsx (lines ~57 import, ~1205 nav, ~1619 render) and keep the ticket-creation flow endpoint untouched (D-10 explicitly keeps `/pawn-tickets/pending-approval`).
**Warning signs:** Duplicate approval UIs; actions hitting wrong endpoint.

### Pitfall 9: Non-transactional decide side effects
**What goes wrong:** Record marked APPROVED but ticket update fails (or vice-versa) → inconsistent state, no audit trail.
**Why it happens:** Multiple Prisma writes without atomicity.
**How to avoid:** Wrap record update + ticket status/loanAmount application in `this.prisma.$transaction` (interactive transaction — rolls back on throw [CITED: docs.prisma.io]). Note: contract/loan creation inside `approveWithContract` is already sequential; decide whether it joins the transaction or is best-effort with the record persisted first (record is the audit source of truth, so persist decision last).
**Warning signs:** Audit shows APPROVED but ticket stuck in PENDING_APPROVAL.

## Code Examples

Verified patterns from official sources + the codebase:

### Prisma interactive transaction (rollback on throw)
```typescript
// Source: https://www.prisma.io/docs/orm/prisma-client/queries/transactions [CITED]
const result = await this.prisma.$transaction(async (tx) => {
  const record = await tx.approvalRecord.update({ /* APPROVED */ });
  const ticket = await tx.ticket.update({ /* apply payload, OFFER_MADE */ });
  return { record, ticket };
}, { maxWait: 2000, timeout: 5000 }); // options optional; defaults shown
// If any statement throws, the whole transaction rolls back.
```

### NestJS circular dependency (only if needed — prefer avoiding)
```typescript
// Source: https://docs.nestjs.com/fundamentals/circular-dependency [CITED]
// In both modules:
@Module({ imports: [forwardRef(() => OtherModule) /* ... */] })
// In the service constructor:
constructor(
  @Inject(forwardRef(() => OtherService))
  private readonly otherService: OtherService,
) {}
```
**Recommendation:** Phase 8 should NOT need this — chokepoint record creation keeps the dependency one-way (`ApprovalModule` imports `LoanModule`; `LoanModule` never imports `ApprovalModule`).

### Existing settings read pattern (finance.service.ts:158-184) [VERIFIED: codebase]
```typescript
private async getPawnshopSettings(pawnshopId: string): Promise<{ settings: Record<string, unknown> }> {
  const pawnshop = await this.prisma.pawnshop.findUnique({
    where: { id: pawnshopId },
    select: { settings: true },
  });
  return { settings: (pawnshop?.settings as Record<string, unknown> | null) ?? {} };
}
```
Phase 8 mirrors this for `redemptionApprovalThreshold` (default 50_000).

### Existing permission-gated controller pattern (pawn-ticket.controller.ts:123-139) [VERIFIED: codebase]
```typescript
@AuditLog('APPRAISE_TICKET')
@Post('pawn-tickets/:id/appraise')
@HttpCode(HttpStatus.OK)
@RequiresPermission(PERMISSIONS['pawn_ticket.appraise'])
appraiseTicket(@Param('id') id: string, @Body() dto: AppraiseTicketDto, @Req() req: Request) {
  const user = (req as any).user as { id: string; role: string } | undefined;
  return this.pawnTicketService.appraiseTicket(parseInt(id, 10), dto, user?.id ?? '', user?.role);
}
```
New queue endpoints copy this shape with `PERMISSIONS['approval.view_queue']` / `['approval.approve_appraisal']` / `['approval.approve_redemption']`.

### Frontend apiClient usage pattern (AppraisalApproval.tsx:127, 250) [VERIFIED: codebase]
```typescript
const tickets = await api.get<PendingApiTicket[]>('/pawn-tickets/pending-approval', query);
// ...
await api.post(`/pawn-tickets/${appraisalId}/decline`, { reason: rejectionReason.trim() });
```
Queue page: `api.get<ApprovalQueueItem[]>('/approval-queue', { pawnshopId, type })`, `api.post(`/approval-queue/${id}/approve`, { decisionComment })`, `api.post(`/approval-queue/${id}/reject`, { decisionComment })`.

### Prisma JSON field write [CITED: docs.prisma.io]
```typescript
payload: { appraisedValue, riskScore, recommendedLoanAmount, itemCondition, appraisalNotes } as Prisma.InputJsonValue
// Read back as plain object; use Prisma.JsonNull/DbNull for null distinctions if needed.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Appraisal RECEIVED→APPRAISED immediately (pawn-ticket.service.ts:377,388) | RECEIVED→PENDING_APPROVAL; data held in ApprovalRecord payload; loanAmount applied on approval | Phase 8 (this change) | Ticket doesn't advance until OWNER/ADMIN sign-off (RBAC-03) |
| Redemption always direct release | Threshold-gated: `amountPaid > threshold` → approval task | Phase 8 | High-value items require OWNER sign-off (RBAC-04) |
| Dead `ApprovalRecord` table (Phase 7 baseline) | Active queue + audit trail | Phase 8 | RBAC-06 traceability requirement satisfied |
| AppraisalApproval.tsx / PendingApprovalPanel.tsx | Unified `/approval-queue` page | Phase 8 | One queue for all approvals (RBAC-05) |
| Hardcoded role strings on endpoints | @RequiresPermission + RbacGuard (Phase 7) | Phase 7 (already done) | New endpoints inherit the mechanism |

**Deprecated/outdated:**
- `AppraisalApproval.tsx` and `PendingApprovalPanel.tsx` as rendered nav entries — retired/consolidated by D-10 (ticket-creation flow endpoint stays).
- Direct `loanAmount` write at appraisal submission (pawn-ticket.service.ts:388) — removed by D-02.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Exceeds threshold" = `amountPaid > threshold` (strictly greater), matching D-06 wording "exceeds ... at or below proceeds directly" | Redemption Threshold | Boundary off-by-one on exactly ₱50,000 redemptions |
| A2 | Appraisal approve applies `recommendedLoanAmount` from payload, then the **existing** `POST /pawn-tickets/:id/approve` offer flow (approveWithContract) runs to produce the offer (D-03) | Side Effects | If D-03 instead means the queue itself must generate the contract, an extra step is needed |
| A3 | The queue returns only `status = PENDING` records by default; audit view queries decided records (full history per discretion) | Queue API | UI filter semantics need confirmation |
| A4 | Self-approval prevention (requester ≠ decider) implemented as a straightforward guard in the decide service | Pattern 3 | Trivial to add; only affects edge cases |
| A5 | Notification for "new approval task" / "decision made" reuses existing NotificationType enum values (no new enum migration) | Notifications | If a dedicated APPROVAL type is required, an enum migration is needed (NotificationType has no approval value today — verified schema.prisma:1040) |
| A6 | `payload` column added as `Json?` on ApprovalRecord via new additive migration; no backfill needed (table is currently unused) | Schema | If any rows exist, migration is still safe (nullable) |
| A7 | Settings edit path stays as-is (SUPER_ADMIN-gated at controller level) unless discussed otherwise | Pitfall 6 | D-07 assumes Owner can edit threshold; controller currently blocks non-SUPER_ADMIN |

## Open Questions

1. **Settings endpoint ownership (D-07)**
   - What we know: `PATCH /pawnshops/:id/settings` exists but is `@RequiresPermission(platform.manage)` = SUPER_ADMIN-only at the controller; the service asserts SUPER_ADMIN/OWNER/ADMIN.
   - What's unclear: Should the threshold be editable by OWNER/ADMIN (broaden controller permission to `tenant.manage`) or remain SUPER_ADMIN-managed?
   - Recommendation: Ask the user during plan-phase confirmation; default to broadening to `tenant.manage` so the pawnshop owner can self-configure (fits D-07 intent).

2. **Appraisal approve → offer handoff (D-03)**
   - What we know: `approveWithContract` accepts tickets in `APPRAISED` or `PENDING_APPROVAL` and generates the full offer (loan app + loan + contract + proof + notification). Queue approve must first apply payload data and transition to OFFER_MADE.
   - What's unclear: Whether the queue approve should (a) itself invoke `approveWithContract` after applying payload (one-click), or (b) only transition to OFFER_MADE and require the separate existing offer action.
   - Recommendation: (a) one-click approve → apply payload → call existing offer flow — matches D-03 "approval advances the ticket state so that existing offer action can run" with the least UI friction.

3. **Redemption online (PayMongo) path**
   - What we know: This phase's threshold gate lands in `redeemTicket`; online redemption flows through webhook/payment services.
   - What's unclear: Whether the online redemption path also needs the threshold gate (per REQUIREMENTS.md RBAC-04 wording "before release").
   - Recommendation: Gate at the shared release chokepoint if one exists; otherwise gate `redeemTicket` (in-person) now and note online path for verification.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend + frontend build/test | ✓ | v26.4.0 | — |
| npm | Install/scripts | ✓ | 11.17.0 | — |
| Prisma CLI (local) | `npm run prisma:generate` / `prisma:push` in backend/ | ✓ | 5.22.0 (local) | `npx --no-install prisma` inside backend/ |
| git | Commit research/plan | ✓ | 2.55.0.windows.2 | — |
| @prisma/client | ApprovalRecord CRUD | ✓ | 5.22.0 (installed) | — |
| PostgreSQL (Supabase) | Schema migration target | ✓ (assumed — project is live) | — | `prisma db push` vs migration; verify DATABASE_URL before migrate |
| Vitest | Frontend tests | ✓ | ^3.2.4 (package.json) | — |
| Jest | Backend tests | ✓ | ^29.5.0 (package.json) | — |

**Missing dependencies with no fallback:** none — all tools verified present.
**Missing dependencies with fallback:** live DB connection not probed in this research (no credentials used); verify `DATABASE_URL` in `backend/.env` before running migrations.

## Validation Architecture

> `.planning/config.json` has no `workflow.nyquist_validation` key → treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Backend: Jest ^29.5.0 (ts-jest); Frontend: Vitest ^3.2.4 |
| Config file | Backend: jest block in `backend/package.json` (rootDir src, testRegex `*.spec.ts`); Frontend: `frontend/package.json` script `test: vitest` |
| Quick run command | Backend: `npm test` (in backend/); Frontend: `npm test` (in frontend/) |
| Full suite command | Backend: `npm test`; Frontend: `npm test`; then `npm run build` both |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RBAC-03 | appraiseTicket creates ApprovalRecord(APPRAISAL, PENDING, payload) and ticket stays PENDING_APPROVAL; loanAmount NOT written | unit | `npm test -- approval.service` / `-- pawn-ticket.service` (backend) | ❌ Wave 0 |
| RBAC-04 | redeemTicket with amountPaid > threshold creates REDEMPTION record and returns early; ≤ threshold runs direct release | unit | `npm test -- approval` (backend) | ❌ Wave 0 |
| RBAC-05 | GET /approval-queue returns pending records across both types; frontend queue page renders tabs and calls endpoint | integration + unit | backend `npm test`; frontend `npm test -- ApprovalQueue` | ❌ Wave 0 |
| RBAC-06 | decide writes decidedById/decidedAt/decisionComment/status for approve AND reject | unit | `npm test -- approval.service` (backend) | ❌ Wave 0 |
| Regression | permissions-catalog.spec.ts still green with new controller sites | unit | `npm test -- permissions-catalog` (backend) | ✅ exists — MUST be updated alongside |
| Regression | rbac.guard.spec.ts still green (approval.* permissions) | unit | `npm test -- rbac.guard` (backend) | ✅ exists |

### Sampling Rate
- **Per task commit:** backend `npm test` quick (targeted spec) or frontend `npm test -- <file>`
- **Per wave merge:** full `npm test` in backend + frontend
- **Phase gate:** full backend + frontend suites green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `backend/src/approval/approval.service.spec.ts` — covers RBAC-03/04/06 (record creation, threshold gate, decision persistence)
- [ ] `backend/src/approval/approval.controller.spec.ts` — covers RBAC-05 endpoint surface + permission metadata
- [ ] `frontend/src/components/__tests__/ApprovalQueue.test.tsx` — covers RBAC-05 UI (tabs, approve/reject flow, comment-required-on-reject)
- [ ] Update `backend/src/common/permissions/permissions-catalog.spec.ts` — extend MATRIX + adjust site count for the new controller
- [ ] Update/add `state-machine` transition specs for `PENDING_APPROVAL->RECEIVED` and ADMIN role additions

## Security Domain

> `.planning/config.json` has no `security_enforcement` key → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Supabase auth + existing guards |
| V3 Session Management | no (unchanged) | Existing Supabase session handling |
| V4 Access Control | yes | `@RequiresPermission(approval.view_queue / approve_appraisal / approve_redemption)` + RbacGuard (staffType-aware); state machine `allowedRoles`; self-approval prevention guard |
| V5 Input Validation | yes | class-validator DTOs — `decisionComment` required on reject, length limits; `amountPaid` numeric; `id` param parse |
| V6 Cryptography | no (no new secrets/keys) | — |
| V7 (audit/logging) | yes | `@AuditLog` decorator on new endpoints + ApprovalRecord decision fields + LegalProof where applicable |

### Known Threat Patterns for {NestJS + Prisma + Supabase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Appraiser approves own appraisal / cashier approves own redemption | Elevation of Privilege | Self-approval guard: `requestedById !== decidedById` (discretion; straightforward) |
| Non-owner acts on queue (view or decide) | Information Disclosure / Tampering | `approval.*` permissions on every queue endpoint + RbacGuard; nav roles match (Owner/Admin/Manager view; only OWNER/ADMIN have approve perms — verified permissions.const.ts:69-71, 85-87) |
| Invalid state transition via direct API call | Tampering | `StateMachineService.transition` rejects unknown transitions; ADMIN added to allowedRoles where approver |
| Threshold bypass (redeem > threshold without approval) | Tampering | Server-side gate in `redeemTicket` — never trust client-side amount |
| Audit trail tampering | Repudiation | `ApprovalRecord` rows written by service (decidedBy/decidedAt/comment) + `@AuditLog` + LegalProof records; DB is source of truth |
| TOCTOU double-decide on same record | Tampering | Guard `record.status !== 'PENDING'` → BadRequestException before side effects; wrap decide in transaction |
| Settings clobber (threshold + finance keys) | Tampering/DoS | Merge-on-write for `Pawnshop.settings`; validate threshold is a positive number |

## Sources

### Primary (HIGH confidence)
- Codebase inspection (all paths verified by direct read this session):
  - `backend/prisma/schema.prisma` — ApprovalRecord model (line 1860), enums (ApprovalStatus/ApprovalTargetType lines 1814-1827), TicketLifecycleStatus (line 420), NotificationType/Channel (lines 1032-1052)
  - `backend/prisma/migrations/20260731120000_v2_schema_baseline/migration.sql` — approval_records DDL + enums + FKs
  - `backend/src/common/state-machine/pawn-lifecycle.ts` — full transition table (lines 3-25)
  - `backend/src/common/state-machine/state-machine.service.ts` — transition validation semantics
  - `backend/src/loan/pawn-ticket.service.ts` — appraiseTicket (364-439), redeemTicket (441-585), approveWithContract (249-362)
  - `backend/src/loan/pawn-ticket.controller.ts` — full endpoint + permission map (180 lines)
  - `backend/src/common/permissions/permissions.const.ts` — PERMISSIONS + ROLE_PERMISSIONS (37 perms / 101 mappings)
  - `backend/src/common/permissions/permissions-catalog.spec.ts` — hard count assertions
  - `backend/src/common/guards/pawnshop.guard.ts` — EXEMPT_PREFIXES (line 21-49)
  - `backend/src/tenant-governance/tenant-governance.service.ts` (2540-2566) + controller (377-385) — settings pattern + permission
  - `backend/src/finance/finance.service.ts` — getPawnshopSettings/savePawnshopSettings (158-184)
  - `backend/src/loan/loan.module.ts` — exports PawnTicketService; `notification.module.ts` exports NotificationService
  - `frontend/src/App.tsx` — TAB_TO_PATH (131-164), nav items (1185-1225), FREE_ALLOWED_NAV (1227-1240), render (1595-1654)
  - `frontend/src/lib/apiClient.ts`, `frontend/src/components/AppraisalApproval.tsx`, `PendingApprovalPanel.tsx`, `Redemption.tsx`
  - `frontend/package.json` / `backend/package.json` — versions, scripts, test config
- `.planning/config.json` — no nyquist_validation / security_enforcement keys
- `.planning/phases/08-approval-workflows-unified-approval-queue/08-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- [CITED: https://www.prisma.io/docs/orm/prisma-client/queries/transactions] — interactive transactions (rollback on throw; maxWait default 2000ms; timeout default 5000ms; isolationLevel default = DB config)
- [CITED: https://docs.nestjs.com/fundamentals/circular-dependency] — forwardRef / ModuleRef patterns
- [CITED: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields] — Json fields read/write; JsonNull/DbNull

### Tertiary (LOW confidence)
- None — no claims rely on unverified training data; all [ASSUMED] items are flagged in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 100% existing packages verified in package.json/node_modules; zero new installs
- Architecture: HIGH — chokepoint + one-way module pattern verified against actual exports/imports
- Pitfalls: HIGH — each pitfall traced to a concrete file/line in the codebase (spec counts, state machine roles, schema gaps)
- Web claims (Prisma transactions, NestJS circular deps, JSON fields): MEDIUM — cited from official docs, not re-verified against runtime in this session

**Research date:** 2026-08-01
**Valid until:** 2026-08-31 (fast-moving codebase; schema/migration and spec counts are the most fragile references)
