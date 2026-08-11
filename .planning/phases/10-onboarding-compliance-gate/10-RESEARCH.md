# Phase 10: Onboarding Compliance Gate - Research

**Researched:** 2026-08-11
**Domain:** Server-side trial gating, doc review state, status aggregation (NestJS + Prisma raw SQL + React)
**Confidence:** HIGH

## Summary

Phase 10 closes the compliance-gate gap: (1) server-side docs-before-trial enforcement inside `reviewClientRegistrationRequest`, (2) view-before-approve (`hasViewed`) persisted server-side and gating the Approve action, (3) REJECTED-document aggregation exposed via a new status API and owner dashboard banner, (4) real-time per-document status end-to-end. The codebase already carries the schema (`PawnshopDocument.hasViewed/viewedAt/viewedBy`), the permission constants (`onboarding.review_documents`/`onboarding.approve`), the upload allow-list (exactly the 7 required types), and both UI surfaces (`TrialRequestsPanel` review modal, `PendingAccessDashboard`). This phase is pure data-flow activation: add the gate check, add the view endpoint, add the aggregation endpoint, and wire the two UI surfaces to them.

**Primary recommendation:** Implement in four sequential slices — ONB-01 gate inside the APPROVED branch of `reviewClientRegistrationRequest` (service-level, raw SQL, no schema change) → ONB-02 view endpoint + `hasViewed` check in `reviewRegistrationDocument` → ONB-03 `GET client-registrations/me/status` aggregation + PendingAccessDashboard banner → ONB-04 UI wiring and spec coverage. **Critical: D-07's assumption that "SUPER_ADMIN bypasses anyway" is FALSE per `rbac.guard.ts:119-128` — wiring `@RequiresPermission('onboarding.*')` without adding those permissions to `SUPER_ADMIN_PERMISSIONS` (rbac.guard.ts:25-30) will 403 the only role allowed to review.**

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Server-Side Trial Gate (ONB-01)
- **D-01:** The docs-before-trial gate lives inside `reviewClientRegistrationRequest` — when the SUPER_ADMIN approves a registration, the service first verifies every required document exists with status at least `UPLOADED`; otherwise APPROVED is rejected with a clear 400/409 error. No separate activate-trial endpoint.
- **D-02:** Required document set = the 7 types currently allowed for upload: `DTI_REGISTRATION`, `MAYORS_PERMIT`, `BIR_COR`, `BSP_LICENSE`, `AMLC_REGISTRATION`, `GOVERNMENT_ID`, `PROOF_OF_ADDRESS`.
- **D-03:** Minimum "submitted" status = `UPLOADED` (i.e. status in UPLOADED/UNDER_REVIEW/VERIFIED). REJECTED/EXPIRED do not satisfy the gate.
- **D-04:** Trial activation behavior unchanged once the gate passes — APPROVED auto-activates the trial/creates the pawnshop as today.

#### View-Before-Approve Review (ONB-02)
- **D-05:** New endpoint `POST client-registrations/:requestId/documents/:documentId/view` (SUPER_ADMIN, matching existing role guard) sets `hasViewed=true`, `viewedAt=NOW()`, `viewedBy=actor`.
- **D-06:** `reviewRegistrationDocument` rejects an APPROVED decision (400/409) unless the document's `hasViewed` is already `true`. REJECTED decisions are allowed without viewing (viewing is not a precondition for rejecting).
- **D-07:** Reviewer remains SUPER_ADMIN (existing role checks preserved); the existing `onboarding.review_documents`/`onboarding.approve` permission constants are wired as `@RequiresPermission` metadata on the admin list/review endpoints for catalog consistency (SUPER_ADMIN bypasses anyway).
- **D-08:** `TrialRequestsPanel.tsx` review modal: document must be opened in the viewer before the Approve button becomes enabled (disabled until viewed state is persisted); Reject stays available.

#### REJECTED Aggregation & Dashboards (ONB-03 / ONB-04)
- **D-09:** New endpoint `GET client-registrations/me/status` returns `{ overall, documents, submissionStatus }` where `overall` ∈ `INCOMPLETE | PENDING_REVIEW | ACTION_REQUIRED | APPROVED` — any doc `REJECTED` → `ACTION_REQUIRED`; all required VERIFIED → `APPROVED`; else `PENDING_REVIEW` (or `INCOMPLETE` if a required type is missing entirely).
- **D-10:** Aggregation uses the single REJECTED→ACTION_REQUIRED value (not a separate REJECTED overall state), matching the success-criteria wording.
- **D-11:** Owner surface: `PendingAccessDashboard` shows an overall status banner (refreshed after upload/submit/poll) and per-document status chips with rejection reasons. `OwnerComplianceDashboard` (active pawnshop) is out of scope for the aggregate — it already has its own score surface.
- **D-12:** Real-time = re-fetch on relevant actions + existing interval/refresh patterns (no Supabase Realtime subscription).

### the agent's Discretion
- Exact DTO shapes and route naming for the new view/status endpoints (follow existing tenant-governance conventions, raw SQL style used in that module).
- Whether `GET .../me/status` reuses the docs query or aggregates in SQL.
- Error message wording for the gate/review blocks.
- Spec coverage: which methods get mocked-Prisma specs.

### Deferred Ideas (OUT OF SCOPE)
- Tenant-scoped OWNER/ADMIN self-review of onboarding docs (kept platform-side per D-07).
- Unifying the separate `/compliance` score system with registration-request docs.
- Configurable required-doc set via `configureOnboarding` (fixed 7-set this phase).
- Subscription billing overhaul; changing the separate `/compliance` score system; mobile parity.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONB-01 | Owner cannot initialize Free Trial until all required regulatory documents are submitted and at least pending review — enforced server-side (approval path), not just UI. | Gate insertion point identified: `reviewClientRegistrationRequest` APPROVED branch at tenant-governance.service.ts:1459 (before `ensureTenantModuleConfigTable` at :1460). Required set = `uploadRegistrationDocument` allow-list (:1874-1877) = D-02's 7 types. Status check per D-03 against `ComplianceDocStatus` enum. |
| ONB-02 | Admin reviews onboarding documents inside the viewer modal; Approve/Reject buttons live in the modal; Approve is disabled until the document is opened/viewed (`hasViewed` state persisted server-side). | `reviewRegistrationDocument` at :1981 currently has NO `hasViewed` check — needs D-06 guard. New view endpoint per D-05. Schema fields already exist (`hasViewed`/`viewedAt`/`viewedBy`, schema.prisma:1707-1709). Modal exists at TrialRequestsPanel.tsx:480-567. |
| ONB-03 | Any document with status REJECTED sets the overall shop onboarding status to REJECTED/ACTION_REQUIRED; aggregated status is exposed via API and reflected in the owner dashboard. | New `GET client-registrations/me/status` per D-09/D-10. Owner-email scoping pattern from `listRegistrationDocuments` (:1921) / `uploadRegistrationDocument` (:1846). Banner surface = `PendingAccessDashboard.tsx`. |
| ONB-04 | Client's Compliance Dashboard reflects real-time document approval status (existing behavior verified end-to-end). | PendingAccessDashboard already polls (`loadRequests`/`loadDocuments`) and renders per-doc chips (:582-590) — wire to new status endpoint + refresh after upload/submit per D-12. `App.tsx:690-737` owner-status flow is the integration anchor. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Docs-before-trial gate (ONB-01) | API / Backend | — | Must be enforced in `reviewClientRegistrationRequest` (service) — UI-only checks were the original defect. Raw SQL matches module convention. |
| View-before-approve state (ONB-02) | API / Backend | Browser / Client | `hasViewed` persisted via new view endpoint; client only disables the button until the persisted state returns true (D-08). Server rejects approve-without-view regardless of UI (D-06). |
| Aggregation endpoint (ONB-03) | API / Backend | — | New `GET client-registrations/me/status` computes `overall` server-side per D-09/D-10. |
| Owner status banner + chips | Browser / Client | API / Backend | `PendingAccessDashboard` renders banner/chips from the status endpoint; refresh per D-12. |
| Permission metadata (D-07) | API / Backend | — | `@RequiresPermission` decorators on admin endpoints; RbacGuard enforces. |
| Trial activation (unchanged) | API / Backend | Database / Storage | Existing APPROVED branch behavior preserved per D-04. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| NestJS (core/common) | 10.x (pinned) | Controller/service/module wiring | Existing monolith; no new framework |
| Prisma Client | 5.22.x (pinned) | Raw SQL access to `client_registration_requests`/`pawnshop_documents` | Module uses `$queryRaw`/`$executeRaw` throughout |
| PostgreSQL | Supabase-managed | Data store | No new deps |
| React 19 | 19.x (pinned) | Dashboard UI | Existing frontend |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| class-validator | 0.14.x (pinned) | DTO validation for new view/status DTOs | New endpoints per module convention |
| jest + ts-jest | 29.x (pinned) | Backend specs (mocked-Prisma pattern) | All new service methods |
| vitest + @testing-library/react | 3.2.4 / 16.3.0 (pinned) | Frontend specs (mirror pattern) | UI changes in TrialRequestsPanel/PendingAccessDashboard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw SQL in tenant-governance service | Prisma ORM queries | Module convention is raw SQL; Prisma mixed usage exists elsewhere but mirroring local style keeps diffs small |
| Prisma query for aggregation | SQL aggregate with `GROUP BY` | D-09 leaves this to discretion; single `$queryRaw` for the 7 types is simplest |

**Installation:** No new packages. All libraries are existing pinned dependencies (`npm install` not required for this phase).

**Version verification:** Verified against repo `package.json` pins + npm registry 2026-08-11 (see Package Legitimacy Audit). Registry latest is NestJS 11.1.29 / Prisma 7.9.1 / React 19.2.8 — the repo deliberately pins older majors; **do not upgrade anything in this phase.**

## Package Legitimacy Audit

> This phase installs **no new packages** — all dependencies are pre-existing pinned installs. The audit below covers the stack packages this phase touches, run through the legitimacy gate for completeness.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @nestjs/core | npm | 9 yrs | 13.6M/wk | github.com/nestjs/nest | OK (seam: SUS recency false-positive) | Approved — existing pin, no install |
| @nestjs/common | npm | 9 yrs | 14.9M/wk | github.com/nestjs/nest | OK (seam: SUS recency false-positive) | Approved — existing pin, no install |
| @prisma/client | npm | 8 yrs | 15.0M/wk | github.com/prisma/prisma | OK (seam: SUS recency false-positive) | Approved — existing pin, no install |
| react | npm | 13 yrs | 163M/wk | github.com/react/react | OK (seam: SUS recency false-positive) | Approved — existing pin, no install |
| jest | npm | 13 yrs | 46.3M/wk | github.com/jestjs/jest | OK | Approved — existing pin, no install |
| class-validator | npm | 8 yrs | 11.1M/wk | github.com/typestack/class-validator | OK | Approved — existing pin, no install |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none actionable — the seam's "too-new" flag fired on recent publish dates of mega-packages with official repos and >10M weekly downloads (a recency-heuristic false positive); all are pre-existing pinned dependencies, no install step occurs this phase, so no checkpoint gates are required.
**Postinstall scan:** none of the touched packages declare a `postinstall` script referencing network/filesystem side effects (verified via npm view `scripts.postinstall`).

## Architecture Patterns

### System Architecture Diagram

```
                        OWNER (browser)
                              │
   PendingAccessDashboard.tsx │
        ┌─────────────────────┼─────────────────────────────┐
        │ upload docs         │ submit request              │ GET /client-registrations/me/status (NEW)
        ▼                     ▼                             ▼
POST :requestId/documents  POST :requestId/submit   tenant-governance.service
        │                     │      (DRAFT→PENDING)        getMyRegistrationStatus() [NEW D-09]
        ▼                     ▼                             │
pawnshop_documents       client_registration_requests       │ aggregate per D-10:
 (UPLOADED, REJECTED,    status=PENDING                       INCOMPLETE | PENDING_REVIEW
  VERIFIED...)                │                              ACTION_REQUIRED | APPROVED
                              │ POST :requestId/review (SUPER_ADMIN, platform.manage)  ◄── ONB-01 GATE
                              ▼
               reviewClientRegistrationRequest (:1401)
                              │ APPROVED branch (:1459)
                              ▼
        [NEW GATE D-01/D-02/D-03] verify 7 required types exist w/ status ∈
              UPLOADED/UNDER_REVIEW/VERIFIED ──✗─► 400/409 (trial NOT activated)
                              │ ✓
                              ▼
        ensureTenantModuleConfigTable → pawnshop create → owner profile → trial
        (existing behavior, unchanged per D-04)

        SUPER_ADMIN (browser)                     OWNER (browser)
   TrialRequestsPanel.tsx                         PendingAccessDashboard.tsx
        │ GET :requestId/documents/admin                │ GET /client-registrations/me/status (NEW)
        │ POST :requestId/documents/:id/view (NEW D-05) │ banner: overall ∈ INCOMPLETE|PENDING_REVIEW|
        │   → hasViewed=true, viewedAt, viewedBy        │         ACTION_REQUIRED|APPROVED (D-11)
        │ POST :requestId/documents/:id/review          │ per-doc chips + rejection reasons (D-11)
        │   [NEW D-06: APPROVED rejected 400/409        │
        │    unless hasViewed]                          │ refresh: upload/submit/poll (D-12)
        ▼                                               ▼
   pawnshop_documents.status = VERIFIED/REJECTED   client_registration_requests
```

### Recommended Project Structure

No new files beyond the existing module layout (changes are additive to existing files):

```
backend/src/tenant-governance/
├── tenant-governance.service.ts      # EDIT: gate in reviewClientRegistrationRequest (:1459),
│                                     #       hasViewed guard in reviewRegistrationDocument (:1981),
│                                     #       NEW markRegistrationDocumentViewed(), getMyRegistrationStatus()
├── tenant-governance.controller.ts   # EDIT: NEW POST :requestId/documents/:documentId/view,
│                                     #       NEW GET client-registrations/me/status,
│                                     #       D-07 permission decorator updates
├── dto/
│   ├── mark-document-viewed.dto.ts   # NEW (likely empty or {}) — or reuse existing pattern
│   └── (status endpoint: query-param-free, response-typed inline)
├── tenant-governance.service.spec.ts # EDIT or NEW sibling spec: gate, view, status specs (mocked-Prisma)
frontend/src/
├── pages/admin/TrialRequestsPanel.tsx   # EDIT: hasViewed fields in RegDocument type, view-then-approve modal (D-08)
├── components/PendingAccessDashboard.tsx# EDIT: overall banner + refresh (D-11, D-12)
└── components/__tests__/                # NEW mirror specs if component logic extracted
backend/src/common/guards/rbac.guard.ts  # EDIT: add onboarding.* to SUPER_ADMIN_PERMISSIONS (CRITICAL, see Pitfall 1)
backend/src/common/permissions/permissions-catalog.spec.ts  # EDIT: 69→70/71 sites, MATRIX entries (Pitfall 2)
```

### Pattern 1: Raw SQL with enum casts (module convention)
**What:** All tenant-governance data access uses `this.prisma.$queryRaw` with PostgreSQL enum casts (`::"ComplianceDocType"`, `::"ComplianceDocStatus"`) and UUID casts (`${id}::uuid`).
**When to use:** Every new query in this module — gate check, view update, status aggregation.
**Example (verified from tenant-governance.service.ts):**
```typescript
// Source: tenant-governance.service.ts:1993-2001 (existing reviewRegistrationDocument lookup)
const docRows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
  SELECT id, status FROM public.pawnshop_documents
  WHERE id = ${documentId}::uuid AND registration_request_id = ${requestId}::uuid
  LIMIT 1
`;
```
Gate-check sketch (ONB-01, mirroring :1882-1888 style):
```typescript
const missing = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
  SELECT t.doc_type FROM (
    SELECT unnest(ARRAY['DTI_REGISTRATION','MAYORS_PERMIT','BIR_COR','BSP_LICENSE',
                        'AMLC_REGISTRATION','GOVERNMENT_ID','PROOF_OF_ADDRESS']::"ComplianceDocType"[]) AS doc_type
  ) t
  LEFT JOIN public.pawnshop_documents d
    ON d.registration_request_id = ${requestId}::uuid
   AND d.document_type = t.doc_type
   AND d.status IN ('UPLOADED','UNDER_REVIEW','VERIFIED')
  WHERE d.id IS NULL
`;
// if (missing.length > 0) throw new BadRequestException(...)
```

### Pattern 2: Owner-email scoping (module convention)
**What:** Owner-facing endpoints resolve the actor profile, derive `ownerEmail`, and scope the raw query by `lower(owner_email) = lower(${ownerEmail})`.
**When to use:** The new `GET client-registrations/me/status` (D-09) and the view endpoint's request-ownership validation.
**Example (verified from tenant-governance.service.ts:1857-1865):**
```typescript
const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
  SELECT id, owner_email, status FROM public.client_registration_requests
  WHERE id = ${requestId}::uuid AND lower(owner_email) = lower(${ownerEmail})
  LIMIT 1
`;
```

### Pattern 3: SUPER_ADMIN role assertion inside service (module convention)
**What:** Admin methods check `normalizeRole(actor.role) === 'SUPER_ADMIN'` and throw `BadRequestException` otherwise, rather than relying on decorators alone.
**When to use:** `markRegistrationDocumentViewed` (D-05) must duplicate this check — controller decorators are belt, service role check is suspenders.
**Example (verified from tenant-governance.service.ts:1955-1959):**
```typescript
const actor = await this.getProfileOrThrow(actorUserId);
const role = this.normalizeRole(actor.role);
if (role !== 'SUPER_ADMIN') {
  throw new BadRequestException('Only super admins can access this endpoint.');
}
```

### Pattern 4: Mocked-Prisma spec (Phase 9 convention)
**What:** `Test.createTestingModule` with a typed mock `prisma` object covering the methods the service calls (`$queryRaw`, `$executeRaw`, `profile.findUnique`, etc.), plus `jest.spyOn(service, 'logAudit')`.
**When to use:** New specs for gate/view/status methods. Mirror `backend/src/kyc/kyc.service.spec.ts` (modern) over the older minimal `tenant-governance.service.spec.ts`.
**Example source:** `backend/src/kyc/kyc.service.spec.ts` — the canonical mocked-Prisma pattern in this repo.

### Anti-Patterns to Avoid
- **UI-only gating:** The original defect (ONB-01 audit note). The gate MUST live in the service APPROVED branch — the UI is not part of the trust boundary.
- **Viewing gated in the client only:** D-06 requires the server to reject approve-without-view; a client-side `disabled` attribute alone is bypassable and fails UAT.
- **Adding `@RequiresPermission('onboarding.*')` without extending `SUPER_ADMIN_PERMISSIONS`:** See Pitfall 1 — breaks the only user who can review.
- **Mutating the 69-site catalog spec blind:** Any decorator change on the two reviewed controller methods + two new decorated endpoints changes the count and MATRIX — see Pitfall 2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RBAC enforcement on new endpoints | Custom role checks from scratch | Existing `@RequiresPermission` + `RbacGuard` (plus existing `assertRole` in service) | RbacGuard already centralizes SUPER_ADMIN logic; hand-rolled guards drift |
| Enum type-casting in SQL | String concatenation of enum values | Prisma `$queryRaw` tagged templates with `::"ComplianceDocStatus"` casts | Parameterized via Prisma's tagged templates; avoids injection and cast errors |
| UUID validation in queries | Manual string checks | `${id}::uuid` cast pattern | PostgreSQL rejects invalid UUIDs with a clear error; consistent with module |
| Status aggregation logic | Reimplement in two places (API + client) | Single server-side `GET /me/status` | D-09 centralizes; client just renders — single source of truth for `overall` |
| Upload allow-list (7 types) | Duplicate the array in the gate | Reuse the same 7-type list semantics as `uploadRegistrationDocument` (:1874-1877) | D-02 explicitly says "the 7 types currently allowed for upload" — divergence would let a gate pass for a doc the upload path cannot produce |

**Key insight:** Every requirement here activates already-existing schema and constants. The risk is not building new machinery — it is keeping the catalog spec, the guard allow-list, and the two UI surfaces in sync with the three service changes.

## Runtime State Inventory

> Not a rename/refactor/migration phase — **omitted** (greenfield feature phase on existing tables; no stored-data, config, OS-registration, secret, or artifact renames involved).

## Common Pitfalls

### Pitfall 1: D-07's "SUPER_ADMIN bypasses anyway" is FALSE — RbacGuard 403s SUPER_ADMIN on unknown permissions (CRITICAL)
**What goes wrong:** If the plan follows D-07 literally — switching `reviewRegistrationDocument`/`reviewClientRegistration` from `@RequiresPermission(PERMISSIONS['platform.manage'])` to `onboarding.review_documents`/`onboarding.approve`, and adding the same to the new view endpoint and (per D-07 "admin list") `adminListRegistrationDocuments` — every SUPER_ADMIN call gets `403 Forbidden: Super admin is not granted permission(s): ...`.
**Why it happens:** `RbacGuard` (rbac.guard.ts:106-141) for SUPER_ADMIN requires every `@RequiresPermission` value to be in the hard-coded `SUPER_ADMIN_PERMISSIONS` set (:25-30 = `platform.manage`, `tenant.view_audit`, `compliance.view`, `compliance.manage_documents`). `onboarding.review_documents`/`onboarding.approve` are NOT in it. The CONTEXT.md parenthetical was written from the assumption that SUPER_ADMIN is a blanket bypass — the guard disproves it.
**How to avoid:** Either (a) add `'onboarding.review_documents'` and `'onboarding.approve'` to `SUPER_ADMIN_PERMISSIONS` in rbac.guard.ts:25-30 (recommended — honors D-07's intent of catalog consistency), or (b) keep `platform.manage` on these endpoints and skip D-07's wiring. Option (a) is preferred; it is a one-line-per-permission change with a comment-free set extension.
**Warning signs:** Any manual POST to the review endpoint with a SUPER_ADMIN token returning 403 after the change; catalog spec MATRIX mismatch failures.

### Pitfall 2: Permissions catalog spec is a hard count + MATRIX — decorator edits break it
**What goes wrong:** `permissions-catalog.spec.ts` asserts exactly **69** decorated sites across 8 controllers (:413-419) and that every `@RequiresPermission` site matches the MATRIX (:456-469). Adding `@RequiresPermission` to `adminListRegistrationDocuments` (currently NO decorator at controller.ts:269-276) → +1; adding the new view endpoint with a decorator → +1; changing existing MATRIX entries (`reviewRegistrationDocument` at :180-183, `reviewClientRegistration` at :176-179 currently `platform.manage`) without updating the MATRIX → mismatch failures.
**Why it happens:** The spec parses controller files and compares against a hard-coded MATRIX and the literal `69`; it was calibrated in the Phase 9 (RBAC) red-phase.
**How to avoid:** When the implementation plan touches controller decorators, budget explicit edits: bump `expect(total).toBe(69)` to the new count, add/update MATRIX entries keyed `${basename}::${method}`, keep tuple `['SUPER_ADMIN']` (the holder-coverage loop at :464-467 skips SUPER_ADMIN so `ROLE_PERMISSIONS` needs no change).
**Warning signs:** `npm test -- permissions-catalog` red after decorator edits.

### Pitfall 3: `reviewRegistrationDocument` blocks re-review of REJECTED docs (status lock)
**What goes wrong:** The current method rejects when `currentStatus` is VERIFIED **or REJECTED** (:2003-2005: "Document has already been rejected"). If the aggregation flags ACTION_REQUIRED and the owner re-uploads, the upload path correctly resets REJECTED→UPLOADED (:1892-1901 clears rejection_reason). But if a reviewer tries to flip an existing REJECTED doc to VERIFIED after the owner re-uploads WITHOUT a new file (or before the owner acts), it 400s — that is existing intended behavior, but the plan must not "fix" it by removing the lock.
**How to avoid:** Keep the existing status lock. The owner re-upload path is the recovery mechanism; the gate checks `registration_request_id`-scoped statuses at approve time, so stale REJECTED docs correctly block the trial.
**Warning signs:** A test asserting "reject then approve same document succeeds" — that should NOT be a passing test.

### Pitfall 4: D-08 button state races with persisted view state
**What goes wrong:** If the modal enables Approve the moment the PDF viewer opens (client-side), a fast reviewer can Approve before the `POST .../view` response persists `hasViewed` — and the server (D-06) then 400s the approve. If the modal requires the view call to complete first, a failed call leaves Approve disabled with no user feedback.
**How to avoid:** Sequence in the modal: open viewer → call `POST .../view` → on success set `hasViewed` in component state → enable Approve. On view-call failure, show the existing error surface and keep Approve disabled. Reject stays enabled per D-06/D-08.
**Warning signs:** UAT step "approve without opening document" — must 400 server-side even if UI allows it.

### Pitfall 5: Aggregation semantics vs the existing `allDocsApproved` UI check
**What goes wrong:** `TrialRequestsPanel.tsx:80` computes `allDocsApproved` = `regDocs.length >= 7 && all VERIFIED`. The new status endpoint (D-09) treats docs in `UPLOADED`/`UNDER_REVIEW` as `PENDING_REVIEW` — so `overall` can be `PENDING_REVIEW` while the admin panel's older check says "not approved". Mismatched states confuse UAT.
**How to avoid:** The panel should consume the new endpoint for the approve gate (it must ALSO be blocked at the service anyway per D-01). Keep the UI lock message accurate — the existing "Approve is locked until all 7 regulatory documents are approved" (:422-427) needs rewording to reflect the gate semantics (docs submitted + reviewed, not merely VERIFIED).
**Warning signs:** Screenshot showing the admin panel enabling trial approval while `GET /me/status` reports `INCOMPLETE`.

## Code Examples

Verified patterns from the repo (all line-referenced above):

### Common Operation 1: Gate check in the APPROVED branch (ONB-01)
```typescript
// Insert at top of `if (decision === 'APPROVED')` block, tenant-governance.service.ts:1459,
// BEFORE `await this.ensureTenantModuleConfigTable();` at :1460.
// Pattern: LEFT JOIN against the fixed 7-type set (D-02), status ∈ UPLOADED/UNDER_REVIEW/VERIFIED (D-03).
const requiredTypes = [
  'DTI_REGISTRATION', 'MAYORS_PERMIT', 'BIR_COR', 'BSP_LICENSE',
  'AMLC_REGISTRATION', 'GOVERNMENT_ID', 'PROOF_OF_ADDRESS',
] as const;

const missing = await this.prisma.$queryRaw<Array<{ doc_type: string }>>`
  SELECT t.doc_type
  FROM (SELECT unnest(ARRAY[${requiredTypes}]::"ComplianceDocType"[]) AS doc_type) t
  LEFT JOIN public.pawnshop_documents d
    ON d.registration_request_id = ${requestId}::uuid
   AND d.document_type = t.doc_type
   AND d.status IN ('UPLOADED', 'UNDER_REVIEW', 'VERIFIED')
  WHERE d.id IS NULL
`;
if (missing.length > 0) {
  throw new BadRequestException(
    `Cannot approve: missing required documents: ${missing.map((m) => m.doc_type).join(', ')}`,
  );
}
```
> Note: exact placeholder shape for the unnest array must match the module's existing `$queryRaw` usage; validate against the KYC spec's mock `$queryRaw` when writing the spec.

### Common Operation 2: View endpoint update (ONB-02 / D-05)
```typescript
// Mirrors reviewRegistrationDocument ownership/role flow (:1987-2000) then performs the UPDATE.
await this.prisma.$queryRaw`
  UPDATE public.pawnshop_documents
  SET has_viewed = TRUE,
      viewed_at = NOW(),
      viewed_by = ${actorUserId}::uuid,
      updated_at = NOW()
  WHERE id = ${documentId}::uuid AND registration_request_id = ${requestId}::uuid
`;
return { success: true, hasViewed: true };
```

### Common Operation 3: hasViewed guard before approve (ONB-02 / D-06)
```typescript
// In reviewRegistrationDocument, after fetching docRows (:1993-2000):
if (dto.decision === 'APPROVED' && !(docRows[0] as any).has_viewed) {
  throw new BadRequestException('Document must be viewed before it can be approved.');
}
// Note: SELECT must add has_viewed to the existing column list at :1994.
```

### Common Operation 4: Aggregation query (ONB-03 / D-09)
```typescript
// fetch all docs for the owner's latest request (reuse listMyClientRegistrationRequests to pick the requestId,
// then):
const docs = await this.prisma.$queryRaw<Array<{ document_type: string; status: string; rejection_reason: string | null }>>`
  SELECT document_type, status, rejection_reason
  FROM public.pawnshop_documents
  WHERE registration_request_id = ${requestId}::uuid
`;
// Compute per D-10:
//   any status === 'REJECTED'          → overall = 'ACTION_REQUIRED'
//   all 7 types present & VERIFIED      → overall = 'APPROVED'
//   all 7 types present (any UPLOADED/UNDER_REVIEW) → overall = 'PENDING_REVIEW'
//   any required type missing           → overall = 'INCOMPLETE'
// Return { overall, documents, submissionStatus } where submissionStatus = request.status
```

### Common Operation 5: D-08 modal sequencing (frontend)
```typescript
// TrialRequestsPanel.tsx, review modal handler — open viewer, then persist view state, then enable Approve.
const handleOpenDocument = async (doc: RegDocument) => {
  await api.post(`/tenant-governance/client-registrations/${requestId}/documents/${doc.id}/view`);
  setViewedDocIds((prev) => new Set(prev).add(doc.id)); // Approve disabled until id present (D-08)
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trial starts on SUPER_ADMIN approve regardless of docs (audit finding "Docs-before-trial gate MISSING") | Server-side 7-doc gate inside APPROVED branch (D-01..D-04) | This phase | Owner cannot enter trial until compliance docs submitted + reviewed |
| `hasViewed` fields exist but never set; approve allowed without viewing (audit "no hasViewed") | View endpoint persists state; approve requires it (D-05..D-08) | This phase | Traceability: `viewed_by`/`viewed_at` recorded for every approved doc |
| Owner sees per-doc status only; no aggregate (audit "no REJECTED aggregation") | `GET /client-registrations/me/status` with ACTION_REQUIRED (D-09..D-11) | This phase | Single source of truth for onboarding overall status |
| Permission constants defined but un-wired (permissions.const.ts:24-25, granted to no role) | `@RequiresPermission` wiring + `SUPER_ADMIN_PERMISSIONS` extension (D-07) | This phase | Catalog consistency; guard allow-list must be updated in lockstep |

**Deprecated/outdated:**
- None in this phase's scope — all existing behavior is additive or preserved (D-04).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The status endpoint should reuse `listMyClientRegistrationRequests` to resolve the active requestId rather than a fresh query | Architecture Patterns | Low — D-09 leaves query shape to discretion; reusing the existing method is consistent with module patterns |
| A2 | The unnest-array gate query can be parameterized exactly like the existing `$queryRaw` usages | Code Examples | Low-medium — `unnest(ARRAY[...]::"ComplianceDocType"[])` with a Prisma-bound array needs a quick smoke test; alternative is a simple `SELECT` per type or a single query with `COUNT` + `FILTER` |
| A3 | Frontend specs for the modal change are optional this phase (backend specs carry the load) | Open Questions Q2 | Low — Phase 9 precedent added frontend mirror specs; skipping keeps scope tight |
| A4 | The `viewed` state is keyed client-side by document id in TrialRequestsPanel (Set) | Code Examples | Low — modal local state per D-08 discretion |
| A5 | Existing `pending-access` polling interval in PendingAccessDashboard refreshes the new banner without a new interval | Architecture Patterns (D-12) | Low — re-fetch on the existing tick satisfies D-12; verify the interval actually re-renders after actions |

## Open Questions

1. **Does D-07's decorator change extend `SUPER_ADMIN_PERMISSIONS` or skip the wiring?**
   - What we know: CONTEXT says "SUPER_ADMIN bypasses anyway" — guard code disproves it (rbac.guard.ts:119-128).
   - What's unclear: whether the user accepts the two-line guard extension (recommended) or prefers keeping `platform.manage`.
   - Recommendation: **Plan for the guard extension** (option a in Pitfall 1) — it honors D-07's catalog-consistency intent; flag the decision in the plan for user confirmation at discuss-phase if the plan is reviewed.

2. **Frontend spec coverage for TrialRequestsPanel modal (D-08)?**
   - What we know: `KycStatusBadge.test.tsx` + `kycDocs.test.ts` establish the vitest mirror pattern; vitest 3.2.4 + @testing-library/react 16.3.0 are installed.
   - What's unclear: whether the modal sequencing warrants a component test this phase.
   - Recommendation: Cover the extracted pure logic (e.g., `canApprove(doc)`/viewed-set helper) with a small vitest mirror; leave full modal interaction to manual UAT.

3. **`GET /client-registrations/me/status` when the owner has multiple requests?**
   - What we know: owners may have DRAFT + PENDING requests; `listMyClientRegistrationRequests` returns all.
   - What's unclear: which request the aggregate targets.
   - Recommendation: Aggregate the most-recent non-cancelled request (consistent with how `App.tsx:690-737` picks the owner's active registration); document this in the plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend/frontend build + tests | ✓ | v26.4.0 | — |
| npm | Install/lockfile integrity | ✓ | 11.17.0 | — |
| PostgreSQL (Supabase) | Runtime data (registration requests, documents) | ✓ (existing connection via Prisma env) | — | — |
| Jest (backend) | Specs | ✓ | 29.x (pinned) | — |
| Vitest (frontend) | Mirror specs | ✓ | 3.2.4 (pinned) | — |
| External research providers (context7) | Research only | ✗ | — | Not needed — codebase verified directly (this document) |

**Missing dependencies with no fallback:** none — this phase is code/config-only against existing infrastructure. `no new npm installs`.

## Validation Architecture

> `workflow.nyquist_validation` key absent in `.planning/config.json` → treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Backend: jest 29.x + ts-jest; Frontend: vitest 3.2.4 |
| Config file | Backend: inline in `backend/package.json` (`rootDir: src`, `testRegex: .*\.spec\.ts$`); Frontend: none (defaults) |
| Quick run command | Backend: `npm test -- tenant-governance` (backend dir); Frontend: `npm test` (frontend dir) |
| Full suite command | Backend: `npm test`; Frontend: `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ONB-01 | APPROVED rejected with 400 when any of the 7 required types missing/REJECTED/EXPIRED | unit (mocked-Prisma) | `npm test -- tenant-governance` | ❌ Wave 0 — new spec block in `tenant-governance.service.spec.ts` (or new sibling spec) |
| ONB-01 | APPROVED proceeds when all 7 present with status ∈ UPLOADED/UNDER_REVIEW/VERIFIED | unit | same | ❌ Wave 0 |
| ONB-01 | Non-APPROVED decisions (CONTACTED/REJECTED) skip the gate | unit | same | ❌ Wave 0 |
| ONB-02 | `POST .../view` sets hasViewed=true/viewedAt/viewedBy for SUPER_ADMIN; 400 for non-SUPER_ADMIN | unit | same | ❌ Wave 0 |
| ONB-02 | reviewRegistrationDocument APPROVED 400s when hasViewed=false; REJECTED allowed | unit | same | ❌ Wave 0 |
| ONB-02 | Permissions catalog spec still green (count + MATRIX updated) | unit | `npm test -- permissions-catalog` | ✅ existing file — EDIT |
| ONB-03 | `/me/status` aggregation: REJECTED→ACTION_REQUIRED, all VERIFIED→APPROVED, mixed→PENDING_REVIEW, missing→INCOMPLETE | unit | `npm test -- tenant-governance` | ❌ Wave 0 |
| ONB-04 | Owner status flow still renders after wiring (manual UAT + optional vitest mirror for extracted helpers) | manual + optional unit | `npm test` (frontend) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tenant-governance` (backend) / `npm test` (frontend)
- **Per wave merge:** Full backend suite `npm test` + full frontend `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `backend/src/tenant-governance/tenant-governance.service.spec.ts` (or new sibling) — mocked-Prisma blocks for gate / view / hasViewed-guard / status aggregation. Model on `backend/src/kyc/kyc.service.spec.ts` (typed mock prisma with `$queryRaw`/`$executeRaw`/`profile.findUnique`, `jest.spyOn(service, 'logAudit')`).
- [ ] `backend/src/common/permissions/permissions-catalog.spec.ts` — update `69` literal + MATRIX entries when controller decorators change (Pitfall 2).
- [ ] Frontend: vitest mirror for extracted modal/status helpers if any pure logic is extracted (optional, per Open Question 2).
- [ ] No framework install needed — jest/vitest already configured in both workspaces.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged — auth via Supabase JWT + existing `AuthUserService` |
| V3 Session Management | no | Unchanged |
| V4 Access Control | **yes** | `@RequiresPermission` + `RbacGuard` + service-level `assertRole`/SUPER_ADMIN checks (defense in depth) |
| V5 Input Validation | yes | DTOs via class-validator (existing module DTO pattern); decision/status values validated |
| V6 Cryptography | no | No new keys/secrets — `viewed_by` is an existing actor UUID |

### Known Threat Patterns for {NestJS + Prisma raw SQL + React}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via decision/status string interpolation | Tampering | Prisma `$queryRaw` tagged templates — never string-concatenate user input into raw SQL; use `${}` parameters + enum casts |
| Privilege escalation: non-SUPER_ADMIN reviewing docs or viewing | Elevation of Privilege | SUPER_ADMIN check in service (`normalizeRole`) for admin list/review/view endpoints; owner-email scoping for `/me/*` |
| Cross-owner data access: owner A reading owner B's docs via requestId guess | Information Disclosure | `lower(owner_email) = lower(${ownerEmail})` scoping on every owner-facing query (existing pattern, reuse for status endpoint) |
| Bypassing view-before-approve | Tampering | D-06 server-side `hasViewed` guard — UI disable is not a control |
| Trial activation without docs | Tampering | ONB-01 gate in the service APPROVED branch — the single chokepoint |

## Sources

### Primary (HIGH confidence)
- Codebase verification (this session, line-referenced): `tenant-governance.service.ts`, `tenant-governance.controller.ts`, `rbac.guard.ts`, `permissions.const.ts`, `permissions-catalog.spec.ts`, `schema.prisma`, `TrialRequestsPanel.tsx`, `PendingAccessDashboard.tsx`, `App.tsx`, `kyc.service.spec.ts`, `kycDocs.test.ts`, `KycStatusBadge.test.tsx`
- `.planning/phases/10-onboarding-compliance-gate/10-CONTEXT.md` (decisions D-01..D-12, verbatim)
- `.planning/REQUIREMENTS.md` (ONB-01..ONB-04 wording)
- npm registry (`npm view` 2026-08-11) — stack versions + legitimacy signals
- `.planning/phases/09-kyc-verification-disbursement-guardrail/09-VALIDATION.md` — validation format reference

### Secondary (MEDIUM confidence)
- gsd-tools `package-legitimacy check` verdicts (recency false-positives on pinned mega-packages, cross-checked against npm registry data)

### Tertiary (LOW confidence)
- None — all claims verified against repo or registry; external research providers (context7) were unavailable and unnecessary

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries pre-existing pinned; verified in repo package.json + npm registry
- Architecture: HIGH — insertion points, guard behavior, and UI surfaces read directly from source with line numbers
- Pitfalls: HIGH — RbacGuard SUPER_ADMIN semantics and catalog-spec count verified by reading the actual code

**Research date:** 2026-08-11
**Valid until:** 2026-09-10 (stable monorepo; no fast-moving deps introduced)
