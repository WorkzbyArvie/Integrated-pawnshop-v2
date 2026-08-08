---
phase: 09
slug: kyc-verification-disbursement-guardrail
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-08
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x + ts-jest (backend) |
| **Config file** | inline in backend/package.json (`rootDir: src`, `testRegex: .*\.spec\.ts$`) |
| **Quick run command** | `npm test -- kyc-validation` |
| **Full suite command** | `npm test` (backend) |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- kyc-validation` (fast file-level)
- **After every plan wave:** Run `npm test` full backend suite
- **Before `/gsd-verify-work`:** Full suite must be green (mocked-Prisma only; RLS SQL verified manually against Supabase by the user)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | KYC-01 | T-09-06 | CustomerKyc upsert creates PENDING + sets Customer.kycStatus in one transaction | unit | `npm test -- kyc.service` | ❌ Wave 0 | ⬜ pending |
| TBD | 01 | 1 | KYC-01 | — | kyc-validation accepts 12-digit PhilSys PSN | unit | `npm test -- kyc-validation` | ✅ | ⬜ pending |
| TBD | 01 | 1 | KYC-02 | T-09-04 | GET /kyc/customers tenant-scoped; requires kyc.view | unit | `npm test -- kyc.controller` | ❌ Wave 0 | ⬜ pending |
| TBD | 01 | 1 | KYC-02 | T-09-04 | PATCH /kyc/customers/:id/review dual-column VERIFIED/REJECTED; requires kyc.verify | unit | `npm test -- kyc.service` | ❌ Wave 0 | ⬜ pending |
| TBD | 01 | 1 | KYC-02 | — | MANAGER grants kyc.view + kyc.verify | unit | `npm test -- permissions-catalog` | ✅ | ⬜ pending |
| TBD | 01 | 1 | KYC-03 | T-09-05 | createTicket rejects non-VERIFIED with 409 | unit | `npm test -- pawn-ticket.service` | ✅ (extend) | ⬜ pending |
| TBD | 01 | 1 | KYC-03 | T-09-05 | approveWithContract rejects non-VERIFIED with 409 | unit | `npm test -- pawn-ticket.service` | ✅ (extend) | ⬜ pending |
| TBD | 01 | 1 | KYC-03 | T-09-05 | Mobile ticket path gates on KYC | unit | `npm test -- app.service` | ✅ (extend) | ⬜ pending |
| TBD | 01 | 1 | KYC-04 | T-09-05 | disburseLoan rejects non-VERIFIED with 409 | unit | `npm test -- loan.service` | ✅ (extend) | ⬜ pending |
| TBD | 01 | 1 | KYC-05 | T-09-01 | Signed-URL helper parses stored public URL to path | unit | `cd frontend && npx vitest run kycDocs` | ❌ 09-03 Task 1 | ⬜ pending |
| TBD | 01 | 1 | KYC-05 | T-09-01/02 | RLS SQL + bucket flip (manual Supabase run) | manual | manual | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/kyc/kyc.service.spec.ts` — KYC-01 upsert + KYC-02 review dual-column sync + tenant scoping
- [ ] `backend/src/kyc/kyc.controller.spec.ts` — route + `@RequiresPermission` decorators (KYC-02)
- [ ] `backend/src/loan/pawn-ticket.service.spec.ts` — extend for KYC-03 gate (create + approve)
- [ ] `backend/src/loan/loan.service.spec.ts` — extend for KYC-04 disburse gate
- [ ] `backend/src/app.service.spec.ts` — extend for mobile ticket path gate
- [ ] `backend/src/common/permissions/permissions-catalog.spec.ts` — update MANAGER tuple
- [ ] `backend/src/kyc/kyc-validation.spec.ts` — 16 → 12 digit fix greens existing 2 RED tests

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `kyc-documents` bucket no longer public-read | KYC-05 | Live Supabase state — cannot be asserted in mocked-Prisma jest | Apply RLS SQL + `to authenticated` storage policy to real project; verify anonymous GET on a stored object 403s |
| `bidder_kyc` RLS 3-tier policies | KYC-05 | Live Supabase state | Apply `ALTER TABLE bidder_kyc ENABLE ROW LEVEL SECURITY` + policies; verify own-row / tenant-staff / service-role reads |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}
