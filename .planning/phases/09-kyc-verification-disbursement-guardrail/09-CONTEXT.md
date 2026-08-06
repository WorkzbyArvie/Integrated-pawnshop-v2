# Phase 9: KYC Verification & Disbursement Guardrail - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Pawnshop CUSTOMER KYC (not just auction bidders) becomes a first-class, tenant-scoped
verification flow, and the loan pipeline enforces it. Staff capture a customer's ID
details at the counter into the dormant `CustomerKyc` model; OWNER/MANAGER review and
set VERIFIED/REJECTED from a new tenant-scoped review screen; pawn-ticket creation,
approval, and loan disbursement are hard-blocked until the customer is VERIFIED. KYC
document storage (RLS + private bucket) stops being publicly readable.

This phase delivers:
- KYC-01: Customer record carries KYC status (`Customer.kycStatus`) linked to a KYC record (`CustomerKyc`) — schema already exists from the Phase 7 baseline, this phase activates it.
- KYC-02: OWNER/MANAGER review client KYC submissions and set VERIFIED/REJECTED (new client-KYC review screen).
- KYC-03: Pawn ticket creation and approval require the client's KYC status to be VERIFIED.
- KYC-04: Loan disbursement is blocked when the client's KYC status is not VERIFIED.
- KYC-05: KYC document storage is secured — RLS on `bidder_kyc`, `kyc-documents` bucket no longer public-read; only owning tenant/super-admin can access.
- In-scope fix: National ID validation corrected to 12 digits (PH PhilSys standard), greening the currently-deferred `kyc-validation.spec.ts`.

Out of scope: auction bidder self-serve KYC redesign (existing `/auth/kyc/*` flow stays as-is),
self-service customer KYC from the mobile app (deferred future requirement), KYC analytics dashboard.

</domain>

<decisions>
## Implementation Decisions

### Customer KYC Capture (KYC-01)
- **D-01:** Customer KYC is captured staff-assisted in-store. A new tenant-scoped endpoint in the `backend/src/kyc/` module upserts a `CustomerKyc` row from counter data (fullName, contactNumber, address, idType, idNumber, idFrontUrl, idBackUrl?, selfieUrl?, verificationData?) and sets status to `PENDING`.
- **D-02:** `Customer.kycStatus` is the denormalized source of truth read by all gates (cheap, no join). `CustomerKyc.status` mirrors it. Every write path (upsert submit, review approve/reject) updates BOTH columns in one transaction.
- **D-03:** Self-serve customer KYC submission is NOT built this phase (pawn walk-ins have no account; `CreatePawnTicketDto` carries name/contact and `resolveCustomerId` find-or-creates the customer). Self-serve remains a deferred future requirement.

### Review Surface & Permissions (KYC-02)
- **D-04:** New `backend/src/kyc/` module (directory already holds `kyc-validation.ts`). Tenant-scoped endpoints: `GET /kyc/customers` (pending/all, scoped to caller's pawnshop) gated by `kyc.view`; `PATCH /kyc/customers/:id/review` (decision `VERIFIED|REJECTED` + optional `rejectionReason`) gated by `kyc.verify`. Tenant scoping follows the Phase 8 approval-module pattern (callerPawnshopId from the request user).
- **D-05:** Existing SUPER_ADMIN-only bidder endpoints (`GET /auth/kyc/pending`, `GET /auth/kyc/all`, `PATCH /auth/kyc/:id/review` in app.controller.ts) are untouched — auction-bidder domain stays separate.
- **D-06:** `kyc.view` + `kyc.verify` are currently granted to OWNER (permissions.const.ts:72-73) and ADMIN (:88-89) only. Add BOTH to MANAGER to satisfy the KYC-02 OWNER/MANAGER wording (MANAGER block at :91-113).
- **D-07:** New `frontend/src/components/CustomerKycReview.tsx` reusing `BidderKycReview.tsx` styling/patterns (image links, approve/reject with reason), wired into the admin side nav.

### Gate Placement & Strictness (KYC-03 / KYC-04)
- **D-08:** Hard-block (409 conflict with a clear message) at all three gates. No soft `PENDING_KYC` lifecycle states, no exemptions.
- **D-09:** Gate anchors: `pawnTicketService.createTicket` (and the mobile ticket-creation path `POST /tickets/mobile` in app.controller.ts:313), `approveWithContract` (both `POST /pawn-tickets/:id/manager-approve` and `/pawn-tickets/:id/approve`), and `loanService.disburseLoan` (`POST /loans/:loanId/disburse`, loan.controller.ts:245). Each resolves the ticket/loan → `customerId` → `Customer.kycStatus` and rejects unless `VERIFIED`.
- **D-10:** Enforcement order matters: creating an unverified customer's ticket is impossible, so the approve/disburse gates are defense-in-depth for the Phase 8 PENDING_APPROVAL→OFFER_MADE→disburse chain rather than the primary control.
- **D-11:** Loan application creation is NOT gated — only disbursement (KYC-04 verbatim). A loan can be created/approved but cannot be disbursed until the customer is VERIFIED.

### KYC Storage Security (KYC-05)
- **D-12:** Enable RLS on `bidder_kyc` with three tiers: (a) own-row read for the bidder (`auth.uid() = profile_id`), (b) tenant-staff read via a policy join through staff pawnshopId, (c) service-role bypass for super-admin. `bidder_kyc` has no `pawnshopId` column — the tenant-staff tier uses a join, no schema change.
- **D-13:** Flip the Supabase `kyc-documents` storage bucket from public-read to private. Document rendering in `BidderKycReview.tsx` (public `<a href>` links, lines ~185-193) and the new `CustomerKycReview.tsx` switches to signed URLs (parse stored object path → `supabase.storage.from('kyc-documents').createSignedUrl(...)`).
- **D-14:** Deliverables are migration SQL (to run against Supabase — dev DB historically unreachable, `getaddrinfo ENOTFOUND`) plus mocked Prisma specs. No live-DB test dependency.

### the agent's Discretion
- Exact kyc-module endpoint paths/DTO shapes and the upsert/review service signatures — follow the Phase 8 approval-module conventions.
- Signed-URL helper implementation (path parsing from stored public URLs, TTL).
- Demo seed data: add a few VERIFIED customers with `CustomerKyc` rows so the post-gate demo flow works end-to-end (existing seeds default to NOT_SUBMITTED and would otherwise be hard-blocked).
- RLS policy function shape for the tenant-staff join.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope & Requirements
- `.planning/ROADMAP.md` § "Phase 9: KYC Verification & Disbursement Guardrail" — Goal, success criteria, dependency on Phase 8.
- `.planning/REQUIREMENTS.md` § KYC-01..KYC-05 (lines 49-55) — requirement wording; also Future requirements (§ "Future Requirements") for what stays deferred.
- `.planning/PROJECT.md` — project context and constraints.
- `.planning/roadmap/thesis-defense-revisions.md` — panel rationale for compliance/traceability.

### Schema (Phase 7 baseline — already migrated)
- `backend/prisma/schema.prisma` § `Customer` model (line 46) — `kycStatus` (line 53), `customerKyc` relation (line 64), `tickets`/`receipts` relations.
- `backend/prisma/schema.prisma` § `CustomerKyc` model (line 1885) — dormant, to be activated; unique `customerId`, `pawnshopId`, `status`, ID-detail fields, review fields (`reviewedBy`/`reviewedAt`/`rejectionReason`), index `[pawnshopId, status]`.
- `backend/prisma/schema.prisma` § `KycStatus` enum (line 884: NOT_SUBMITTED/PENDING/VERIFIED/REJECTED) and § `KycIdType` enum (line 892).
- `backend/prisma/schema.prisma` § `BidderKyc` model (line 905) — auction-bidder KYC, keyed to Profile, NO tenant key (drives the RLS join decision).
- `backend/prisma/schema.prisma` § `Ticket` model (line 265) — `customerId` REQUIRED (line 268), so every ticket resolves to a Customer.

### Existing KYC Flow (bidder-only today)
- `backend/src/kyc/kyc-validation.ts` — reusable validators (name, DOB 18+, PH phone, ID number, selfie timestamp). **BUG:** line 130 enforces 16-digit National ID; PH PhilSys ID is 12 digits — fix and align spec.
- `backend/src/kyc/kyc-validation.spec.ts` — currently 2 failing tests (the deferred set) asserting 12-digit National ID.
- `backend/src/app.controller.ts` § KYC ENDPOINTS (line 247) — `GET /auth/kyc/status` (:248), `POST /auth/kyc/submit` (:254), `GET /auth/kyc/pending` (:270), `GET /auth/kyc/all` (:279), `PATCH /auth/kyc/:id/review` (:288) — all SUPER_ADMIN-only, all `BidderKyc`.
- `backend/src/app.service.ts` — `getKycStatus` (:1962), `submitKyc` (:1985), `listPendingKyc` (:2157), `reviewKyc` (:2180) — `BidderKyc` implementations to reference (NOT to modify).
- `frontend/src/components/BidderKycReview.tsx` — bidder review UI; public doc links (lines ~185-193) that must flip to signed URLs.

### Permissions & RBAC (Phase 7)
- `backend/src/common/permissions/permissions.const.ts` — `kyc.view`/`kyc.verify` defs (:31-32), grants OWNER (:72-73) + ADMIN (:88-89); **add MANAGER** (:91-113).
- `backend/src/common/guards/rbac.guard.ts` — staffType-aware `@RequiresPermission` guard.
- `backend/src/common/decorators/requires-permission.decorator.ts` — permission decorator.

### Gate Anchors & Phase 8 Approval Shape
- `backend/src/loan/pawn-ticket.service.ts` — `createTicket` (:29, `resolveCustomerId` :30-33), `approveWithContract`, `appraiseTicket` (:364), `redeemTicket` (:441).
- `backend/src/loan/pawn-ticket.controller.ts` — `POST pawn-tickets` (:20), `POST :id/manager-approve` (:59), `POST :id/approve` (:108), `POST :id/appraise` (:124).
- `backend/src/loan/loan.controller.ts` § DISBURSEMENT ENDPOINTS (line 239) — `POST :loanId/disburse` (:245) → `loanService.disburseLoan`.
- `backend/src/app.controller.ts` § MOBILE PAWN TICKET (line 312) — `POST /tickets/mobile` (:313) — alternate ticket-creation path that must also gate on KYC.
- `.planning/phases/08-approval-workflows-unified-approval-queue/08-CONTEXT.md` — Phase 8 PENDING_APPROVAL chokepoint shape the KYC approve gate rides on.
- `backend/src/approval/*` — Phase 8 approval module: the tenant-scoping (callerPawnshopId) and module-structure conventions to mirror.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CustomerKyc` Prisma model + `Customer.kycStatus` — exist, dormant; activation is data-flow work, not migration work.
- `kyc-validation.ts` validators — directly reusable for the customer KYC upsert DTO (name, DOB 18+, PH phone, ID number rules).
- `BidderKycReview.tsx` — review UI styling/pattern (Swal confirms, image links, apiClient) to clone into `CustomerKycReview.tsx`.
- `backend/src/approval/*` — tenant-scoped service pattern (callerPawnshopId from request user) + module layout for the new kyc module.
- `kyc.view` / `kyc.verify` permissions — already seeded; only MANAGER grant missing.
- Phase 8 approval module's `GetRoot`-style lessons and ValidationPipe behavior (`main.ts:364-369` whitelist strips unknown query params) — name DTO fields exactly.

### Established Patterns
- Backend-first: module (controller → service → DTO), NestJS convention (AGENTS.md "Coding Conventions").
- Tenant isolation via request user `pawnshopId`; RBAC via `@RequiresPermission`.
- No comments in source unless asked.
- Mocked-Prisma specs (no live-DB dependency); migration SQL as the deliverable when the dev DB is unreachable.

### Integration Points
- `pawnTicketService.createTicket` / `approveWithContract` / `loanService.disburseLoan` — three hard-gate anchors (plus `POST /tickets/mobile`).
- New `backend/src/kyc/` module: upsert + list + review endpoints; must keep `Customer.kycStatus` and `CustomerKyc.status` in sync.
- Frontend admin nav + route for `CustomerKycReview.tsx`; KYC status surfaced in `SalesPos.tsx` so staff know when capture is needed.
- Supabase: RLS migration on `bidder_kyc`, storage bucket policy flip, signed-URL rendering in both review components.

</code_context>

<specifics>
## Specific Ideas

No specific references — decisions captured above are sufficient. Follow the Phase 8 approval-module conventions for the kyc module, and the existing Gilded Reserve dark theme for the review UI.

</specifics>

<deferred>
## Deferred Ideas

- Self-service customer KYC submission from the mobile app — future requirement (REQUIREMENTS.md Future list).
- Admin KYC analytics / verification-rate dashboard — future requirement.
- Super-admin global customer-KYC review view — deliberately skipped this phase to keep the surface tenant-scoped; bidder KYC already has a super-admin view.

None else — discussion stayed within phase scope.

</deferred>

---

*Phase: 9-KYC Verification & Disbursement Guardrail*
*Context gathered: 2026-08-06*
