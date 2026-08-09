# Milestone v2.0 — Advisor Compliance & RBAC Overhaul

**Created:** 2026-07-31
**Status:** Active
**Source:** Tech advisor review (2026-07-31) + deep codebase audit (5 areas)

---

## Background

The tech advisor reviewed the system from a week-old snapshot. A full codebase audit was
run against his five requirement areas to separate already-done from missing work. This
milestone closes every gap. Audit summary:

| Advisor item | Audit verdict |
|---|---|
| Compliance & onboarding gate | Docs-before-trial gate MISSING; review modal exists but no `hasViewed`; no REJECTED aggregation |
| Contract management | Canvas/typed signatures only (no image upload); generic redemption clause only; no liability clauses |
| RBAC & approvals | Hardcoded role strings; appraisal/redemption have no OWNER approval step; RbacGuard ignores staffType |
| KYC & disbursement | KYC is auction-bidder-only; zero KYC checks in loan/disbursement pipeline; KYC docs public-read |
| History & tiering | Unified history exists but misses redemptions + auction receipts; tiers are redemption-count only |

---

## Active Requirements

### ONB · Compliance & Shop Onboarding Gate

- [ ] **ONB-01**: Owner cannot initialize Free Trial until all required regulatory documents are submitted and at least pending review — enforced server-side (approval path), not just UI.
- [ ] **ONB-02**: Admin reviews onboarding documents inside the viewer modal; Approve/Reject buttons live in the modal; Approve is disabled until the document is opened/viewed (`hasViewed` state persisted server-side).
- [ ] **ONB-03**: Any document with status REJECTED sets the overall shop onboarding status to REJECTED/ACTION_REQUIRED; aggregated status is exposed via API and reflected in the owner dashboard.
- [ ] **ONB-04**: Client's Compliance Dashboard reflects real-time document approval status (existing behavior verified end-to-end).

### CTR · Contract Management

- [ ] **CTR-01**: Staff can upload a digital signature image during contract signing (alongside the existing canvas-drawn and typed-name paths); uploads are validated (mime/size) and persisted.
- [ ] **CTR-02**: Loan contract template renders item-specific redemption terms — redemption date, redemption amount, appraisal value, forfeiture date — injected per ticket at generation time.
- [ ] **CTR-03**: Loan contract template includes pawnshop responsibilities & liability clauses (custody and duty of care of collateral, loss/damage liability), seeded into the active LOAN_CONTRACT template.

### RBAC · Fine-Grained RBAC & Workflow Approvals

- [ ] **RBAC-01**: Permission catalog (enum) plus role→permission mapping replaces hardcoded `@Roles('OWNER','MANAGER')` role strings; endpoints declare `@RequiresPermission(...)` and RbacGuard evaluates permissions.
- [ ] **RBAC-02**: RbacGuard honors `staffType` so APPRAISER/CASHIER_TELLER/INVENTORY_CUSTODIAN/AUDITOR checks work after the role-normalization migration.
- [x] **RBAC-03**: Creating an appraisal (`CREATE_APPRAISAL`) generates an approval task; the ticket does not advance to APPRAISED/OFFER until OWNER/ADMIN approves.
- [x] **RBAC-04**: Redemptions above a configured amount threshold (`APPROVE_REDEMPTION`) require OWNER approval before release; redemptions below the threshold remain direct (fast walk-in flow).
- [x] **RBAC-05**: Approval tasks surface in one unified approval queue UI (mount/consolidate existing `PendingApprovalPanel` / `AppraisalApproval`) with a clear approver audit trail.
- [x] **RBAC-06**: Approval decisions are persisted to a dedicated approval-record model (activate the dead `LoanApproval` table or add `PawnTicketApproval`).

### KYC · Client Verification & Loan Disbursement Guardrail

- [x] **KYC-01**: Customer record carries a KYC verification status linked to a KYC record (reuse/extend `BidderKyc` keyed by shared customer UUID, or add customer KYC model).
- [x] **KYC-02**: OWNER/MANAGER can review client KYC submissions and set VERIFIED/REJECTED (new client-KYC review screen).
- [x] **KYC-03**: Pawn ticket creation and approval require the client's KYC status to be VERIFIED.
- [x] **KYC-04**: Loan disbursement is blocked when the client's KYC status is not VERIFIED.
- [x] **KYC-05**: KYC document storage is secured — RLS policies on `bidder_kyc`, `kyc-documents` bucket no longer public-read; only owning tenant/super-admin can access.

### CUST · Customer Transaction History & Tiering

- [ ] **CUST-01**: Unified customer history includes redemptions (in-person and online) and auction receipts alongside loans/payments/proofs.
- [ ] **CUST-02**: `Receipt` carries a `customerId` (FK) so receipts join to customers across domains.
- [ ] **CUST-03**: Customer tier is computed from transaction volume/amount (not redemption count only), recomputed on relevant events and exposed via API.
- [ ] **CUST-04**: Customer schema/API supports tier history (audit of tier changes) and per-customer aggregate queries.

---

## Future Requirements (deferred)

- Customer-facing loyalty program UI (points, rewards, redemption of loyalty benefits).
- Self-service customer KYC submission from the mobile app.
- Admin dashboard for KYC analytics/verification rate.

## Out of Scope

- **Subscription billing overhaul** — existing trial/payment flows stay; only the docs-before-trial ordering gate changes.
- **Mobile parity for auction signing / contracts** — mobile app remains read-only for receipts.
- **Microservice decomposition** — stays a monolith NestJS app.
- **Complete permission refactor of every endpoint in one pass** — RBAC-01 lands the mechanism; permission metadata is backfilled per-endpoint as phases touch them.

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| ONB-01 | Phase 10 | Pending |
| ONB-02 | Phase 10 | Pending |
| ONB-03 | Phase 10 | Pending |
| ONB-04 | Phase 10 | Pending |
| CTR-01 | Phase 11 | Pending |
| CTR-02 | Phase 11 | Pending |
| CTR-03 | Phase 11 | Pending |
| RBAC-01 | Phase 7 | Pending |
| RBAC-02 | Phase 7 | Pending |
| RBAC-03 | Phase 8 | Complete |
| RBAC-04 | Phase 8 | Complete |
| RBAC-05 | Phase 8 | Complete |
| RBAC-06 | Phase 8 | Complete |
| KYC-01 | Phase 9 | Complete |
| KYC-02 | Phase 9 | Complete |
| KYC-03 | Phase 9 | Complete |
| KYC-04 | Phase 9 | Complete |
| KYC-05 | Phase 9 | Complete |
| CUST-01 | Phase 12 | Pending |
| CUST-02 | Phase 12 | Pending |
| CUST-03 | Phase 12 | Pending |
| CUST-04 | Phase 12 | Pending |
