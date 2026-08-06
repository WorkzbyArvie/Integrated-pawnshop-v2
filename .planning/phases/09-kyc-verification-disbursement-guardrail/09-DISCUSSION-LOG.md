# Phase 9: KYC Verification & Disbursement Guardrail - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-06
**Phase:** 9-kyc-verification-disbursement-guardrail
**Areas discussed:** Customer KYC capture, Review surface & permissions, Gate strictness, KYC document security

---

## Customer KYC capture

| Option | Description | Selected |
|--------|-------------|----------|
| Staff-assisted capture (Recommended) | New tenant-scoped endpoint upserts CustomerKyc from counter data; matches walk-in reality (ticket creation resolves customers by name/contact); Customer.kycStatus = gate source of truth, synced with CustomerKyc.status; self-serve stays deferred | ✓ |
| Self-serve like bidders | Reuse /auth/kyc/submit pattern keyed to Customer; only works for customers with accounts; most pawn walk-ins have none | |
| Hybrid | Staff capture for walk-ins + self-serve for account holders; broader surface, more testing | |

**User's choice:** Staff-assisted capture
**Notes:** None — accepted the recommendation as presented.

---

## Review surface & permissions

| Option | Description | Selected |
|--------|-------------|----------|
| New kyc module + review UI (Recommended) | Tenant-scoped GET /kyc/customers + PATCH review gated by kyc.view/kyc.verify; new CustomerKycReview.tsx; bidder endpoints untouched; add kyc.view+verify to MANAGER for KYC-02 | ✓ |
| Generalize /auth/kyc | Make endpoints tenant-aware and dual-record; couples bidder (super-admin) and customer (tenant) flows | |
| New page, no module | Add endpoints to app.controller; faster but couples KYC logic into the app module | |

**User's choice:** New kyc module + review UI
**Notes:** Scout confirmed kyc.view/kyc.verify are OWNER + ADMIN only today (permissions.const.ts:72-73, 88-89); MANAGER grant must be added.

---

## Gate strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-block 3 gates (Recommended) | 409 at createTicket (incl. mobile path), approveWithContract, disburseLoan; no soft states, no exemptions; strong enforcement story for the panel | ✓ |
| Soft PENDING_KYC state | Allow ticket creation into a PENDING_KYC lifecycle state; more states to maintain, weaker enforcement | |
| Disbursement only | Block only disburseLoan; fails KYC-03's explicit ticket-creation + approval requirement | |

**User's choice:** Hard-block 3 gates
**Notes:** Loan application creation NOT gated (KYC-04 is disbursement-only verbatim); approve/disburse gates are defense-in-depth over the primary creation gate.

---

## KYC document security

| Option | Description | Selected |
|--------|-------------|----------|
| RLS + private bucket + signed URLs (Recommended) | Enable RLS on bidder_kyc (own-row + tenant-staff join + service-role), private kyc-documents bucket, signed-URL rendering in both review UIs; SQL migration deliverable (dev DB unreachable) | ✓ |
| RLS only, public bucket | Cheaper but leaves doc URLs publicly enumerable — the exact exposure flagged | |
| Super-admin only | Simplest policy but fails the 'owning tenant' wording of KYC-05 | |

**User's choice:** RLS + private bucket + signed URLs
**Notes:** bidder_kyc has no pawnshopId — tenant-staff tier uses a policy join; no schema change to BidderKyc.

---

## the agent's Discretion

- kyc-module endpoint paths/DTO shapes and service signatures — follow Phase 8 approval-module conventions.
- Signed-URL helper implementation (path parsing, TTL).
- Demo seed data: add VERIFIED customers with CustomerKyc rows so the post-gate demo works.
- RLS policy-function shape for the tenant-staff join.
- In-scope fix folded by the agent: National ID 16→12 digit validation (kyc-validation.ts:130) to green the deferred spec.

## Deferred Ideas

- Self-service customer KYC from mobile app — future requirement.
- Admin KYC analytics/verification-rate dashboard — future requirement.
- Super-admin global customer-KYC review view — skipped this phase; bidder KYC already has a super-admin view.
