# Phase 8: Approval Workflows & Unified Approval Queue - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Sensitive pawnshop actions - creating an appraisal and releasing high-value redemptions - require OWNER/ADMIN sign-off through one unified approval queue. Every decision is persisted to the `ApprovalRecord` model with approver identity and comment, forming an auditable trail. Fast walk-in redemptions below a configured threshold stay direct (no approval step).

This phase delivers:
- RBAC-03: Appraisal creation generates a pending approval task; the ticket holds in `PENDING_APPROVAL` (not `APPRAISED`/`OFFER_MADE`) until OWNER/ADMIN approves.
- RBAC-04: Redemptions above a configured amount threshold require OWNER approval before release; below-threshold redemptions complete directly.
- RBAC-05: One unified approval queue UI showing all pending appraisal and redemption tasks, with approve/reject actions and an approver audit trail.
- RBAC-06: All approval decisions persisted to `ApprovalRecord` (activate the dead model from the Phase 7 schema baseline).

Out of scope: KYC gating (Phase 9 - KYC-03 gate lands on this final approval flow shape), contract management upgrades (Phase 11), ticket-creation approval flow itself (already exists via `POST /pawn-tickets/:id/approve`).

</domain>

<decisions>
## Implementation Decisions

### Appraisal Hold State
- **D-01:** When an appraiser submits a valuation, the ticket transitions `RECEIVED -> PENDING_APPROVAL` instead of the current `RECEIVED -> APPRAISED` in `appraiseTicket` (pawn-ticket.service.ts:377). `PENDING_APPROVAL` lifecycle status and the `RECEIVED -> PENDING_APPROVAL` / `PENDING_APPROVAL -> OFFER_MADE|CANCELLED` transitions already exist in the state machine (pawn-lifecycle.ts:8-10) - reuse them, do not add new states.
- **D-02:** Appraisal data (appraisedValue, riskScore, recommendedLoanAmount, itemCondition, appraisalNotes) is captured in the approval task (ApprovalRecord payload). The ticket's `loanAmount` field is only applied when the approval is granted - it must NOT be written to the ticket at appraisal-submission time (change current behavior at pawn-ticket.service.ts:388).
- **D-03:** Approval granted -> ticket advances `PENDING_APPROVAL -> OFFER_MADE`. The existing contract-generation / offer logic from `POST /pawn-tickets/:id/approve` remains the step that produces the offer - approval advances the ticket state so that existing offer action can run.
- **D-04:** Approval rejected -> ticket returns to `RECEIVED` (add a `PENDING_APPROVAL -> RECEIVED` return path to the state machine) with the rejection comment so the appraiser can edit and re-submit.

### Redemption Threshold Config
- **D-05:** High-value threshold is stored per-tenant in `Pawnshop.settings` JSON under a namespaced key (e.g. `redemptionApprovalThreshold`), following the existing finance (`LEDGER_REQUESTS_SETTINGS_KEY`) and payroll (`PAYROLL_SETTINGS_KEY`) settings pattern (finance.service.ts:171, payroll.service.ts:68).
- **D-06:** Default threshold is 50,000 (PHP). Redemptions where `amountPaid` (redeem-ticket.dto.ts:5) exceeds the threshold require OWNER approval; at or below threshold proceeds directly (fast walk-in flow preserved).
- **D-07:** Threshold is editable via the existing `PATCH /pawnshops/:id/settings` endpoint (tenant-governance.controller.ts:385). No new settings surface is needed.

### Unified Queue UX
- **D-08:** Build a new unified approval queue page (frontend route, e.g. `/approval-queue`) backed by a new `GET /approval-queue` endpoint that returns pending `ApprovalRecord` items across both target types (APPRAISAL, REDEMPTION).
- **D-09:** The page shows tabs/filters for Appraisal | Redemption, per-row approve/reject with a required comment on rejection, and a past-decision audit view showing approver identity, decision, comment, and timestamps.
- **D-10:** Consolidate/retire the existing `PendingApprovalPanel.tsx` and `AppraisalApproval.tsx` components in favor of the unified queue. Approval actions are gated by the `approval.view_queue` / `approval.approve_appraisal` / `approval.approve_redemption` permissions already seeded in Phase 7. The existing `/pawn-tickets/pending-approval` (ticket-creation approval) flow is a separate concern and remains available.

### Approval Side Effects & Resubmission
- **D-11:** Appraisal reject -> ticket back to `RECEIVED`, appraiser re-appraises and re-submits (new approval task). Previous rejection comment must be visible to the appraiser for context.
- **D-12:** Redemption approve -> the existing `redeemTicket` release logic runs (payment, ledger entry, LegalProof, receipt, tier update, notification). Redemption reject -> ticket stays `ACTIVE`/`GRACE_PERIOD`, staff/cashier notified; can be re-requested.
- **D-13:** Every decision (approve AND reject) writes a persisted `ApprovalRecord` row with `decidedBy`, `decidedAt`, `decisionComment`, and `status`, satisfying the auditable trail requirement.

### the agent's Discretion
- Approval record field wiring (targetType/targetId mapping to tickets, amount population) — follow the ApprovalRecord schema (schema.prisma:1860).
- Whether the unified queue audit view shows full history vs recent-only — keep it full-history; it is cheap and supports thesis traceability.
- Self-approval prevention detail (e.g. requester cannot approve own request) — implement if straightforward.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope & Requirements
- `.planning/ROADMAP.md` § "Phase 8: Approval Workflows & Unified Approval Queue" — Goal, success criteria, dependency on Phase 7.
- `.planning/REQUIREMENTS.md` § RBAC-03, RBAC-04, RBAC-05, RBAC-06 — Requirement wording.
- `.planning/PROJECT.md` — Project context and constraints.

### Approval Record & Schema
- `backend/prisma/schema.prisma` § ApprovalRecord model (~line 1860) — columns: pawnshopId, targetType (ApprovalTargetType), targetId, status (ApprovalStatus default PENDING), amount, requestedById, decidedById, decidedAt, decisionComment, createdAt/updatedAt; indexes `[pawnshopId, status]`, `[targetType, targetId]`. Also § ApprovalTargetType / ApprovalStatus enums.
- `backend/prisma/schema.prisma` § TicketLifecycleStatus enum (line 420) — includes `PENDING_APPROVAL` already.

### State Machine
- `backend/src/common/state-machine/pawn-lifecycle.ts` — TICKET_LIFECYCLE transitions including existing `RECEIVED -> PENDING_APPROVAL` and `PENDING_APPROVAL -> OFFER_MADE|CANCELLED` (lines 8-10). A `PENDING_APPROVAL -> RECEIVED` return transition must be added.
- `backend/src/common/state-machine/state-machine.service.ts` — transition registration and validation.

### Permissions (Phase 7)
- `backend/src/common/permissions/permissions.const.ts` — approval.* permissions and role-permission matrix (already seeded).
- `backend/src/common/guards/rbac.guard.ts` — staffType-aware RBAC guard with @RequiresPermission support.
- `backend/src/common/decorators/requires-permission.decorator.ts` — permission decorator.

### Appraisal / Redemption Flows
- `backend/src/loan/pawn-ticket.service.ts` — `appraiseTicket` (:364) currently transitions RECEIVED->APPRAISED and writes loanAmount immediately (:388); `redeemTicket` (:441) does the full release (payment, ledger, proof, receipt).
- `backend/src/loan/pawn-ticket.controller.ts` — existing approval endpoints: `GET /pawn-tickets/pending-approval` (:92), `POST /pawn-tickets/:id/approve` (:108), `POST /pawn-tickets/:id/appraise` (:124), `POST /pawn-tickets/:id/redeem` (:144).
- `backend/src/loan/dto/redeem-ticket.dto.ts` — `amountPaid` (:5), the value compared against the threshold.

### Tenant Settings Pattern
- `backend/src/tenant-governance/tenant-governance.controller.ts` — `PATCH /pawnshops/:id/settings` (:385).
- `backend/src/finance/finance.service.ts` § getPawnshopSettings / savePawnshopSettings (:170-173, :224-227) — the established namespaced settings-JSON pattern to follow.
- `backend/src/payroll/payroll.service.ts` — same pattern with `PAYROLL_SETTINGS_KEY` (:68).

### Existing UI to Consolidate
- `frontend/src/components/PendingApprovalPanel.tsx` — ticket-creation approval panel (separate concern; reference for styling/behavior).
- `frontend/src/components/AppraisalApproval.tsx` — current appraisal approval UI to consolidate into unified queue.
- `frontend/src/App.tsx` — route registration (~:57, :143, :1619).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ApprovalRecord` Prisma model — exists, unused since Phase 7; this phase activates it.
- State machine `PENDING_APPROVAL` transitions — already registered; no new lifecycle states needed.
- `approval.view_queue` / `approval.approve_appraisal` / `approval.approve_redemption` permissions — seeded in Phase 7; gate the new endpoints.
- `PATCH /pawnshops/:id/settings` + `Pawnshop.settings` JSON — threshold config surface already exists.
- `redeemTicket` full release logic (payment, ledger, LegalProof, receipt, tier, notification) — reuse for the approval-granted redemption path.
- `AppraisalApproval.tsx` / `PendingApprovalPanel.tsx` — existing approval UI styling, Swal confirm patterns, apiClient usage.

### Established Patterns
- Backend-first: controller -> service -> dto, NestJS module convention (AGENTS.md "Coding Conventions").
- Settings stored as namespaced keys in `Pawnshop.settings` JSON with getter/setter service methods (finance/payroll precedent).
- Audit trail via AuditLog interceptor + LegalProof service; approval decisions additionally persisted to ApprovalRecord.
- No comments in source unless asked.

### Integration Points
- `appraiseTicket` (pawn-ticket.service.ts:364) — change transition target to PENDING_APPROVAL; do not write loanAmount at submit time.
- `redeemTicket` (pawn-ticket.service.ts:441) — gate on threshold at the top; route above-threshold to approval, below-threshold to direct release.
- New approval service/controller/module (e.g. `backend/src/approval/`) — creates ApprovalRecord tasks, resolves them, exposes `GET /approval-queue`.
- Frontend: new `/approval-queue` route + page; consolidate old panels.
- `pawnshop.guard.ts` (:45) — `/pawn-tickets/pending-approval` allowlist may need sibling entries for the new queue endpoint.

</code_context>

<specifics>
## Specific Ideas

No specific references — decisions captured above are sufficient. Standard approaches for the queue UI, consistent with the existing Gilded Reserve dark theme and Swal confirm patterns.

</specifics>

<deferred>
## Deferred Ideas

- KYC verification gate on ticket creation/approval/disbursement — Phase 9 (depends on this phase's final approval flow shape).
- Contract management upgrade (signature image upload, item-specific redemption terms) — Phase 11.

None else — discussion stayed within phase scope.

</deferred>

---

*Phase: 8-Approval Workflows & Unified Approval Queue*
*Context gathered: 2026-08-01*
