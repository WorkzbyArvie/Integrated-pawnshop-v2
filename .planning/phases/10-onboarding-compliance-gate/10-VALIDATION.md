---
phase: 10
slug: onboarding-compliance-gate
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-11
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (NestJS backend specs) |
| **Config file** | backend/package.json `"test"` / `"test:watch"` scripts |
| **Quick run command** | `npm test -- --testPathPattern="tenant-governance" --silent` (backend dir) |
| **Full suite command** | `npm test -- --silent` (backend dir) |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="tenant-governance|permissions" --silent`
- **After every plan wave:** Run `npm test -- --silent` (backend) + `npx tsc --noEmit` (backend) + frontend typecheck
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | ONB-01 | T-10-01 / — | trial approval blocked unless all 7 required docs present | unit | `npm test -- --testPathPattern="tenant-governance"` | ✅ tenant-governance.service.spec.ts | ⬜ pending |
| 10-02-01 | 02 | 2 | ONB-02 | T-10-02 | APPROVED rejected unless hasViewed=true | unit | `npm test -- --testPathPattern="tenant-governance"` | ✅ | ⬜ pending |
| 10-02-02 | 02 | 2 | ONB-02 | — | view endpoint persists hasViewed/viewedAt/viewedBy | unit | `npm test -- --testPathPattern="tenant-governance"` | ✅ | ⬜ pending |
| 10-03-01 | 03 | 3 | ONB-03 | — | /me/status aggregates ACTION_REQUIRED on any REJECTED | unit | `npm test -- --testPathPattern="tenant-governance"` | ✅ | ⬜ pending |
| 10-04-01 | 04 | 4 | ONB-03/04 | — | dashboards surface aggregate + per-doc status | e2e/manual | `npm run build` (frontend) | ⬜ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/tenant-governance/tenant-governance.service.spec.ts` — verify existing spec file; add mocked-Prisma spec coverage for the new gate/view/aggregate methods
- [ ] `backend/src/common/permissions/permissions-catalog.spec.ts` — coordinated edits for the new `@RequiresPermission` decorated sites (site count 69 + new view endpoint, MATRIX rows for admin list/review)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TrialRequestsPanel approve-button enable only after doc opened | ONB-02 | Browser interaction + persistence round-trip | Open review modal, observe Approve disabled until viewer opened, approve, confirm hasViewed persisted via admin list |
| PendingAccessDashboard ACTION_REQUIRED banner | ONB-03 | UI rendering with live API | Reject a doc as super-admin, refresh owner dashboard, confirm banner + rejection reason |
| Server-side gate end-to-end | ONB-01 | Full registration→approve flow | Attempt APPROVED with a missing required doc → expect 400/409; upload all 7 → approve succeeds |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
