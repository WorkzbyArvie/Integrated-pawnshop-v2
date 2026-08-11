---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Advisor Compliance & RBAC Overhaul
current_phase: 10
current_phase_name: Onboarding Compliance Gate
status: planning
stopped_at: Completed 10-02-PLAN.md (ONB-02 view-before-approve + D-07 permissions)
last_updated: "2026-08-11T16:20:00.000Z"
last_activity: 2026-08-11
last_activity_desc: 10-02-PLAN.md executed (3 tasks, 3 commits)
progress:
  total_phases: 13
  completed_phases: 2
  total_plans: 12
  completed_plans: 9
  percent: 15
---

# STATE.md — PawnGold Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-31)

**Core value:** Close every tech-advisor gap for thesis B defense — compliance/onboarding gate, contract upgrades, permission-based RBAC with approval chains, KYC disbursement guardrail, unified customer history with volume-based tiering.
**Current focus:** Phase 10 — onboarding-compliance-gate

## Current Position

Phase: 10 — Onboarding Compliance Gate
Plan: 10-02 executed (ONB-02 view-before-approve + D-07 permissions) — 10-03/10-04 pending
Status: In progress
Last activity: 2026-08-11 — 10-02-PLAN.md executed (3 tasks, 3 commits)

Progress: [████████░░] 75%

## Milestone Progress (v2.0)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 7: Permission Foundation & Schema Baseline | ✅ Complete | RBAC-01, RBAC-02 + batched schema baseline (verified 2026-08-01) |
| Phase 8: Approval Workflows & Unified Approval Queue | ✅ Complete | RBAC-03..06: chokepoints + approval API (08-02) + unified queue UI + threshold config (08-03, verified 2026-08-06) |
| Phase 9: KYC Verification & Disbursement Guardrail | ✅ Complete | KYC-01..05 — 4 plans executed, verification passed 22/22 (2026-08-09) |
| Phase 10: Onboarding Compliance Gate | 🔄 In progress | ONB-01/ONB-02 done (10-01 gate, 10-02 view-before-approve + D-07), ONB-03/04 pending (10-03..10-04) |
| Phase 11: Contract Management Upgrade | ○ Not started | CTR-01..03 |
| Phase 12: Customer History & Volume-Based Tiering | ○ Not started | CUST-01..04 |

(v1.0 Phases 1-6 complete — see ROADMAP.md)

## Blockers

- None currently

## Decisions

- v2.0 roadmap: 6 phases (7-12), continuous numbering from v1.0's Phase 6
- Backend-first within each phase (NestJS/Prisma → frontend) — no separate UI phase; each feature phase owns its screens
- Schema baseline batched into Phase 7 (single migration set for approval model, customer KYC, receipt.customerId, tier fields, hasViewed, signature metadata) — folded into the permission phase instead of a zero-requirement schema-only phase
- KYC-05 (bucket/RLS security) kept inside the KYC phase for category coherence
- KYC gate (KYC-03) lands on the Phase 8 approval flow — Phase 9 depends on Phase 8
- Phase 12 only needs Phase 7's schema; it consumes data produced by Phases 8-11
- Phase 7 executed outside the tracked GSD flow but verified complete (2026-08-01): migration applied, DB up-to-date, guard/catalog/service specs green, all 63 endpoints converted, tsc clean
- Working tree carries ~100 uncommitted files (owner registration, KYC, tenant governance) unrelated to the committed Phase 7 work — left untouched
- [Phase ?]: T3 RED scaffolds locked to the plan Interface Contract (getQueue(query, callerPawnshopId) returning ApprovalQueueItem[]; decideApproval(id, dto, decidedBy, userRole, approve, callerPawnshopId); routes /approval-queue; permissions approval.view_queue / approval.approve_appraisal) so 08-02/08-03 implement without changing test expectations
- [Phase ?]: Migration file is the deliverable when dev DB unreachable (getaddrinfo ENOTFOUND base); all Phase 8 specs use mocked Prisma - no live-DB dependency
- [Phase ?]: Redemption threshold contract: redeemTicket reads pawnshop.settings.redemptionApprovalThreshold via prisma.pawnshop.findUnique; above -> PENDING REDEMPTION record, at/below -> direct release
- [Phase ?]: GetRoot metadata decorator: Nest 10 @Get() coerces handler path to '/', locked RED spec asserts '' — local factory decorator emits path '' + method GET (spec + runtime both satisfied)
- [Phase ?]: DTO query field is targetType (not type) to match the locked RED getQueue contract
- [Phase ?]: getQueue ticket enrichment null-safe (?? []); redeemTicket approvalId optional-chained — both because RED specs leave Prisma delegates unmocked
- [Phase ?]: Permissions catalog site count is 64->67 (plan said 63->66) — plan stale, catalog spec is authority
- [Phase ?]: 08-03: RED test scaffold is the executable contract - approve POSTs on click (no Swal gate), reject comment is an inline Textarea with disabled-until-non-empty Reject
- [Phase ?]: 08-03: Radix Tabs v2 activates on onMouseDown, not click - tab-switch tests dispatch fireEvent.mouseDown
- [Phase ?]: 08-03: SystemSettings branch-admin save spreads currentSettings FIRST (merge-on-write) so threshold-only saves cannot wipe finance/payroll keys
- [Phase ?]: 08-03: threshold is branch-level local state; super-admin global_overrides path unchanged
- [Phase ?]: Dual-column KYC status writes (CustomerKyc.status + Customer.kycStatus) executed in one interactive Prisma transaction; specs assert top-level mocks never called
- [Phase ?]: Counter KYC upsert stays ungated; GET list requires kyc.view; PATCH review requires kyc.verify (D-01/D-04)
- [Phase ?]: Shared KYC gate implemented as a module-level exported function in pawn-ticket.service.ts, imported by loan.service.ts and app.service.ts (plan-sanctioned) - no DI/module-boundary changes
- [Phase ?]: Gates read ONLY Customer.kycStatus denormalized column (from 09-01) - no extra query or CustomerKyc join
- [Phase ?]: Gates placed after existing not-found/status guards and before stateMachine.transition - blocked requests never mutate state
- [Phase ?]: 09-03: CustomerKycReview props typed branchId?: string | null (not plan-text number | null) to match what App.tsx actually passes (currentBranchId is string|null) - avoids a new TS2322; mirrors ApprovalQueue call-site convention
- [Phase ?]: 09-03: LoanManagement.tsx added to Task 3 scope (deviation) - SalesPos is rendered via LoanManagement, so userRole must be threaded through it
- [Phase ?]: 09-03: All four kyc-documents read surfaces mint signed URLs (DocLink for review screens, SignedDocImage for super-admin, effect+state for TrialRequestsPanel preview); producer-only getPublicUrl upload sites (AuctionMarketplace, PendingAccessDashboard, OwnerComplianceDashboard, SalesPos) classified unchanged per COVERAGE.md row 10
- [Phase ?]: Tenant-staff RLS tier joins through profiles only (staff table has no pawnshop_id column — verified schema.prisma Staff :241 and regenerate migration DDL); join-through-profile shape preserved per plan pre-authorization
- [Phase ?]: Section C uses permissions-name join (INSERT..SELECT JOIN permissions) not literal VALUES — role_permissions.permission_id is UUID; baseline migration shape is the exact form
- [Phase ?]: 10-01: ONB-01 server-side docs-before-trial gate at top of reviewClientRegistrationRequest APPROVED branch (before ensureTenantModuleConfigTable); REQUIRED_ONBOARDING_DOC_TYPES shared const (D-02); gate status set UPLOADED/UNDER_REVIEW/VERIFIED (D-03); Prisma.join enum-array binding; 400 lists missing types with zero side effects
- [Phase ?]: 10-02: ONB-02 view endpoint POST .../documents/:documentId/view persists has_viewed/viewed_at/viewed_by idempotently (D-05); reviewRegistrationDocument APPROVED 400s unless has_viewed (D-06, after the VERIFIED/REJECTED status lock); @RequiresPermission onboarding.review_documents/onboarding.approve on 4 endpoints + SUPER_ADMIN_PERMISSIONS extended in the SAME commit (RbacGuard has no blanket SUPER_ADMIN bypass — rbac.guard.ts:119-128); catalog spec 69→71

## Session Continuity

Last session: 2026-08-11T16:20:00.000Z
Stopped at: Completed 10-02-PLAN.md (ONB-02 view-before-approve + D-07 permissions)
Resume file: .planning/phases/10-onboarding-compliance-gate/10-02-SUMMARY.md
Next: /gsd-execute-phase 10

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 08 P01 | 13 | 3 tasks | 7 files |
| Phase 08-approval-workflows-unified-approval-queue P08-02 | 120 | 3 tasks | 12 files |
| Phase 08 P08-03 | 150 | 3 tasks | 5 files |
| Phase 09 P01 | 5min | 3 tasks | 12 files |
| Phase 09-kyc-verification-disbursement-guardrail P02 | 8min | 3 tasks | 6 files |
| Phase 09-kyc-verification-disbursement-guardrail P03 | 30min | 5 tasks | 13 files |
| Phase 09-kyc-verification-disbursement-guardrail P04 | 28min | 2 tasks | 2 files |
| Phase 10-onboarding-compliance-gate P10-01 | 28 | 2 tasks | 3 files |
| Phase 10-onboarding-compliance-gate P10-02 | 14 | 3 tasks | 5 files |
