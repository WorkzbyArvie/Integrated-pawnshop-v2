---
phase: 08
slug: approval-workflows-unified-approval-queue
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-01
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: jest 29.x (ts-jest); Frontend: vitest 3.x |
| **Config file** | Backend: jest block in `backend/package.json` (rootDir src, testRegex `*.spec.ts`); Frontend: `frontend/package.json` script `test: vitest` |
| **Quick run command** | Backend: `npm test` (in `backend/`) with `-- approval` / `-- pawn-ticket` / `-- permissions-catalog`; Frontend: `npm test -- ApprovalQueue` (in `frontend/`) |
| **Full suite command** | Backend: `npm test` (in `backend/`); Frontend: `npm test` (in `frontend/`); then `npm run build` both |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- approval` or `npm test -- pawn-ticket` (targeted spec)
- **After every plan wave:** Run `npm test` in backend + frontend
- **Before `/gsd-verify-work`:** Full suite must be green (backend + frontend)
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 0 | RBAC-03 | T-08-02 | appraiseTicket creates ApprovalRecord(APPRAISAL, PENDING, payload); ticket stays PENDING_APPROVAL; loanAmount NOT written | unit | `npm test -- approval` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 0 | RBAC-04 | T-08-03 | redeemTicket with amountPaid > threshold creates REDEMPTION record and returns early; ≤ threshold runs direct release | unit | `npm test -- approval` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 0 | RBAC-06 | T-08-04 | decide writes decidedById/decidedAt/decisionComment/status for approve AND reject | unit | `npm test -- approval` | ❌ W0 | ⬜ pending |
| 08-02-01 | 01 | 1 | RBAC-05 | T-08-01 | GET /approval-queue returns pending records across both types, permission-gated | unit | `npm test -- approval` | ❌ W0 | ⬜ pending |
| 08-02-02 | 01 | 1 | RBAC-03/04 | — | state-machine transition specs cover PENDING_APPROVAL→RECEIVED and ADMIN roles | unit | `npm test -- state-machine` | ✅ edit | ⬜ pending |
| 08-02-03 | 01 | 1 | — | — | permissions-catalog.spec.ts updated with approval.controller sites + counts | unit | `npm test -- permissions-catalog` | ✅ edit | ⬜ pending |
| 08-03-01 | 01 | 2 | RBAC-05 | T-08-01 | ApprovalQueue page renders tabs, calls GET /approval-queue, comment-required-on-reject | integration | `npm test -- ApprovalQueue` (frontend) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/approval/approval.service.spec.ts` — covers RBAC-03/04/06 (record creation, threshold gate, decision persistence)
- [ ] `backend/src/approval/approval.controller.spec.ts` — covers RBAC-05 endpoint surface + permission metadata
- [ ] `frontend/src/components/__tests__/ApprovalQueue.test.tsx` — covers RBAC-05 UI (tabs, approve/reject flow, comment-required-on-reject)
- [ ] Update `backend/src/common/permissions/permissions-catalog.spec.ts` — extend MATRIX + adjust site count for the new controller
- [ ] Update/add `state-machine` transition specs for `PENDING_APPROVAL->RECEIVED` and ADMIN role additions

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Unified queue UX polish (Gilded Reserve theme, tab counts, empty/error states) | RBAC-05 | Visual design contract — automated tests cover data flow, not visual fidelity | Run `npm run dev` in frontend, log in as OWNER with `approval.view_queue`, open `/approval-queue`, verify tabs/empty/error states against 08-UI-SPEC.md |
| ContractViewer sign → disbursement handoff after appraisal approve | RBAC-03 | Depends on live interactive signing flow | Approve an appraisal from the queue; verify contract opens for signing and disbursement completes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
