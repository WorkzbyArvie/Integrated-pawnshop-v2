# ROADMAP.md — PawnGold Integrated Pawnshop Management System

**Timeline:** Less than 2 weeks to thesis B defense
**Strategy:** Backend-first (NestJS/Prisma) → Frontend within each phase → Verified before moving on

---

## Overview

PawnGold is a full-stack SaaS pawnshop platform (React dashboard + NestJS + Prisma/Postgres + auction frontend + read-only Flutter mobile). v1.0 shipped the legality backbone (contracts, receipts, legal proofs, state machine, RBAC guard, frontend integration, auction house). Milestone v2.0 closes every gap from the tech advisor's review: compliance/onboarding gate, permission-based RBAC with approval chains, KYC disbursement guardrail, contract upgrades, and unified customer history with volume-based tiering.

## Milestones

- ✅ **v1.0 Core Pawnshop Platform** — Phases 1-6 (shipped 2026-07-31)
- 🚧 **v2.0 Advisor Compliance & RBAC Overhaul** — Phases 7-12 (in progress)

---

## Phases (v2.0 — Active Milestone)

**Phase Numbering:** Continuous across milestones. v1.0 ended at Phase 6; v2.0 starts at Phase 7. Decimal phases (e.g., 7.1) are reserved for urgent insertions.

- [x] **Phase 7: Permission Foundation & Schema Baseline** - Data-driven permission catalog + staffType-aware RbacGuard on top of one batched schema migration for all v2.0 additions
- [x] **Phase 8: Approval Workflows & Unified Approval Queue** - OWNER/ADMIN approval for appraisals and high-value redemptions with a unified queue and persistent audit trail
- [ ] **Phase 9: KYC Verification & Disbursement Guardrail** - KYC verification gates ticket creation/approval/disbursement; KYC documents secured via RLS
- [ ] **Phase 10: Onboarding Compliance Gate** - Docs-before-trial gate, view-before-approve review modal, REJECTED/ACTION_REQUIRED aggregation on owner + client dashboards
- [ ] **Phase 11: Contract Management Upgrade** - Signature image upload, item-specific redemption terms, pawnshop responsibilities & liability clauses
- [ ] **Phase 12: Customer History & Volume-Based Tiering** - Unified per-customer history across domains; transaction-volume-based tiers with auditable tier history

---

## Phase Details

### Phase 7: Permission Foundation & Schema Baseline

**Goal**: Authorization becomes data-driven — a seeded permission catalog plus staffType-aware RbacGuard replaces hardcoded role strings — on top of a single batched Prisma migration that adds every v2.0 schema element (permission catalog + role→permission mapping, approval-record model, customer KYC link, `receipt.customerId`, customer tier + tier-history fields, onboarding `hasViewed`, signature-image metadata).
**Depends on**: Nothing (first phase of milestone v2.0)
**Requirements**: RBAC-01, RBAC-02
**Success Criteria** (what must be TRUE):

  1. Requests to `@RequiresPermission`-guarded endpoints are allowed only when the caller's role holds that permission in the catalog; otherwise the request is rejected (403).
  2. Role→permission mapping is data-driven: editing a role's permission set in the seeded catalog changes enforcement with no code change.
  3. Users with staffType APPRAISER / CASHIER_TELLER / INVENTORY_CUSTODIAN / AUDITOR are evaluated by staffType permissions after role normalization (their checks no longer fail or bypass).
  4. SUPER_ADMIN retains full-access bypass across all guarded endpoints.

**Status**: ✅ Complete (2026-07-31, verified 2026-08-01)
**Plans**: 07-01-PLAN (1 plan, 13 tasks, 5 waves)

### Phase 8: Approval Workflows & Unified Approval Queue

**Goal**: Sensitive actions — creating an appraisal and releasing high-value redemptions — require OWNER/ADMIN sign-off, surfaced in one unified approval queue with a persisted, auditable decision trail.
**Depends on**: Phase 7 (permission mechanism; approval-record model from schema baseline)
**Requirements**: RBAC-03, RBAC-04, RBAC-05, RBAC-06
**Success Criteria** (what must be TRUE):

  1. Creating an appraisal generates a pending approval task; the ticket does not advance to APPRAISED/OFFER until OWNER/ADMIN approves.
  2. Redemptions above the configured amount threshold require OWNER approval before release; redemptions below the threshold complete directly (fast walk-in flow preserved).
  3. Staff can open one unified approval queue showing all pending appraisal and redemption tasks and approve or reject each.
  4. Every approval decision is persisted to the approval-record model with approver identity and decision, forming an auditable trail.

**Plans**:
**Wave 1**

- [x] 08-01-PLAN.md — Schema payload + state-machine roles + RED test scaffolds

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-02-PLAN.md — Approval backend: chokepoints, module, catalog, settings permission

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 08-03-PLAN.md — Approval queue UI + threshold config in System Settings

**UI hint**: yes

### Phase 9: KYC Verification & Disbursement Guardrail

**Goal**: Client KYC verification gates the loan pipeline — ticket creation, approval, and disbursement — and KYC documents are stored securely (no public-read bucket, RLS on `bidder_kyc`).
**Depends on**: Phase 8 (KYC gate lands on the final approval flow shape)
**Requirements**: KYC-01, KYC-02, KYC-03, KYC-04, KYC-05
**Success Criteria** (what must be TRUE):

  1. Customer records carry a KYC verification status linked to a KYC record, exposed via API.
  2. OWNER/MANAGER can open a client-KYC review screen and set a submission to VERIFIED or REJECTED.
  3. Pawn ticket creation and approval reject clients whose KYC status is not VERIFIED.
  4. Loan disbursement is blocked with a clear error when the client's KYC status is not VERIFIED.
  5. `kyc-documents` bucket is no longer public-read; `bidder_kyc` rows are readable only by the owning tenant / super-admin.

**Plans**: 4 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 09-01-PLAN.md — KycModule (upsert/list/review) + MANAGER grant + 12-digit National ID fix
- [x] 09-02-PLAN.md — KYC gates: ticket creation, approval, disbursement + mobile path

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 09-03-PLAN.md — Frontend: Customer KYC Review screen + SalesPos badge + signed-URL docs
- [ ] 09-04-PLAN.md — KYC-05 storage/RLS security SQL + demo seed

### Phase 10: Onboarding Compliance Gate

**Goal**: Free Trial cannot start until required regulatory documents are submitted and reviewed; admin review requires view-before-approve (`hasViewed`), and any REJECTED document drives an aggregated REJECTED/ACTION_REQUIRED status on owner and client dashboards.
**Depends on**: Phase 7 (hasViewed field from schema baseline; permission-protected admin endpoints)
**Requirements**: ONB-01, ONB-02, ONB-03, ONB-04
**Success Criteria** (what must be TRUE):

  1. Owner cannot start the Free Trial until all required regulatory documents are submitted and at least pending review — enforced server-side (approval path), not just UI.
  2. Admin opens the document inside the viewer modal before Approve becomes enabled; the viewed state (`hasViewed`) is persisted server-side.
  3. Any document with status REJECTED sets the overall shop onboarding status to REJECTED/ACTION_REQUIRED, exposed via the API.
  4. Owner dashboard reflects the aggregated onboarding status in real time (including the REJECTED/ACTION_REQUIRED state).
  5. Client Compliance Dashboard reflects real-time per-document approval status end-to-end.

**Plans**: TBD
**UI hint**: yes

### Phase 11: Contract Management Upgrade

**Goal**: Contract signing supports digital signature image upload alongside canvas/typed paths, and generated loan contracts carry item-specific redemption terms plus pawnshop responsibilities & liability clauses.
**Depends on**: Phase 7 (signature-image metadata fields from schema baseline)
**Requirements**: CTR-01, CTR-02, CTR-03
**Success Criteria** (what must be TRUE):

  1. Staff can upload a digital signature image during contract signing (mime/size validated, persisted) alongside the existing canvas-drawn and typed-name paths.
  2. Generated loan contracts inject item-specific redemption terms per ticket — redemption date, redemption amount, appraisal value, forfeiture date — at generation time.
  3. The active LOAN_CONTRACT template includes pawnshop responsibilities & liability clauses (custody and duty of care of collateral, loss/damage liability).

**Plans**: TBD
**UI hint**: yes

### Phase 12: Customer History & Volume-Based Tiering

**Goal**: Unified per-customer transaction history spans loans, payments, proofs, redemptions (in-person and online), and auction receipts; customer tiers derive from transaction volume/amount with an auditable tier history.
**Depends on**: Phase 7 (receipt.customerId and tier fields from schema baseline); consumes data produced by Phases 8-11
**Requirements**: CUST-01, CUST-02, CUST-03, CUST-04
**Success Criteria** (what must be TRUE):

  1. Unified customer history shows in-person and online redemptions and auction receipts alongside loans, payments, and proofs.
  2. Receipts carry a `customerId` (FK) and join to customer history across domains.
  3. Customer tier is computed from transaction volume/amount (not redemption count only), recomputed on relevant events, and exposed via API.
  4. Tier changes are recorded as history and per-customer aggregate queries return correct totals.

**Plans**: TBD
**UI hint**: yes

---

<details>
<summary>✅ v1.0 Core Pawnshop Platform (Phases 1-6) — SHIPPED 2026-07-31</summary>

### Phase 1: Fix & Verify Backend

**Goal**: Backend compiles and starts (Prisma client regeneration resolved 104 compilation errors).
**Status**: Complete

### Phase 2: Pawn Ticket Lifecycle

**Goal**: End-to-end pawn ticket flow works with state machine and LegalProof/Receipt at each transition.
**Status**: Complete

### Phase 2.5: Process Flow Completion

**Goal**: Appraisal endpoint, grace-period cron, in-person redemption, and lifecycle notifications fill process gaps.
**Status**: Complete

### Phase 3: Contract & Receipt System

**Goal**: Contracts, receipts, and TOS acceptance generate correctly with sequential receipt numbering and LegalProof links.
**Status**: Complete

### Phase 4: Frontend Integration

**Goal**: Frontend routes all writes through the backend API; contract viewer, receipt viewer, history timeline verified.
**Status**: Complete

### Phase 5: Security & Polish

**Goal**: RBAC guard on critical endpoints, no auth console leaks, no silent catch blocks, all 10 roles verified.
**Status**: Complete

### Phase 6: Auction House Professionalization

**Goal**: Winner contract signing, staff release workflow, countdown timer, settlement admin.
**Status**: Complete

</details>

---

## Progress

**Execution Order:** Phases execute in numeric order: 7 → 8 → 9 → 10 → 11 → 12

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Fix & Verify Backend | v1.0 | - | Complete | 2026-07-31 |
| 2. Pawn Ticket Lifecycle | v1.0 | - | Complete | 2026-07-31 |
| 2.5. Process Flow Completion | v1.0 | - | Complete | 2026-07-31 |
| 3. Contract & Receipt System | v1.0 | - | Complete | 2026-07-31 |
| 4. Frontend Integration | v1.0 | - | Complete | 2026-07-31 |
| 5. Security & Polish | v1.0 | - | Complete | 2026-07-31 |
| 6. Auction House Professionalization | v1.0 | - | Complete | 2026-07-31 |
| 7. Permission Foundation & Schema Baseline | v2.0 | 1 | Complete | 2026-07-31 |
| 8. Approval Workflows & Unified Approval Queue | v2.0 | 3/3 | In Progress|  |
| 9. KYC Verification & Disbursement Guardrail | v2.0 | 3/4 | In Progress|  |
| 10. Onboarding Compliance Gate | v2.0 | TBD | Not started | - |
| 11. Contract Management Upgrade | v2.0 | TBD | Not started | - |
| 12. Customer History & Volume-Based Tiering | v2.0 | TBD | Not started | - |
