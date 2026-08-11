# Phase 10: Onboarding Compliance Gate - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous, batch-accepted proposals)

<domain>
## Phase Boundary

Free Trial cannot start until required regulatory documents are submitted and reviewed;
admin review requires view-before-approve (`hasViewed`), and any REJECTED document drives
an aggregated REJECTED/ACTION_REQUIRED status on owner and client dashboards.

Existing infrastructure (already implemented pre-phase):
- `PawnshopDocument` model with `hasViewed`/`viewedAt`/`viewedBy` (Phase 7 schema baseline) + `ComplianceDocType`/`ComplianceDocStatus` enums.
- Client registration flow: `POST client-registrations/me` (create), `POST :requestId/documents` (upload), `GET :requestId/documents`, `GET :requestId/documents/admin` (SUPER_ADMIN), `POST :requestId/documents/:documentId/review` (SUPER_ADMIN sets VERIFIED/REJECTED), `POST :requestId/submit`, `POST :requestId/review` (SUPER_ADMIN APPROVED/REJECTED/CONTACTED → activates trial/creates pawnshop).
- `configureOnboarding` (`POST onboarding/configure`) exists.
- Frontend: `PendingAccessDashboard.tsx` (client/owner registration + doc upload), `TrialRequestsPanel.tsx` (super-admin review), `OwnerComplianceDashboard.tsx` (owner compliance for ACTIVE pawnshop via separate `/compliance` module).

This phase delivers:
- ONB-01: server-side docs-before-trial gate on the approval path (not just UI).
- ONB-02: view-before-approve (`hasViewed`) persisted server-side; Approve gated on it.
- ONB-03: any REJECTED doc → aggregated REJECTED/ACTION_REQUIRED onboarding status via API + owner dashboard.
- ONB-04: client compliance dashboard reflects real-time per-document status end-to-end.

Out of scope: subscription billing overhaul; changing the separate `/compliance` score system; tenant-scoped OWNER/ADMIN review of onboarding docs (stays platform-side); mobile parity.

</domain>

<decisions>
## Implementation Decisions

### Server-Side Trial Gate (ONB-01)
- **D-01:** The docs-before-trial gate lives inside `reviewClientRegistrationRequest` — when the SUPER_ADMIN approves a registration, the service first verifies every required document exists with status at least `UPLOADED`; otherwise APPROVED is rejected with a clear 400/409 error. No separate activate-trial endpoint.
- **D-02:** Required document set = the 7 types currently allowed for upload: `DTI_REGISTRATION`, `MAYORS_PERMIT`, `BIR_COR`, `BSP_LICENSE`, `AMLC_REGISTRATION`, `GOVERNMENT_ID`, `PROOF_OF_ADDRESS`.
- **D-03:** Minimum "submitted" status = `UPLOADED` (i.e. status in UPLOADED/UNDER_REVIEW/VERIFIED). REJECTED/EXPIRED do not satisfy the gate.
- **D-04:** Trial activation behavior unchanged once the gate passes — APPROVED auto-activates the trial/creates the pawnshop as today.

### View-Before-Approve Review (ONB-02)
- **D-05:** New endpoint `POST client-registrations/:requestId/documents/:documentId/view` (SUPER_ADMIN, matching existing role guard) sets `hasViewed=true`, `viewedAt=NOW()`, `viewedBy=actor`.
- **D-06:** `reviewRegistrationDocument` rejects an APPROVED decision (400/409) unless the document's `hasViewed` is already `true`. REJECTED decisions are allowed without viewing (viewing is not a precondition for rejecting).
- **D-07:** Reviewer remains SUPER_ADMIN (existing role checks preserved); the existing `onboarding.review_documents`/`onboarding.approve` permission constants are wired as `@RequiresPermission` metadata on the admin list/review endpoints for catalog consistency (SUPER_ADMIN bypasses anyway).
- **D-08:** `TrialRequestsPanel.tsx` review modal: document must be opened in the viewer before the Approve button becomes enabled (disabled until viewed state is persisted); Reject stays available.

### REJECTED Aggregation & Dashboards (ONB-03 / ONB-04)
- **D-09:** New endpoint `GET client-registrations/me/status` returns `{ overall, documents, submissionStatus }` where `overall` ∈ `INCOMPLETE | PENDING_REVIEW | ACTION_REQUIRED | APPROVED` — any doc `REJECTED` → `ACTION_REQUIRED`; all required VERIFIED → `APPROVED`; else `PENDING_REVIEW` (or `INCOMPLETE` if a required type is missing entirely).
- **D-10:** Aggregation uses the single REJECTED→ACTION_REQUIRED value (not a separate REJECTED overall state), matching the success-criteria wording.
- **D-11:** Owner surface: `PendingAccessDashboard` shows an overall status banner (refreshed after upload/submit/poll) and per-document status chips with rejection reasons. `OwnerComplianceDashboard` (active pawnshop) is out of scope for the aggregate — it already has its own score surface.
- **D-12:** Real-time = re-fetch on relevant actions + existing interval/refresh patterns (no Supabase Realtime subscription).

### the agent's Discretion
- Exact DTO shapes and route naming for the new view/status endpoints (follow existing tenant-governance conventions, raw SQL style used in that module).
- Whether `GET .../me/status` reuses the docs query or aggregates in SQL.
- Error message wording for the gate/review blocks.
- Spec coverage: which methods get mocked-Prisma specs.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope & Requirements
- `.planning/ROADMAP.md` § "Phase 10: Onboarding Compliance Gate" — goal + success criteria.
- `.planning/REQUIREMENTS.md` § ONB-01..ONB-04 (lines 27-32) — requirement wording.
- `.planning/PROJECT.md` — project context and constraints.

### Schema
- `backend/prisma/schema.prisma` § `PawnshopDocument` (line 1693) — `hasViewed`/`viewedAt`/`viewedBy` (lines 1707-1709), `ComplianceDocType` (1670), `ComplianceDocStatus` (1684).
- `backend/prisma/schema.prisma` § `ClientRegistrationRequest` (line 1736).

### Backend
- `backend/src/tenant-governance/tenant-governance.service.ts` — `reviewClientRegistrationRequest` (:1401, APPROVED branch activates trial), `uploadRegistrationDocument` (:1846, allowed types at :1874), `listRegistrationDocuments` (:1921), `adminListRegistrationDocuments` (:1951), `reviewRegistrationDocument` (:1981, currently SUPER_ADMIN only, does NOT require hasViewed).
- `backend/src/tenant-governance/tenant-governance.controller.ts` — routes at :153/:158/:167/:175/:189/:204/:218/:227/:236/:250/:260/:269/:278.
- `backend/src/tenant-governance/dto/review-client-registration.dto.ts`, `configure-onboarding.dto.ts`.
- `backend/src/common/permissions/permissions.const.ts` — `onboarding.review_documents`/`onboarding.approve` defined (:24-25), currently NOT granted to any role block.

### Frontend
- `frontend/src/components/PendingAccessDashboard.tsx` — client/owner registration + doc upload UI (uses `/tenant-governance/client-registrations/me` + docs endpoints).
- `frontend/src/pages/admin/TrialRequestsPanel.tsx` — super-admin review modal (doc review at :158 via `.../documents/:documentId/review`).
- `frontend/src/pages/admin/OwnerComplianceDashboard.tsx` — owner compliance for active pawnshop (`/compliance/score`) — OUT of scope for the aggregate.

### Conventions
- `.planning/phases/09-kyc-verification-disbursement-guardrail/09-CONTEXT.md` — tenant-scoping, permission metadata, mocked-Prisma spec patterns from Phase 9.
- AGENTS.md — backend-first, no comments, NestJS module layout.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PawnshopDocument.hasViewed` + review columns already in schema — pure data-flow activation.
- Existing raw-SQL tenant-governance service methods to mirror (owner-email scoping, raw queries with `::"ComplianceDocType"` casts).
- `TrialRequestsPanel.tsx` review modal + `PendingAccessDashboard.tsx` upload form — UI to extend, not rebuild.
- Permission constants already defined (need grant + decorator wiring).

### Established Patterns
- Tenant governance module uses raw SQL + role string checks (`assertRole`) rather than `@RequiresPermission`.
- Frontend uses `api` client (`frontend/src/lib/apiClient.ts`) + Supabase storage for uploads.
- Gilded Reserve dark theme (gold `#C9A05C` on near-black).

### Integration Points
- `reviewClientRegistrationRequest` APPROVED branch — the single chokepoint for the ONB-01 gate.
- `reviewRegistrationDocument` + new view endpoint — ONB-02.
- `GET client-registrations/me` (App.tsx:716) — aggregation surface; new `/me/status` endpoint.
- `PendingAccessDashboard.tsx` — overall status banner + per-doc chips.

</code_context>

<specifics>
## Specific Ideas

No specific references beyond the accepted grey areas. Follow existing tenant-governance raw-SQL conventions and Gilded Reserve theme.

</specifics>

<deferred>
## Deferred Ideas

- Tenant-scoped OWNER/ADMIN self-review of onboarding docs (kept platform-side per D-07).
- Unifying the separate `/compliance` score system with registration-request docs.
- Configurable required-doc set via `configureOnboarding` (fixed 7-set this phase).

</deferred>

---

*Phase: 10-Onboarding Compliance Gate*
*Context gathered: 2026-08-11*
