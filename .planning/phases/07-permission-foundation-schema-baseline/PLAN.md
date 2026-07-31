---
phase: 07-permission-foundation-schema-baseline
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/prisma/schema.prisma
  - backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql
  - backend/prisma/seed-permissions.ts
  - backend/src/common/permissions/permissions.const.ts
  - backend/src/common/permissions/permissions.service.ts
  - backend/src/common/permissions/permissions.module.ts
  - backend/src/common/permissions/permissions.service.spec.ts
  - backend/src/common/permissions/permissions-catalog.spec.ts
  - backend/src/common/decorators/requires-permission.decorator.ts
  - backend/src/common/guards/rbac.guard.ts
  - backend/src/common/guards/rbac.guard.spec.ts
  - backend/src/common/common.module.ts
  - backend/src/loan/pawn-ticket.controller.ts
  - backend/src/loan/loan.controller.ts
  - backend/src/tenant-governance/tenant-governance.controller.ts
  - backend/src/app.controller.ts
  - backend/src/compliance/compliance.controller.ts
  - backend/src/auction/auction.controller.ts
  - backend/test/app.e2e-spec.ts
autonomous: false
requirements: [RBAC-01, RBAC-02]
user_setup: []

must_haves:
  truths:
    - "A request to a @RequiresPermission-guarded endpoint is allowed only when the caller's effective permission set (base role ∪ staffType, resolved from the seeded catalog per request) contains every required permission; otherwise 403. (SC1)"
    - "Role→permission mapping is data-driven: an UPDATE on role_permissions changes enforcement on the next request with zero code change. (SC2)"
    - "Staff profiles evaluate by staffType permissions after role normalization — normalized (role='STAFF'+staffType) and legacy (role='CASHIER_TELLER'/etc.) profile shapes resolve identically; generic STAFF no longer over-grants. (SC3)"
    - "SUPER_ADMIN passes every guarded endpoint via bypass, before any permission lookup. (SC4)"
    - "All 63 pre-existing @Roles sites declare @RequiresPermission equivalents per the migration matrix (12 distinct tuples) with no endpoint left decorator-less; equivalence is machine-asserted. (Phase-7 one-pass mandate)"
    - "One batched additive migration applies cleanly: 4 new enums, 5 new models (incl. permissions + role_permissions), and the additive columns on Customer/Receipt/PawnshopDocument/LoanContract; catalog rows (37 permissions, 101 role→permission rows) present after migrate deploy."
  artifacts:
    - backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql
    - backend/src/common/permissions/permissions.const.ts
    - backend/src/common/permissions/permissions.service.ts
    - backend/src/common/permissions/permissions.module.ts
    - backend/src/common/decorators/requires-permission.decorator.ts
    - backend/src/common/guards/rbac.guard.ts (rewritten, staffType-aware dual-mode)
    - backend/prisma/seed-permissions.ts (standalone idempotent)
    - backend/src/common/guards/rbac.guard.spec.ts
    - backend/src/common/permissions/permissions-catalog.spec.ts
    - backend/src/common/permissions/permissions.service.spec.ts
    - backend/test/app.e2e-spec.ts (extended)
  key_links:
    - "RbacGuard ↔ PermissionService: global DI wiring via CommonModule (exports); guard step-7 calls resolveEffectivePermissions(role, staffType) per request."
    - "PERMISSIONS const ↔ migration SQL ↔ seed-permissions.ts ↔ decorator sites: single typed source of truth; permissions-catalog.spec.ts asserts all four stay in sync."
    - "@RequiresPermission precedence over @Roles when both present; @Roles legacy path kept as fail-closed fallback for unconverted/future endpoints."
    - "profile.staffType ↔ catalog staffType rows (CASHIER_TELLER/APPRAISER/INVENTORY_CUSTODIAN/AUDITOR): guard normalizes legacy role values BEFORE union resolution."
    - "Migration catalog INSERTs use ON CONFLICT DO NOTHING (idempotent by construction); seed-permissions.ts mirrors via upsert for local dev."
---

<objective>
Phase 7 replaces hardcoded role-string authorization with a data-driven permission catalog and makes the RbacGuard staffType-aware, on top of one batched additive schema migration carrying every v2.0 schema element (permission catalog + role→permission mapping, approval-record model, customer KYC link, receipt.customerId, customer tier + tier history, onboarding hasViewed, signature-image metadata).

Purpose: RBAC-01 (mechanism: catalog + @RequiresPermission + catalog-driven guard) and RBAC-02 (staffType-aware evaluation after role normalization) land the foundation every later phase (8-12) builds on. The schema baseline adds data models/fields for later phases WITHOUT any runtime logic. The one-pass endpoint migration converts all 63 existing @Roles sites so nothing regresses during the transition.

Output: one batched migration (schema DDL + catalog seed data), typed PERMISSIONS const + @RequiresPermission decorator, PermissionService + staffType-aware dual-mode RbacGuard, standalone idempotent seed script, 63 endpoint decorator conversions, and a test suite (guard decision matrix + catalog consistency + equivalence scan) that machine-proves the success criteria.
</objective>

<execution_context>
@C:/Users/arvie/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/arvie/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/07-permission-foundation-schema-baseline/RESEARCH.md
@backend/src/common/guards/rbac.guard.ts
@backend/src/common/guards/pawnshop.guard.ts
@backend/src/common/auth-user.service.ts
@backend/src/common/common.module.ts
@backend/src/app.module.ts
@backend/prisma/schema.prisma
@backend/prisma/seed.ts
@backend/package.json
</context>

## Phase Goal (restated)

**Goal from ROADMAP:** Authorization becomes data-driven — a seeded permission catalog plus staffType-aware RbacGuard replaces hardcoded role strings — on top of a single batched Prisma migration that adds every v2.0 schema element.

**Requirements:** RBAC-01 (permission catalog + role→permission mapping replaces hardcoded role strings; endpoints declare `@RequiresPermission(...)`; RbacGuard evaluates permissions), RBAC-02 (RbacGuard honors `staffType` for APPRAISER/CASHIER_TELLER/INVENTORY_CUSTODIAN/AUDITOR after role normalization).

> **Artifact-inconsistency note (per REVIEW MINOR-6):** `.planning/REQUIREMENTS.md` §Out of Scope still lists "Complete permission refactor of every endpoint in one pass" as OUT of scope — this contradicts RBAC-01's one-pass mandate (M1) which this plan executes (user directive; matrix rows 1-63 via T10-T12). **Update to make (owner action — do NOT edit REQUIREMENTS.md in this phase):** remove that stale line from REQUIREMENTS.md §Out of Scope so the artifact trail agrees. Directive provenance: no CONTEXT.md exists in this phase dir; the "user constraint"/"user scope directive" citations in the Assumptions Log below originate from the user's plan-phase instructions (verbatim prompt).

### Success Criteria → Verification Mapping

| # | Success Criterion (ROADMAP) | Delivered By | Verified By |
|---|------------------------------|--------------|-------------|
| SC1 | `@RequiresPermission` endpoints allow only when role holds permission in catalog; else 403 | T8 guard rewrite + T5 guard spec | `npx jest src/common/guards/rbac.guard.spec.ts --runInBand` (allow/deny matrix); e2e 401/403 chain test (T13); manual curl recipe |
| SC2 | Mapping is data-driven — editing seeded catalog changes enforcement, no code change | T2 migration seed rows + T6 PermissionService (per-request DB read, no cache) | Catalog consistency spec; data-driven proof: `UPDATE role_permissions ...` on dev DB then re-curl → enforcement flips (documented in T13) |
| SC3 | staffType users evaluated by staffType permissions after role normalization (no fail/forbypass) | T9 guard normalization + T5 guard spec (3 profile shapes) | Guard spec cases: legacy `role='CASHIER_TELLER'`, normalized `role='STAFF'+staff_type`, generic STAFF; APPRAISER allowed appraise, generic STAFF denied |
| SC4 | SUPER_ADMIN full-access bypass across all guarded endpoints | T9 guard bypass step (before permission lookup) | Guard spec SUPER_ADMIN cases (with @RequiresPermission and @Roles present) |
| M1 (mandate) | All 63 @Roles sites converted to @RequiresPermission equivalents; nothing regresses | T10/T11/T12 per-domain conversion + T5 equivalence scan | `npx jest src/common/permissions/permissions-catalog.spec.ts --runInBand` (static scan: 0 @Roles-only endpoints; every tuple mapped; every required permission held by all tuple roles) |
| M2 (schema) | Single batched migration applies cleanly with catalog rows | T1 schema edits + T2 migration + T4 deploy | `npx prisma migrate status` clean; row-count assertions (37 permissions, 101 role_permissions); `npx prisma validate` + `npx prisma generate` |

## Execution Strategy & Ordering

Order is chosen for safety: **schema migration FIRST** (adds Permission/RolePermission + entire v2.0 baseline), **then constants + seed**, **then the guard rewrite** (with tests written first — Nyquist), **then the one-pass endpoint migration** grouped by controller domain (3 commits, each independently reviewable), **then e2e + full verification**.

- **Dual-mode guard:** RbacGuard keeps the `@Roles` legacy path as a fail-closed fallback for any endpoint still carrying only `@Roles`. When both decorators are present, the permission path wins (guard step order below). All 63 sites are REPLACED with `@RequiresPermission` — keeping both decorators would be behaviorally identical (permission path takes precedence) but adds noise; the `roles.decorator.ts` file and guard fallback remain intact.
- **Transient 403 window (T9→T12, same-session, documented — NOT a regression, per REVIEW MINOR-8):** from the moment T9's normalization lands until each endpoint converts in T10-T12, a *legacy* profile (role still `CASHIER_TELLER`/`APPRAISER`/`INVENTORY_CUSTODIAN`/`AUDITOR` — the rows migration 20260324 skipped) that previously matched an @Roles tuple *by its legacy role name* will get 403 on that still-unconverted endpoint: the guard now normalizes the role to STAFF before the @Roles fallback, and STAFF may not be in the old tuple. The window closes endpoint-by-endpoint as T10-T12 replace each decorator with `@RequiresPermission` (normalization + catalog union then resolves correctly), completing at T12. Executors must not treat mid-wave 403s as regressions; no e2e tests run during Waves 3-4 (e2e is T13, after the window closes).
- **Frontend:** NO frontend change is required for Phase 7 — confirmed. The frontend already writes `role:'STAFF'` + `staff_type` (verified: `frontend/src/App.tsx:290-546`, `frontend/src/components/StaffMatrix.tsx:90-101`); the guard change adds `staffType` to the internal `request.user` shape (additive, not consumed by the frontend); all 63 endpoints keep identical routes and response shapes. Endpoint-level access corrections (e.g., normalized CASHIER_TELLER can now redeem) are backend-only. A zero-frontend-change confirmation is recorded in T13.
- **No new npm dependencies** — research verified the full stack (NestJS guards, Prisma 5.22, tsx, jest) already exists. Package Legitimacy Gate not applicable (zero installs).

## Delivery Inventory (all files this phase touches)

| File | Action | Task |
|------|--------|------|
| `backend/prisma/schema.prisma` | Edit: +4 enums, +5 models, +12 additive columns (+4 relation back-refs on existing models) | T1 |
| `backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql` | Create: batched DDL + catalog INSERTs (37 + 101 rows) | T2 |
| `backend/src/common/permissions/permissions.const.ts` | Create: flat typed PERMISSIONS const + ROLE_PERMISSIONS matrix + PermissionName type | T5 |
| `backend/src/common/decorators/requires-permission.decorator.ts` | Create: PERMISSIONS_KEY + RequiresPermission(...names) | T5 |
| `backend/prisma/seed-permissions.ts` | Create: standalone idempotent upsert (imports matrix from const) | T6 |
| `backend/src/common/permissions/permissions.service.ts` | Create: resolveEffectivePermissions(role, staffType) | T8 |
| `backend/src/common/permissions/permissions.module.ts` | Create: module | T8 |
| `backend/src/common/common.module.ts` | Edit: provide+export PermissionService | T8 |
| `backend/src/common/guards/rbac.guard.ts` | Rewrite: staffType-aware dual-mode resolution | T9 |
| `backend/src/common/guards/rbac.guard.spec.ts` | Create: guard decision matrix (RED first) | T7 |
| `backend/src/common/permissions/permissions-catalog.spec.ts` | Create: const↔SQL↔matrix consistency + 63-site equivalence scan | T7 |
| `backend/src/common/permissions/permissions.service.spec.ts` | Create: service query contract (role ∪ staffType) | T7 |
| `backend/src/loan/pawn-ticket.controller.ts`, `backend/src/loan/loan.controller.ts` | Edit: 26 decorator conversions (loan domain) | T10 |
| `backend/src/tenant-governance/tenant-governance.controller.ts`, `backend/src/app.controller.ts` | Edit: 25 conversions (platform domain) | T11 |
| `backend/src/compliance/compliance.controller.ts`, `backend/src/auction/auction.controller.ts` | Edit: 12 conversions (compliance+auction domain) | T12 |
| `backend/test/app.e2e-spec.ts` | Edit: extend with 401/403 chain tests | T13 |

## Permission Catalog (37 values — source of truth: RESEARCH.md §Permission Catalog)

`permissions.const.ts` declares a **flat** const: each value is the `resource.action` string, and the object itself is the single typed source for decorators, seed script, and specs. Group (DB `group` column) is derived as the prefix before the first `.` — no second data structure to drift.

```ts
// Shape: flat const; PermissionName = keyof typeof PERMISSIONS; group = name.split('.')[0]
export const PERMISSIONS = {
  'platform.manage': 'platform.manage',
  'tenant.manage': 'tenant.manage',
  'tenant.view_audit': 'tenant.view_audit',
  'tenant.manage_branches': 'tenant.manage_branches',
  'user.manage_staff': 'user.manage_staff',
  'pawn_ticket.create': 'pawn_ticket.create',
  'pawn_ticket.view': 'pawn_ticket.view',
  'pawn_ticket.submit_approval': 'pawn_ticket.submit_approval',
  'pawn_ticket.approve': 'pawn_ticket.approve',
  'pawn_ticket.decline': 'pawn_ticket.decline',
  'pawn_ticket.appraise': 'pawn_ticket.appraise',
  'pawn_ticket.redeem': 'pawn_ticket.redeem',
  'pawn_ticket.send_to_auction': 'pawn_ticket.send_to_auction',
  'loan.create': 'loan.create',
  'loan.manage': 'loan.manage',
  'loan.collect': 'loan.collect',
  'auction.manage': 'auction.manage',
  'auction.settle': 'auction.settle',
  'auction.manual_settle': 'auction.manual_settle',
  'inventory.manage': 'inventory.manage',
  'compliance.view': 'compliance.view',
  'compliance.manage_documents': 'compliance.manage_documents',
  'onboarding.review_documents': 'onboarding.review_documents',
  'onboarding.approve': 'onboarding.approve',
  'reports.view': 'reports.view',
  'finance.manage': 'finance.manage',
  'approval.view_queue': 'approval.view_queue',
  'approval.approve_appraisal': 'approval.approve_appraisal',
  'approval.approve_redemption': 'approval.approve_redemption',
  'kyc.view': 'kyc.view',
  'kyc.verify': 'kyc.verify',
  'contract.sign': 'contract.sign',
  'contract.upload_signature': 'contract.upload_signature',
  'customer.view_history': 'customer.view_history',
  'customer.manage_tier': 'customer.manage_tier',
  'payroll.manage': 'payroll.manage',
  'attendance.manage': 'attendance.manage',
} as const;
export type PermissionName = keyof typeof PERMISSIONS;
```

`requires-permission.decorator.ts` (mirrors `roles.decorator.ts`):

```ts
import { SetMetadata } from '@nestjs/common';
import type { PermissionName } from '../permissions/permissions.const';
export const PERMISSIONS_KEY = 'permissions';
export const RequiresPermission = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

### Role → Permission matrix (seed content — 10 catalog rows, 101 mapping rows)

Seeded into `role_permissions` (role column = the canonical strings below; the four staffType values are first-class catalog rows). The same matrix lives as `ROLE_PERMISSIONS: Record<string, PermissionName[]>` in `permissions.const.ts` and is imported by `seed-permissions.ts` and both specs.

| Role (catalog row) | Permissions granted |
|---|---|
| SUPER_ADMIN | `platform.manage` (bypass covers everything; row exists for catalog completeness) |
| OWNER | all 37 except `platform.manage`, `onboarding.review_documents`, `onboarding.approve` (34) |
| ADMIN | `tenant.view_audit`, `auction.settle`, `auction.manual_settle`, `approval.view_queue`, `approval.approve_appraisal`, `approval.approve_redemption`, `kyc.view`, `kyc.verify` (8) |
| MANAGER | `tenant.manage_branches`, `user.manage_staff`, all 8 `pawn_ticket.*`, `loan.create`, `loan.manage`, `loan.collect`, `auction.settle`, `inventory.manage`, `reports.view`, `finance.manage`, `approval.view_queue`, `contract.sign`, `customer.manage_tier`, `attendance.manage` (21) |
| HR | `payroll.manage`, `attendance.manage` (2) |
| STAFF (generic base) | `pawn_ticket.create`, `pawn_ticket.view`, `pawn_ticket.submit_approval`, `loan.create`, `compliance.view`, `compliance.manage_documents`, `contract.sign`, `customer.view_history` (8) |
| CASHIER_TELLER (staffType) | STAFF base + `pawn_ticket.redeem`, `loan.collect`, `approval.view_queue` (11) |
| APPRAISER (staffType) | STAFF base + `pawn_ticket.appraise`, `approval.view_queue` (10) |
| INVENTORY_CUSTODIAN (staffType) | `pawn_ticket.view`, `inventory.manage` (2) |
| AUDITOR (staffType) | `pawn_ticket.view`, `reports.view`, `tenant.view_audit`, `finance.manage` (4) |

## Migration Matrix — 12 distinct @Roles tuples → permission set

**Mapping rule (per endpoint):** pick the research-matrix permission that (a) is semantically the endpoint's action and (b) is held by EVERY role in the old tuple. Where the research equivalence table offers a restricted palette (`pawn_ticket.redeem`/`loan.collect`), strict equivalence wins over semantics — see **DN-1**. All `('SUPER_ADMIN')` sites → `platform.manage` (catalog honesty; guard bypass means behavior is unchanged).

### Tuple summary (63 sites)

| Tuple | Count | Replacement permission(s) |
|---|---|---|
| `('SUPER_ADMIN')` | 25 | `platform.manage` |
| `('OWNER','MANAGER')` / `('MANAGER','OWNER')` | 16 | per-endpoint: `pawn_ticket.approve` / `pawn_ticket.decline` / `pawn_ticket.send_to_auction` / `loan.manage` / `tenant.manage_branches` / `contract.sign` |
| `('CASHIER_TELLER','MANAGER','OWNER')` | 6 | `pawn_ticket.redeem` / `loan.collect` |
| `('CASHIER_TELLER','STAFF','MANAGER','OWNER')` | 5 | `pawn_ticket.create` / `pawn_ticket.submit_approval` / `loan.create` / `customer.view_history` |
| `('OWNER','STAFF','SUPER_ADMIN')` | 4 | `compliance.view` / `compliance.manage_documents` |
| `('OWNER','ADMIN','MANAGER')` | 2 | `auction.settle` |
| `('SUPER_ADMIN','OWNER','ADMIN')` | 1 | `tenant.view_audit` |
| `('OWNER','STAFF')` | 1 | `compliance.manage_documents` |
| `('APPRAISER','STAFF','MANAGER','OWNER')` | 1 | `pawn_ticket.appraise` |
| `('OWNER')` | 1 | `tenant.manage` |
| `('OWNER','ADMIN')` | 1 | `auction.manual_settle` |

### Domain group A — Loan domain (26 sites)

**`backend/src/loan/pawn-ticket.controller.ts` (10):**

| # | Endpoint | Current @Roles | New @RequiresPermission |
|---|---|---|---|
| 1 | `POST pawn-tickets` | `('CASHIER_TELLER','STAFF','MANAGER','OWNER')` | `pawn_ticket.create` |
| 2 | `POST pawn-tickets/:id/submit-for-approval` | same | `pawn_ticket.submit_approval` |
| 3 | `POST pawn-tickets/:id/manager-approve` | `('OWNER','MANAGER')` | `pawn_ticket.approve` |
| 4 | `POST pawn-tickets/:id/decline` | `('OWNER','MANAGER')` | `pawn_ticket.decline` |
| 5 | `GET pawn-tickets/pending-approval` | `('OWNER','MANAGER')` | `pawn_ticket.approve` |
| 6 | `POST pawn-tickets/:id/approve` | `('OWNER','MANAGER')` | `pawn_ticket.approve` |
| 7 | `POST pawn-tickets/:id/appraise` | `('APPRAISER','STAFF','MANAGER','OWNER')` | `pawn_ticket.appraise` |
| 8 | `POST pawn-tickets/:id/redeem` | `('CASHIER_TELLER','MANAGER','OWNER')` | `pawn_ticket.redeem` |
| 9 | `GET pawn-tickets/customers/:customerId/tier` | `('CASHIER_TELLER','STAFF','MANAGER','OWNER')` | `customer.view_history` |
| 10 | `POST pawn-tickets/:id/send-to-auction` | `('OWNER','MANAGER')` | `pawn_ticket.send_to_auction` |

**`backend/src/loan/loan.controller.ts` (16):**

| # | Endpoint | Current @Roles | New @RequiresPermission |
|---|---|---|---|
| 11 | `POST loan/applications` | `('CASHIER_TELLER','MANAGER','OWNER')` | `loan.collect` (DN-1: strict equivalence; `loan.create` would widen generic STAFF) |
| 12 | `PATCH loan/applications/:id/status` | `('OWNER','MANAGER')` | `loan.manage` |
| 13 | `DELETE loan/applications/:id` | `('OWNER','MANAGER')` | `loan.manage` |
| 14 | `POST loan/eligibility/check` | `('CASHIER_TELLER','STAFF','MANAGER','OWNER')` | `loan.create` |
| 15 | `POST loan/:loanId/schedule/generate` | same | `loan.create` |
| 16 | `PATCH loan/schedule/payment` | `('OWNER','MANAGER')` | `loan.manage` |
| 17 | `POST loan/penalties/calculate` | `('CASHIER_TELLER','MANAGER','OWNER')` | `loan.collect` |
| 18 | `PATCH loan/penalties/:id/waive` | `('MANAGER','OWNER')` | `loan.manage` |
| 19 | `POST loan/penalties/manual` | `('MANAGER','OWNER')` | `loan.manage` |
| 20 | `POST loan/forfeitures/process` | `('MANAGER','OWNER')` | `loan.manage` |
| 21 | `POST loan/forfeitures/:ticketId/queue-auction` | `('MANAGER','OWNER')` | `pawn_ticket.send_to_auction` |
| 22 | `POST loan/:loanId/disburse` | `('CASHIER_TELLER','MANAGER','OWNER')` | `loan.collect` |
| 23 | `POST loan/renew` | `('CASHIER_TELLER','MANAGER','OWNER')` | `loan.collect` |
| 24 | `POST loan/payments` | `('CASHIER_TELLER','MANAGER','OWNER')` | `loan.collect` |
| 25 | `POST loan/contracts/:applicationId/generate` | `('MANAGER','OWNER')` | `loan.manage` |
| 26 | `PATCH loan/contracts/:applicationId/sign-staff` | `('MANAGER','OWNER')` | `contract.sign` (deliberate widening — see change log below) |

### Domain group B — Platform domain (25 sites)

**`backend/src/tenant-governance/tenant-governance.controller.ts` (24):**

| # | Endpoint | Current @Roles | New @RequiresPermission |
|---|---|---|---|
| 27 | `GET pawnshops/metadata` | `('SUPER_ADMIN')` | `platform.manage` |
| 28 | `POST support-access/request` | `('SUPER_ADMIN')` | `platform.manage` |
| 29 | `POST support-access/:requestId/approve` | `('SUPER_ADMIN')` | `platform.manage` |
| 30 | `POST support-access/:grantId/revoke` | `('SUPER_ADMIN')` | `platform.manage` |
| 31 | `GET support-access/audit` | `('SUPER_ADMIN')` | `platform.manage` |
| 32 | `GET audit/history` | `('SUPER_ADMIN','OWNER','ADMIN')` | `tenant.view_audit` |
| 33 | `GET support-access/status` | `('SUPER_ADMIN')` | `platform.manage` |
| 34 | `GET support-access/requests` | `('SUPER_ADMIN')` | `platform.manage` |
| 35 | `POST onboarding/configure` | `('SUPER_ADMIN')` | `platform.manage` |
| 36 | `PATCH branding` | `('SUPER_ADMIN')` | `platform.manage` |
| 37 | `POST client-registrations/:requestId/review` | `('SUPER_ADMIN')` | `platform.manage` |
| 38 | `POST client-registrations/:requestId/documents/:documentId/review` | `('SUPER_ADMIN')` | `platform.manage` |
| 39 | `POST branches` | `('OWNER','MANAGER')` | `tenant.manage_branches` |
| 40 | `PATCH branches/:branchId` | `('OWNER','MANAGER')` | `tenant.manage_branches` |
| 41 | `PATCH pawnshops/:id/toggle-status` | `('SUPER_ADMIN')` | `platform.manage` |
| 42 | `PATCH pawnshops/:id/settings` | `('SUPER_ADMIN')` | `platform.manage` |
| 43 | `POST pawnshops/:id/delete` | `('SUPER_ADMIN')` | `platform.manage` |
| 44 | `POST pawnshops` | `('SUPER_ADMIN')` | `platform.manage` |
| 45 | `POST invitations` | `('SUPER_ADMIN')` | `platform.manage` |
| 46 | `GET analytics/platform` | `('SUPER_ADMIN')` | `platform.manage` |
| 47 | `POST subscriptions/:pawnshopId/extend-trial` | `('SUPER_ADMIN')` | `platform.manage` |
| 48 | `POST subscriptions/:pawnshopId/upgrade-tier` | `('SUPER_ADMIN')` | `platform.manage` |
| 49 | `PATCH subscriptions/:pawnshopId/status` | `('SUPER_ADMIN')` | `platform.manage` |
| 50 | `POST subscriptions/request-extension` | `('OWNER')` | `tenant.manage` |

**`backend/src/app.controller.ts` (1):**

| # | Endpoint | Current @Roles | New @RequiresPermission |
|---|---|---|---|
| 51 | `GET pawnshops` | `('SUPER_ADMIN')` | `platform.manage` |

### Domain group C — Compliance + Auction domain (12 sites)

**`backend/src/compliance/compliance.controller.ts` (9):**

| # | Endpoint | Current @Roles | New @RequiresPermission |
|---|---|---|---|
| 52 | `POST compliance/documents` | `('OWNER','STAFF','SUPER_ADMIN')` | `compliance.manage_documents` (refined from research group-row: upload is a document-manage action; held by OWNER+STAFF) |
| 53 | `GET compliance/documents` | same | `compliance.view` |
| 54 | `PUT compliance/documents/:id/verify` | `('SUPER_ADMIN')` | `platform.manage` |
| 55 | `POST compliance/documents/:id/renew` | `('OWNER','STAFF')` | `compliance.manage_documents` |
| 56 | `GET compliance/` | `('OWNER','STAFF','SUPER_ADMIN')` | `compliance.view` |
| 57 | `GET compliance/score` | same | `compliance.view` |
| 58 | `GET compliance/pending-reviews` | `('SUPER_ADMIN')` | `platform.manage` |
| 59 | `GET compliance/all-pawnshops` | `('SUPER_ADMIN')` | `platform.manage` |
| 60 | `GET compliance/super-admin-overview` | `('SUPER_ADMIN')` | `platform.manage` |

**`backend/src/auction/auction.controller.ts` (3):**

| # | Endpoint | Current @Roles | New @RequiresPermission |
|---|---|---|---|
| 61 | `GET settlements` | `('OWNER','ADMIN','MANAGER')` | `auction.settle` |
| 62 | `PATCH settlements/:id/release` | `('OWNER','ADMIN','MANAGER')` | `auction.settle` |
| 63 | `POST settlements/:id/manual-settle` | `('OWNER','ADMIN')` | `auction.manual_settle` |

### Deliberate behavior-change log (everything else is strictly equivalent)

| Change | Effect | Source |
|---|---|---|
| `pawn_ticket.appraise` no longer available to generic STAFF | The one intentional tightening — any generic STAFF (and legacy roles) previously passed `('APPRAISER','STAFF','MANAGER','OWNER')` via the STAFF string | RESEARCH.md equivalence table + Assumption A2 (accepted) |
| `contract.sign` on `sign-staff` grants generic STAFF staff-side signing | STAFF base includes `contract.sign` by research-matrix design; previously only MANAGER/OWNER | RESEARCH.md matrix (STAFF base), endorsed in equivalence row 3 |
| `loan.collect` on `POST loan/applications` | Strict equivalence: no access change vs today. `loan.create` (semantic) would widen generic STAFF to loan-application creation — see DN-1 | RESEARCH.md equivalence row 4 palette |
| HR (`payroll.manage`, `attendance.manage`), INVENTORY_CUSTODIAN (`inventory.manage`, `pawn_ticket.view`), AUDITOR (`reports.view`, `tenant.view_audit`, `finance.manage`, `pawn_ticket.view`) gain first real guarded access | Net improvement — these roles were DENIED on all 63 endpoints today (not in any tuple) | RESEARCH.md findings |

## Task Breakdown (13 tasks, 5 waves)

> All tasks are independently verifiable and commit-sized. Per-project conventions: no source comments unless asked; snake_case DB columns / camelCase JS fields; NestJS modules as controller/service/module/dto; prefer Edit over Write for existing files; backend-first. Suggested commit prefix per task is noted.
> **Structure note (per REVIEW NIT-2):** 13 tasks exceed the 2-3 tasks/plan guidance. The internal 5-wave ordering, per-task commits, and independent per-task verify gates keep single-task context bounded (heaviest task is T9 at 1 source file + its spec; no task touches more than 3 files). Splitting into 3 plan files was considered and deferred — one sequential plan matches this phase's single-deliverable nature; revisit only if execution shows context pressure.

### Wave 1 — Schema baseline (migration FIRST)

<task type="auto" wave="1" id="T1">
  <name>Task T1: Schema baseline — v2.0 additive model additions to schema.prisma</name>
  <files>backend/prisma/schema.prisma</files>
  <action>
    STEP 0 (preflight, no edits yet): run `npx prisma validate`, `npx prisma migrate status`, and `npm test -- --runInBand`. Baseline must be green before any change; if `migrate status` reports unreachable Supabase, stop and surface a connectivity checkpoint (do not proceed).
    STEP 1: Edit schema.prisma to add exactly these elements (all `@@schema("public")`; `@map` snake_case per repo convention):
    - 4 new enums: `CustomerTier { STANDARD BRONZE SILVER GOLD VIP }`; `ApprovalStatus { PENDING APPROVED REJECTED CANCELLED }`; `ApprovalTargetType { APPRAISAL REDEMPTION LOAN_APPLICATION }`; `SignatureType { CANVAS TYPED UPLOADED }`. Reuse existing `KycStatus`/`KycIdType` (schema.prisma:869-888) — do NOT redefine.
    - `Permission`: id String @id @default(uuid()) @db.Uuid; name String @unique; group String; description String?; createdAt DateTime @default(now()); rolePermissions RolePermission[]; @@map("permissions").
    - `RolePermission`: id String @id @default(uuid()) @db.Uuid; role String; permissionId String @db.Uuid; permission Permission @relation(fields:[permissionId], references:[id], onDelete: Cascade); @@unique([role, permissionId]); @@index([role]); @@map("role_permissions").
    - `ApprovalRecord` (Phase 8 data only — NO runtime logic): id, pawnshopId String @db.Uuid, targetType ApprovalTargetType, targetId String, status ApprovalStatus @default(PENDING), amount Float?, requestedById String @db.Uuid, decidedById String? @db.Uuid, decidedAt DateTime?, decisionComment String?, createdAt/updatedAt; relations: pawnshop Pawnshop @relation(fields:[pawnshopId], references:[id]), requestedBy Profile @relation("ApprovalRequestedBy", fields:[requestedById], references:[id], onDelete: Restrict), decidedBy Profile? @relation("ApprovalDecidedBy", fields:[decidedById], references:[id]); @@index([pawnshopId, status]); @@index([targetType, targetId]); @@map("approval_records").
    - `CustomerKyc` (Phase 9 data only): id, customerId String @unique @db.Uuid, pawnshopId String @db.Uuid, status KycStatus @default(NOT_SUBMITTED), fullName, contactNumber, address, idType KycIdType, idNumber, idFrontUrl, idBackUrl String?, selfieUrl String?, verificationData Json?, reviewedBy String? @db.Uuid, reviewedAt DateTime?, rejectionReason String?, createdAt/updatedAt; relations customer Customer + pawnshop Pawnshop; @@index([pawnshopId, status]); @@map("customer_kyc").
    - `CustomerTierHistory` (Phase 12 data only): id, customerId String @db.Uuid, fromTier CustomerTier?, toTier CustomerTier, reason String, changedById String? @db.Uuid, changedAt DateTime @default(now()); relation customer Customer; @@index([customerId, changedAt]); @@map("customer_tier_history").
    - Additive columns on existing models:
      - `Customer` (schema.prisma:46-63): `tier CustomerTier @default(STANDARD)` (map "tier" — DO NOT touch legacy `loyaltyTier`; Phase 12 retires it), `kycStatus KycStatus @default(NOT_SUBMITTED)` (map "kyc_status"), `customerKyc CustomerKyc?` relation.
      - `Receipt` (schema.prisma:1310-1338): `customerId String? @db.Uuid` (map "customer_id") + `customer Customer? @relation(fields:[customerId], references:[id], onDelete: SetNull)` + `@@index([customerId])`. Nullable on purpose (polymorphic receipts).
      - `PawnshopDocument` (schema.prisma:1670-1695): `hasViewed Boolean @default(false)` (map "has_viewed"), `viewedAt DateTime?` (map "viewed_at"), `viewedBy String? @db.Uuid` (map "viewed_by").
      - `LoanContract` (schema.prisma:822-846): `customerSignatureType SignatureType @default(TYPED)`, `customerSignatureImageUrl String?`, `customerSignatureImageMime String?`, `staffSignatureType SignatureType @default(TYPED)`, `staffSignatureImageUrl String?`, `staffSignatureImageMime String?`. Existing canvas/typed `customerSignature`/`staffSignature` columns stay untouched.
    STEP 2: `npx prisma validate` then `npx prisma generate` (multiSchema preview is already enabled; regenerating the client is required before any code referencing new models compiles).
    Commit: `feat(07): v2.0 schema baseline models and additive columns`
  </action>
  <verify>
    <automated>npx prisma validate; if ($?) { npx prisma generate }; if ($?) { npm test -- --runInBand }</automated>
  </verify>
  <done>
    schema.prisma contains all 4 new enums, 5 new models, and the 12 additive columns (+4 relation back-refs on existing models) exactly as specified (no renames, no type changes, no destructive edits); `prisma validate` passes; regenerated client compiles; baseline unit suite still green.
  </done>
</task>

<task type="auto" wave="1" id="T2">
  <name>Task T2: Create the single batched v2 migration (schema DDL + catalog seed data)</name>
  <files>backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql</files>
  <action>
    Create ONE migration directory `<ts>_v2_schema_baseline` (timestamp per existing migrations: use the 14-digit `YYYYMMDDHHMMSS` form, e.g. `20260731120000_v2_schema_baseline` — the repo contains both 14-digit prefixes like `20260117154838_add_roles_and_branches` and 8-digit ones; 14-digit is Prisma's canonical generation format) containing `migration.sql`:
    STEP 1 — DDL: generate with `npx prisma migrate diff --from-schema-datasource "env(\"DATABASE_URL\")" --to-schema-datamodel prisma/schema.prisma --script` (datasource argument quoted for PowerShell argument-mode parsing; introspects the live DB; no shadow DB needed). Write the output to migration.sql. INSPECT the generated diff in full: it must contain ONLY CREATE TYPE / CREATE TABLE / ALTER TABLE ... ADD COLUMN / CREATE INDEX / INSERT — no DROP, no ALTER COLUMN TYPE, no UPDATE or DELETE of existing rows, nothing touching `profiles`. If the diff contains anything else (live-DB ↔ schema.prisma drift), STOP and surface a checkpoint — do not proceed to T3. If connectivity fails, hand-write the DDL following the RESEARCH.md schema-baseline change list and the existing migration SQL style (CREATE TYPE before columns that use them; CREATE TABLE; ALTER TABLE ADD COLUMN; CREATE INDEX).
    STEP 2 — Catalog seed data (append to the same file, after DDL):
      - 37 permission rows: `INSERT INTO permissions (name, "group", description) VALUES ... ON CONFLICT (name) DO NOTHING;` — every value from the PERMISSIONS catalog above; `group` = prefix before first `.`; note `"group"` must be double-quoted (reserved word).
      - 101 role→permission rows from the role matrix: `INSERT INTO role_permissions (role, permission_id) SELECT v.role, p.id FROM (VALUES (...),(...)) AS v(role, permission_name) JOIN permissions p ON p.name = v.permission_name ON CONFLICT (role, permission_id) DO NOTHING;`
    STEP 3: verify the file locally. Do NOT run `migrate deploy` in this task (blocking human gate is T3).
    Commit: `feat(07): batched v2 schema baseline migration with permission catalog seed`
  </action>
  <verify>
    <automated>npx prisma validate; if ($?) { npx prisma migrate status }; if ($?) { $m = Get-ChildItem -Path 'prisma/migrations' -Directory -Filter '*_v2_schema_baseline' | Select-Object -First 1; if (-not $m) { Write-Error 'v2_schema_baseline migration folder not found'; exit 1 }; $f = Join-Path $m.FullName 'migration.sql'; $c1 = @(Select-String -Path $f -Pattern 'INSERT INTO permissions' -SimpleMatch).Count; $c2 = @(Select-String -Path $f -Pattern 'INSERT INTO role_permissions' -SimpleMatch).Count; if ($c1 -ne 1 -or $c2 -ne 1) { Write-Error "catalog INSERT statement counts wrong: permissions=$c1 role_permissions=$c2 (expected 1/1)"; exit 1 } }</automated>
  </verify>
  <done>
    migration.sql exists with (a) complete additive DDL for all 4 enums + 5 models + 12 columns (+4 relation back-refs), (b) 37-name permission INSERT with ON CONFLICT DO NOTHING, (c) role_permissions INSERT joining by name with ON CONFLICT DO NOTHING; `prisma validate` passes; `prisma migrate status` confirms connectivity baseline; nothing applied yet.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking" wave="1" id="T3">
  <name>Task T3: Human gate — approve applying the batched migration to live Supabase</name>
  <what-built>
    The single batched migration `backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql` (all v2.0 schema elements + permission catalog seed rows).
  </what-built>
  <how-to-verify>
    1. Read `backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql` in full.
    2. Confirm it is PURELY ADDITIVE: only CREATE TYPE / CREATE TABLE / ALTER TABLE ... ADD COLUMN / CREATE INDEX / INSERT ... ON CONFLICT DO NOTHING. Reject if it contains DROP, ALTER COLUMN TYPE, DELETE, UPDATE of existing rows, or anything touching `profiles` / `profiles_staff_type_check`.
    3. Confirm the catalog section has exactly 37 permission names and the role→permission rows for all 10 roles per the matrix in this plan.
    4. Confirm the migration will be applied with `npx prisma migrate deploy` (NOT `migrate dev`, NOT `db push`, NOT `migrate reset` — the destructive `seed.ts` must never run).
  </how-to-verify>
  <resume-signal>Type "approved" to allow T4 to run `prisma migrate deploy`, or describe the issue to fix.</resume-signal>
</task>

<task type="auto" wave="1" id="T4">
  <name>Task T4: Apply migration and assert catalog rows</name>
  <files>backend/prisma/migrations/<ts>_v2_schema_baseline/migration.sql</files>
  <action>
    Run `npx prisma migrate deploy` (applies the batched migration to Supabase; safe, additive, idempotent by construction). Then `npx prisma generate`. Then assert catalog contents via `npx prisma db execute --stdin` with: `SELECT count(*) FROM permissions;` (expect 37) and `SELECT count(*) FROM role_permissions;` (expect 101). Finally `npx prisma migrate status` must report the schema up to date with no pending migrations. Never run `prisma migrate reset` or `db push` (Pitfall 6).
    Commit: `feat(07): apply v2 schema baseline migration`
  </action>
  <verify>
    <automated>npx prisma migrate deploy; if ($?) { npx prisma generate }; if ($?) { npx prisma migrate status }; if ($?) { npx tsx -e "(async () => { const { PrismaClient } = await import('@prisma/client'); const c = new PrismaClient(); const p = await c.permission.count(); const r = await c.rolePermission.count(); console.log('permissions=' + p + ' role_permissions=' + r); if (p !== 37 || r !== 101) { process.exit(1); } })();" }</automated>
  </verify>
  <done>
    `migrate deploy` exits 0; `migrate status` clean; permission count = 37 and role_permission count = 101 in the live DB; @prisma/client regenerated with the new models.
  </done>
</task>

### Wave 2 — Constants + seed

<task type="auto" wave="2" id="T5">
  <name>Task T5: PERMISSIONS const + ROLE_PERMISSIONS matrix + @RequiresPermission decorator</name>
  <files>backend/src/common/permissions/permissions.const.ts, backend/src/common/decorators/requires-permission.decorator.ts</files>
  <action>
    Create `permissions.const.ts`: the flat typed const with exactly the 37 values in this plan (resource.action naming; group derivable as prefix before the first dot), exported `as const`, plus `export type PermissionName = keyof typeof PERMISSIONS;` plus `export const ROLE_PERMISSIONS: Record&lt;string, PermissionName[]&gt;` holding the 10-role matrix from this plan (SUPER_ADMIN/OWNER/ADMIN/MANAGER/HR/STAFF/CASHIER_TELLER/APPRAISER/INVENTORY_CUSTODIAN/AUDITOR). No string literals elsewhere — decorators and seed import from here (Pitfall 2).
    Create `requires-permission.decorator.ts`: `PERMISSIONS_KEY = 'permissions'` + `RequiresPermission(...permissions: PermissionName[])` via SetMetadata, mirroring `roles.decorator.ts` exactly. The typed parameter makes unknown permission strings a compile error.
    Do NOT touch `roles.decorator.ts` (legacy path stays).
    Commit: `feat(07): permission catalog const and RequiresPermission decorator`
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    tsc compiles; const has exactly 37 distinct values; PermissionName type derivable; decorator rejects non-catalog values at compile time.
  </done>
</task>

<task type="auto" wave="2" id="T6">
  <name>Task T6: Standalone idempotent permission seed script</name>
  <files>backend/prisma/seed-permissions.ts</files>
  <action>
    Create `backend/prisma/seed-permissions.ts` (run with `npx tsx prisma/seed-permissions.ts`). It imports PERMISSIONS + ROLE_PERMISSIONS from `../src/common/permissions/permissions.const`. For each permission: `prisma.permission.upsert({ where: { name }, update: {}, create: { name, group: name.split('.')[0] } })`. Then load `prisma.permission.findMany({ select: { id, name } })` into a name→id map and `prisma.rolePermission.createMany({ data: matrix rows, skipDuplicates: true })`. Print created/skipped counts. The script must be safe to re-run any number of times (pure upsert/createMany — NO deleteMany anywhere). It is a DEV convenience; production data ships inside the migration (T2). Do NOT modify `seed.ts` (destructive: deleteMany on 10 tables, seed.ts:14-23 — never run against prod).
    Commit: `feat(07): idempotent standalone permission seed script`
  </action>
  <verify>
    <automated>npx tsx prisma/seed-permissions.ts; if ($?) { npx tsx prisma/seed-permissions.ts }</automated>
  </verify>
  <done>
    First run creates rows and exits 0; second run exits 0 with zero new inserts (idempotent); row counts remain 37 permissions / 101 role_permissions.
  </done>
</task>

### Wave 3 — Guard rewrite (tests FIRST per Nyquist)

<task type="auto" wave="3" id="T7">
  <name>Task T7: Write guard + catalog + service test specs (RED)</name>
  <files>backend/src/common/guards/rbac.guard.spec.ts, backend/src/common/permissions/permissions-catalog.spec.ts, backend/src/common/permissions/permissions.service.spec.ts</files>
  <action>
    Write three spec files (jest + ts-jest, existing config; rootDir src, testRegex .spec.ts). They define the contracts the next two tasks implement — they must FAIL now (guard constructor has 3 deps today; service and migration file do not exist yet):
    1. `rbac.guard.spec.ts` — decision matrix for the target guard contract `(reflector, prisma, authUser, permissionService)` with mocked PrismaService (`profile.findUnique`), mocked AuthUserService (`getUserIdFromAuthHeader`), mocked PermissionService (`resolveEffectivePermissions`). Cases: (a) @Public → allow without user resolution; (b) no metadata → allow + request.user has { id, role, staffType, pawnshopId }; (c) SUPER_ADMIN + @RequiresPermission → allow (bypass, SC4); (d) SUPER_ADMIN + @Roles → allow; (e) legacy profile `role='CASHIER_TELLER'`, staffType null, @RequiresPermission(pawn_ticket.redeem), permissionService resolves for normalized (STAFF, CASHIER_TELLER) → allow (SC3, normalization); (f) normalized `role='STAFF'` + staffType 'CASHIER_TELLER' → same allow; (g) generic STAFF (no staffType) + @RequiresPermission(pawn_ticket.appraise) → 403 Forbidden (tightening); (h) APPRAISER + appraise → allow; (i) @Roles-only endpoint (no permission decorator): MANAGER + @Roles('MANAGER','OWNER') → allow; STAFF + same → 403 (fallback fail-closed); (j) both decorators: permission path wins (held permission allows even if role not in @Roles tuple); (k) invalid/missing token → 401; (l) unknown role value → resolveEffectivePermissions returns empty → 403 (fail closed). Assert the exception type and that request.user carries staffType when allowed.
    2. `permissions-catalog.spec.ts` — (i) every PERMISSIONS value appears in the migration SQL file (read `path.resolve(__dirname, '../../../prisma/migrations')` for the `*_v2_schema_baseline/migration.sql`) and vice versa (exactly 37 names); (ii) every ROLE_PERMISSIONS entry references only const values; (iii) migration role_permissions row count equals the matrix row count (101); (iv) 63-site equivalence scan: recursively read `src/**/*.controller.ts`, extract every @Roles(...) tuple and every @RequiresPermission(...) call; assert (a) every @Roles tuple is one of the 12 known tuples, (b) zero endpoints carry @Roles WITHOUT @RequiresPermission (one-pass completeness), (c) for each endpoint the required permission(s) are held by every role in its old tuple per ROLE_PERMISSIONS — with EXACTLY ONE allowed holder-coverage exception: the appraise endpoint (old tuple (MANAGER, OWNER, STAFF) → `pawn_ticket.appraise`; generic STAFF lacks it — the deliberate tightening). No other endpoint may violate strict holder coverage; any violation fails the scan. This spec is the machine proof of "nothing regresses" (Pitfall 1).
    3. `permissions.service.spec.ts` — mocked prisma: `resolveEffectivePermissions('STAFF','CASHIER_TELLER')` calls `rolePermission.findMany` with `role: { in: ['STAFF','CASHIER_TELLER'] }` and returns the union set; staffType null → `in: ['STAFF']` only; unknown role → empty set (fail closed).
    Commit: `test(07): guard and catalog contract specs (red)`
  </action>
  <verify>
    <automated>npx jest src/common/guards/rbac.guard.spec.ts --runInBand; npx jest src/common/permissions/permissions-catalog.spec.ts --runInBand; npx jest src/common/permissions/permissions.service.spec.ts --runInBand</automated>
  </verify>
  <done>
    All three spec files exist and FAIL for the expected reasons (missing service / wrong constructor arity / missing migration artifact) — the RED state is captured in the commit.
  </done>
</task>

<task type="auto" wave="3" id="T8">
  <name>Task T8: PermissionService + module wiring (GREEN for service)</name>
  <files>backend/src/common/permissions/permissions.service.ts, backend/src/common/permissions/permissions.module.ts, backend/src/common/common.module.ts</files>
  <action>
    Create `permissions.service.ts` implementing the contract pinned by T7: `resolveEffectivePermissions(role: string, staffType?: string | null): Promise&lt;Set&lt;string&gt;&gt;` — `prisma.rolePermission.findMany({ where: { role: { in: [role, ...(staffType ? [staffType] : [])] } }, select: { permission: { select: { name: true } } } })` and return the set of names. Per-request DB read (no cache — SC2 freshness, TOCTOU mitigation). Unknown role → empty set → guard fail-closed.
    Create `permissions.module.ts` (provider + export PermissionService). Register it in the GLOBAL `common.module.ts` providers + exports (CommonModule is @Global, imported first in app.module.ts:33, so the APP_GUARD-registered RbacGuard can inject it).
    Commit: `feat(07): PermissionService per-request effective-permission resolution`
  </action>
  <verify>
    <automated>npx jest src/common/permissions/permissions.service.spec.ts --runInBand; if ($?) { npx tsc --noEmit }</automated>
  </verify>
  <done>
    Service spec GREEN; tsc compiles; service queries role ∪ staffType and unions names; module exported via CommonModule.
  </done>
</task>

<task type="auto" wave="3" id="T9">
  <name>Task T9: RbacGuard rewrite — staffType-aware, dual-mode, catalog-driven (GREEN for guard)</name>
  <files>backend/src/common/guards/rbac.guard.ts</files>
  <action>
    Rewrite `canActivate` per the RESEARCH.md P3 resolution order, preserving existing behavior except where the phase mandates change:
    1. @Public → allow (unchanged).
    2. Resolve userId via AuthUserService (unchanged; invalid token → 401).
    3. Profile load: ADD `staffType` to the select: `select: { role: true, staffType: true, pawnshopId: true }`.
    4. Normalize legacy role values in a private helper (one authoritative spot, mirrors app.service.ts:493-502 semantics): if role ∈ {CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR} → treat as role='STAFF' + staffType = legacy role (unless staffType already set). This kills the per-user inconsistency from migration 20260324 (Pitfall 3).
    5. SUPER_ADMIN → populate request.user { id, role, staffType, pawnshopId } and allow (bypass BEFORE any permission lookup — SC4).
    6. No @Roles AND no @RequiresPermission metadata → populate request.user (now including staffType) and allow (default-open preserved for undecorated GET endpoints — documented product behavior, out of scope).
    7. @RequiresPermission present (PERMISSIONS_KEY) → effective = await permissionService.resolveEffectivePermissions(normalizedRole, staffType); allow iff every required permission is in effective; else ForbiddenException listing the missing permission(s). Permission path takes precedence when both decorators present.
    8. Only @Roles present (legacy fallback) → exact-match path exactly as today (fail-closed; keeps the guard dual-mode for unconverted/future endpoints).
    Constructor gains 4th dep `permissionService: PermissionService` (DI resolves from global CommonModule). Preserve the existing Logger and exception semantics. Do NOT add tenant checks here — pawnshopId scoping stays in PawnshopGuard + services (Pitfall 4).
    Commit: `feat(07): staffType-aware dual-mode RbacGuard with catalog resolution`
  </action>
  <verify>
    <automated>npx jest src/common/guards/rbac.guard.spec.ts --runInBand; if ($?) { npx tsc --noEmit }</automated>
  </verify>
  <done>
    Guard spec GREEN (full 12-case decision matrix incl. normalization, bypass, fallback, fail-closed); tsc compiles; request.user shape gains staffType; no endpoint behavior changed yet by this task alone (decorators unchanged until Wave 4).
  </done>
</task>

### Wave 4 — One-pass endpoint migration (grouped by controller domain; 3 parallel commits)

> Conversion rule for every site: replace `@Roles(...)` with `@RequiresPermission(PERMISSIONS['...'])` using the migration matrix above; the `Roles` import is removed from the file only when the file no longer uses it. Do NOT touch `@AuditLog`, `@RequiresCompliance`, `@Throttle`, `@HttpCode`, routes, DTOs, or service calls. Keep the code free of permission string literals (always via the PERMISSIONS const — Pitfall 2). No comments added.

<task type="auto" wave="4" id="T10">
  <name>Task T10: Convert loan-domain controllers — 26 sites (matrix rows 1-26)</name>
  <files>backend/src/loan/pawn-ticket.controller.ts, backend/src/loan/loan.controller.ts</files>
  <action>
    Pawn-ticket (10): POST pawn-tickets → pawn_ticket.create; POST :id/submit-for-approval → pawn_ticket.submit_approval; POST :id/manager-approve → pawn_ticket.approve; POST :id/decline → pawn_ticket.decline; GET pending-approval → pawn_ticket.approve; POST :id/approve → pawn_ticket.approve; POST :id/appraise → pawn_ticket.appraise (deliberate tightening); POST :id/redeem → pawn_ticket.redeem; GET customers/:customerId/tier → customer.view_history; POST :id/send-to-auction → pawn_ticket.send_to_auction.
    Loan (16): POST applications → loan.collect (DN-1 default); PATCH applications/:id/status → loan.manage; DELETE applications/:id → loan.manage; POST eligibility/check → loan.create; POST :loanId/schedule/generate → loan.create; PATCH schedule/payment → loan.manage; POST penalties/calculate → loan.collect; PATCH penalties/:id/waive → loan.manage; POST penalties/manual → loan.manage; POST forfeitures/process → loan.manage; POST forfeitures/:ticketId/queue-auction → pawn_ticket.send_to_auction; POST :loanId/disburse → loan.collect; POST renew → loan.collect; POST payments → loan.collect; POST contracts/:applicationId/generate → loan.manage; PATCH contracts/:applicationId/sign-staff → contract.sign (deliberate widening).
    Commit: `refactor(07): migrate loan domain endpoints to RequiresPermission (26 sites)`
  </action>
  <verify>
    <automated>npx tsc --noEmit; if ($?) { $hits = @(Select-String -Path 'src/loan/*.controller.ts' -Pattern '@Roles' -SimpleMatch); if ($hits.Count -ne 0) { Write-Error "still $($hits.Count) @Roles sites in src/loan"; exit 1 } }</automated>
  </verify>
  <done>
    tsc compiles; PowerShell Select-String sweep over `src/loan/*.controller.ts` returns 0 `@Roles` hits (verify command exits 0 only on zero matches); all 26 sites declare @RequiresPermission with the matrix values (import from PERMISSIONS const); the two files' total @RequiresPermission count = 26.
  </done>
</task>

<task type="auto" wave="4" id="T11">
  <name>Task T11: Convert platform-domain controllers — 25 sites (matrix rows 27-51)</name>
  <files>backend/src/tenant-governance/tenant-governance.controller.ts, backend/src/app.controller.ts</files>
  <action>
    Tenant-governance (24): 20 SUPER_ADMIN sites (pawnshops/metadata, support-access request/approve/revoke/audit/status/requests, onboarding/configure, branding, client-registrations review ×2, pawnshops toggle-status/settings/delete/create, invitations, analytics/platform, subscriptions extend-trial/upgrade-tier/status) → platform.manage; GET audit/history → tenant.view_audit; POST branches + PATCH branches/:branchId → tenant.manage_branches; POST subscriptions/request-extension → tenant.manage.
    App (1): GET pawnshops → platform.manage.
    Commit: `refactor(07): migrate platform domain endpoints to RequiresPermission (25 sites)`
  </action>
  <verify>
    <automated>npx tsc --noEmit; if ($?) { $hits = @(Select-String -Path 'src/tenant-governance/*.controller.ts','src/app.controller.ts' -Pattern '@Roles' -SimpleMatch); if ($hits.Count -ne 0) { Write-Error "still $($hits.Count) @Roles sites in platform domain"; exit 1 } }</automated>
  </verify>
  <done>
    tsc compiles; PowerShell Select-String sweep over `src/tenant-governance/*.controller.ts` + `src/app.controller.ts` returns 0 `@Roles` hits (verify command exits 0 only on zero matches); all 25 sites declare @RequiresPermission with the matrix values; combined count = 25.
  </done>
</task>

<task type="auto" wave="4" id="T12">
  <name>Task T12: Convert compliance + auction controllers — 12 sites (matrix rows 52-63)</name>
  <files>backend/src/compliance/compliance.controller.ts, backend/src/auction/auction.controller.ts</files>
  <action>
    Compliance (9): POST documents → compliance.manage_documents; GET documents → compliance.view; PUT documents/:id/verify → platform.manage; POST documents/:id/renew → compliance.manage_documents; GET / → compliance.view; GET score → compliance.view; GET pending-reviews → platform.manage; GET all-pawnshops → platform.manage; GET super-admin-overview → platform.manage.
    Auction (3): GET settlements → auction.settle; PATCH settlements/:id/release → auction.settle; POST settlements/:id/manual-settle → auction.manual_settle.
    This task completes the one-pass conversion, so the FULL catalog spec must go green here.
    Commit: `refactor(07): migrate compliance+auction endpoints to RequiresPermission (12 sites); one-pass conversion complete`
  </action>
  <verify>
    <automated>npx tsc --noEmit; if ($?) { npx jest src/common/permissions/permissions-catalog.spec.ts --runInBand }; if ($?) { $hits = @(Select-String -Path 'src/loan/*.controller.ts','src/tenant-governance/*.controller.ts','src/compliance/*.controller.ts','src/auction/*.controller.ts','src/app.controller.ts' -Pattern '@Roles' -SimpleMatch); if ($hits.Count -ne 0) { Write-Error "still $($hits.Count) @Roles sites across the 6 controllers"; exit 1 } }</automated>
  </verify>
  <done>
    tsc compiles; full-controller Select-String sweep (all 6 controllers) returns 0 `@Roles` hits — 63/63 converted; permissions-catalog spec GREEN: 37 const values ↔ migration SQL, matrix rows = 101, all 63 sites have @RequiresPermission, no @Roles-only endpoints, tuple-holder equivalence holds with only the single documented tightening (appraise) and the recorded widenings.
  </done>
</task>

### Wave 5 — e2e + full verification

<task type="auto" wave="5" id="T13">
  <name>Task T13: e2e chain tests + full verification + frontend no-change confirmation</name>
  <files>backend/test/app.e2e-spec.ts</files>
  <action>
    PRE-STEP (token/write-access availability — per REVIEW MINOR-9): confirm real Supabase JWTs are available for each actor — SUPER_ADMIN, OWNER, ADMIN, MANAGER, generic STAFF, APPRAISER, CASHIER_TELLER, INVENTORY_CUSTODIAN — plus write (UPDATE) access to the dev DB for the SC2 proof. If tokens do not exist, create one test user per role via Supabase Dashboard → Authentication → Users (or the app's sign-up flow) BEFORE starting the manual checklist; record token provenance in the SUMMARY. The e2e 401 chain (no token) and the automated suites below do NOT depend on this; only the manual curl recipe and the SC2 UPDATE proof do.
    Extend `test/app.e2e-spec.ts` (keep the existing GET / public test): add 401 chain tests that require NO Supabase mocking — (a) `GET /pawn-tickets/pending-approval` without Authorization → 401 (path is PawnshopGuard-exempt at pawnshop.guard.ts:45, so RbacGuard 401s before any DB call); (b) `GET /compliance/documents` without Authorization → 401 (exempt prefix `/compliance`, pawnshop.guard.ts:31). Add a comment-free assertion on response status. The 403/200 decision matrix is deliberately unit-covered by rbac.guard.spec.ts (full-chain 403 would require DB/mocked PrismaService plumbing — not worth the flake surface).
    Then run the complete verification gate (see Verification Loop section): full unit suite, e2e, `npm run build` (runs scripts/prisma-generate-safe.js + nest build), `npx prisma migrate status` clean, seed script idempotency re-run, and the data-driven SC2 proof: in the dev DB run `UPDATE role_permissions SET permission_id = (SELECT id FROM permissions WHERE name = 'reports.view') WHERE role = 'HR';` (or similar harmless flip), confirm a documented curl response changes with NO code change, then revert the UPDATE. Record the manual curl checklist results in the SUMMARY.
    Record the FRONTEND NO-CHANGE confirmation with evidence: (1) `frontend/src/App.tsx:290-546` and `frontend/src/components/StaffMatrix.tsx:90-101` already normalize role→staffType and write `role:'STAFF'`+`staff_type`; (2) the backend change to `request.user` is additive (staffType added; frontend never consumes request.user — it calls HTTP APIs); (3) all 63 endpoints keep identical routes/shapes; (4) access corrections (CASHIER_TELLER redeem now allowed, etc.) are backend-enforced — the frontend's existing role-based button gating remains consistent (STAFF never gained appraise; UI hides it accordingly).
    Commit: `test(07): e2e 401 chain tests; full phase verification`
  </action>
  <verify>
    <automated>npm test -- --runInBand; if ($?) { npm run test:e2e -- --runInBand }; if ($?) { npm run build }</automated>
  </verify>
  <done>
    Full unit suite green (24 spec files incl. 3 new), e2e green (public + 401 chain), `npm run build` compiles, `prisma migrate status` clean, catalog counts 37/101, seed script idempotent, SC2 data-driven proof executed and reverted, frontend no-change confirmation recorded, manual curl checklist complete, `07-01-SUMMARY.md` written.
  </done>
</task>

## Verification Loop

**Test infrastructure (verified):** jest ^29.5.0 + ts-jest, inline config in `backend/package.json` (rootDir `src`, testRegex `.*\.spec\.ts$`); e2e config `test/jest-e2e.json`; 21 existing spec files; supertest present. New spec files: `rbac.guard.spec.ts`, `permissions-catalog.spec.ts`, `permissions.service.spec.ts` (created RED in T7, GREEN by T9).

| Gate | Command | When | Maps to |
|------|---------|------|---------|
| Guard decision matrix (12 cases) | `npx jest src/common/guards/rbac.guard.spec.ts --runInBand` | After T7 (RED) and T9 (GREEN); re-run at T13 | SC1, SC3, SC4 |
| Catalog consistency + 63-site equivalence scan | `npx jest src/common/permissions/permissions-catalog.spec.ts --runInBand` | After T7 (RED); GREEN at T12 | SC1, SC2, M1 (mandate), Pitfalls 1-2 |
| One-pass completeness sweep (per-wave, PowerShell — MAJOR-1: `rg` is NOT installed on this machine) | `Select-String -Path 'src/<domain>/*.controller.ts' -Pattern '@Roles' -SimpleMatch` → 0 hits, else `exit 1` (complete commands in T10/T11/T12 `<verify>`) | T10, T11, T12 | M1 (mandate), Pitfall 1 |
| Service query contract | `npx jest src/common/permissions/permissions.service.spec.ts --runInBand` | T8, T13 | SC2 |
| Schema syntax + client regen | `npx prisma validate` / `npx prisma generate` | T1, T2, T4 | M2 |
| Migration apply + catalog rows | `npx prisma migrate deploy` + `npx prisma migrate status` + count assert via `npx tsx -e` (permission.count() === 37, rolePermission.count() === 101, else exit 1 — command in T4 `<verify>`) | T4 | M2, Pitfall 6 |
| Seed idempotency | `npx tsx prisma/seed-permissions.ts` × 2 (second run zero new rows) | T6, T13 | A4 |
| Compile gates | `npx tsc --noEmit` (per task) / `npm run build` (T13) | Every code task | — |
| Full unit suite | `npm test -- --runInBand` | Baseline T1, final T13 | regression guard |
| e2e chain (public + 401) | `npm run test:e2e -- --runInBand` | T13 | SC1 (chain registration) |
| SC2 data-driven proof | `UPDATE role_permissions ...` → curl flips → revert | T13 | SC2 (literal) |
| Manual curl checklist | See below | T13 (human) | SC1, SC3, SC4 end-to-end |

**Manual curl recipe (T13, human, dev DB):** with a real Supabase JWT for each actor (token + dev-DB write access confirmed in the T13 PRE-STEP — do not run this recipe until those exist):
- MANAGER token → `GET /pawn-tickets/pending-approval` (header `pawnshop-id: <uuid>`) → 200.
- Generic STAFF token → `POST /pawn-tickets/:id/appraise` → 403 (tightening holds).
- APPRAISER token → same call → 200 (SC3: staffType now honored).
- CASHIER_TELLER token → `POST /pawn-tickets/:id/redeem` → 200 (previously 403 for normalized users — SC3 fix).
- SUPER_ADMIN token → `GET /tenant-governance/pawnshops/metadata` → 200 (SC4 bypass).
- No token → any guarded path → 401.
- INVENTORY_CUSTODIAN token → `GET /pawn-tickets/pending-approval` → 403 (no approval.view_queue grant — correct).

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Endpoint opens up during conversion (default-open guard path; a site left decorator-less = open to any authenticated user) | high | Dual-mode guard keeps @Roles fallback; one-pass conversion completes within the phase (T10-T12); catalog spec statically asserts zero @Roles-only endpoints and 63/63 conversion — the commit gate |
| staffType fail-open persists (generic STAFF over-granted) | high | Guard normalization step (T9) + staffType catalog rows + guard spec cases (g) and (l); appraise tightening is the only deliberate drop |
| Mapping mistake in the 63-site conversion breaks an endpoint (403 for everyone) | medium | Equivalence scan asserts every tuple role holds the mapped permission; compile gate per task; manual curl recipe covers the high-traffic paths |
| Migration ordering/shadow-DB issues on Supabase (P3014; `migrate dev` shadow failure) | medium | `prisma migrate deploy` only (no shadow needed); DDL generated via `migrate diff --from-schema-datasource` (no shadow); destructive `seed.ts`/`db push`/`migrate reset` never run; T3 blocking human gate before apply |
| Cross-tenant leakage via new models (ApprovalRecord/CustomerKyc/CustomerTierHistory) | high | Every new model carries pawnshopId; Phase 7 ships no service code reading them (data-only), so no new query surface; PawnshopGuard EXEMPT list unchanged — later phases must not extend it (documented handoff in SUMMARY) |
| Guard bypass via role-string tampering / stale claims | medium | Permissions resolved from DB catalog by profile lookup per request; JWT carries only the user id (never roles/permissions) |
| TOCTOU on catalog edits | low | Per-request DB resolution, no cache — edits take effect next request (also satisfies SC2) |
| RLS bypass via service-role connection for new tables | medium | By design: app-layer guard is the authority; RLS hardening for KYC documents is Phase 9 (KYC-05) — out of scope here, documented |
| Seed script/destructive seed confusion | medium | Permissions seed via migration INSERTs (prod) + standalone `seed-permissions.ts` (dev); `seed.ts` untouched and flagged never-run-against-prod in SUMMARY |
| Node 26 / Prisma 5.22 deprecation warnings | low | Zero new deps; existing toolchain; `prisma generate` + `migrate` verified in T1 preflight |

## Threat Model

### Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client (web/auction/mobile) → API | Untrusted bearer JWT + pawnshop-id header cross here; authorization decisions are made app-side |
| API → Supabase Postgres | Prisma service-role connection BYPASSES RLS — app-layer guards are the sole authority (by design) |
| catalog rows (permissions/role_permissions) | Reference data editable at runtime; enforcement must read it fresh per request |

### STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-07-01 | Elevation | RbacGuard / PermissionService | high | mitigate | Permissions resolved from DB catalog keyed by profile lookup; JWT never carries role/permission claims (only user id) |
| T-07-02 | Information disclosure | ApprovalRecord / CustomerKyc / CustomerTierHistory (later phases) | high | mitigate | pawnshopId column on every new model; Phase 7 ships zero service reads of these tables; PawnshopGuard EXEMPT list unchanged; handoff note enforces service-level scoping in Phases 8/9/12 |
| T-07-03 | Elevation | default-open guard path (no metadata → allow) | high | mitigate | One-pass conversion of all 63 sites in-wave; static equivalence scan (catalog spec) asserts no endpoint left decorator-less; @Roles fallback kept fail-closed |
| T-07-04 | Tampering | role_permissions catalog | low | mitigate | Per-request DB reads (no cache): catalog edits take effect on the next request; no TOCTOU window beyond the in-flight request |
| T-07-05 | Elevation | staffType mixed-state profiles | high | mitigate | Guard normalizes legacy role values (CASHIER_TELLER/APPRAISER/INVENTORY_CUSTODIAN/AUDITOR → STAFF+staffType) before resolution; guard spec covers both profile shapes; seeded staffType catalog rows |
| T-07-06 | Elevation | generic STAFF over-grant | high | mitigate | StaffType rows grant specializations over STAFF base; appraise tightened; fail-closed empty-set for unknown roles (guard spec case l) |
| T-07-07 | (design) | RLS bypass via service-role connection | medium | accept | Documented architecture: app-layer enforcement; Phase 9 owns RLS hardening (KYC-05); no new Supabase policies reference role_permissions (Pitfall 5) |
| T-07-08 | Tampering | migration/seed pipeline | medium | mitigate | migrate deploy only; ON CONFLICT DO NOTHING idempotency; standalone upsert seed script; T3 blocking human gate before live apply; destructive seed.ts never pointed at prod |

## Out of Scope (owned by later phases — DO NOT plan or implement here)

- **Phase 8** — Approval workflows: ApprovalRecord runtime (creation/queue/decision endpoints), RBAC-03..06, unified approval queue UI, threshold config. Phase 7 only adds the model + `approval.*` catalog rows.
- **Phase 9** — KYC logic: CustomerKyc runtime (submission/review endpoints), KYC gates on ticket create/approve/disburse (KYC-03/04), RLS hardening of `bidder_kyc`/`kyc-documents` (KYC-05). Phase 7 only adds the model + `kyc.*` rows + `Customer.kycStatus`.
- **Phase 10** — Onboarding gate: consuming `hasViewed/viewedAt/viewedBy`, view-before-approve modal logic, REJECTED/ACTION_REQUIRED aggregation. Phase 7 only adds the columns.
- **Phase 11** — Contract upgrade: signature-image upload endpoint + validation (mime/size) + persistence, item-specific redemption terms, liability clauses. Phase 7 only adds the 6 metadata columns.
- **Phase 12** — Tiering logic: tier computation/recompute, tier history writes, `receipt.customerId` backfill, retirement of legacy `loyaltyTier` (writers on it stay untouched in Phase 7).
- Undecorated (default-open) GET endpoints — unchanged; closing them is a product decision outside this phase.
- Service-level role checks (e.g., `tenant-governance.service.ts:621-642` allow-list, `app.service.ts` requireAdmin) — unchanged this phase.
- Dead `enum Role` (schema.prisma:392-400) removal — separate cleanup.
- Per-tenant role overrides (`RolePermission.pawnshopId`) — documented extension point, deferred.
- Permission caching (TTL) — none in Phase 7 (SC2 freshness).
- Any frontend/auction-frontend/mobile change — confirmed NOT required (evidence in T13).

## Assumptions Log Resolution (RESEARCH.md A1-A9)

> **Directive provenance (per REVIEW MINOR-6):** no CONTEXT.md exists in this phase dir. The "user constraint"/"user scope directive" citations in rows A2/A4 below originate from the user's plan-phase instructions (verbatim prompt), recorded here for traceability.

| # | Claim | Resolution |
|---|-------|------------|
| A1 | 37-value catalog + role matrix match product intent | **ACCEPT as-is.** Seeded reference data; if a grant is wrong post-launch it is fixed with an UPDATE — no code change (SC2). Matrix embedded in this plan for review before execution. |
| A2 | Generic STAFF loses `pawn_ticket.appraise` (one deliberate tightening) | **ACCEPT.** Research-flagged; the user scope directive endorses the equivalence table including the tightening. Guard spec case (g) locks it. Noted in the deliberate-change log. |
| A3 | staffType permission sets (CT/APPRAISER/INVENTORY_CUSTODIAN/AUDITOR) | **ACCEPT as-is.** Seeded and tunable; guard spec cases (e)-(h) lock the semantics. |
| A4 | Catalog rows ship inside the migration (not a seed script) | **ACCEPT — matches user constraint** ("permissions must seed via migration INSERT + a standalone idempotent seed script, NOT the existing seed.ts"). Migration is prod path; `seed-permissions.ts` is dev convenience. |
| A5 | `ApprovalTargetType` starts with APPRAISAL/REDEMPTION/LOAN_APPLICATION | **ACCEPT.** Additive enum extension by Phase 8 if needed; PG enum ADD VALUE is a later migration, low risk. |
| A6 | `CustomerKyc` is a new customer-keyed model (not BidderKyc reuse) | **ACCEPT as-is** (research recommendation; KYC-01 permits either). Decouples pawnshop-client KYC from auction-bidder KYC. |
| A7 | `Customer.tier` (enum) coexists with legacy `loyaltyTier` until Phase 12 | **ACCEPT.** Phase 7 writes NO tier data (schema-only); Phase 12 owns retirement; drift risk documented in SUMMARY. |
| A8 | `Receipt.customerId` nullable | **ACCEPT.** Receipts are polymorphic (referenceType/referenceId) and some predate customer linking; Phase 12 owns backfill. |
| A9 | `PawnshopDocument` is the right home for `hasViewed` | **ACCEPT as-is.** The ONB-02 viewer is per-document (admin opens a specific document before approving); if a per-request shape is ever needed, Phase 10 adds a column additively. |

### DECISION-NEEDED (single flagged item — default set, no block)

| ID | Question | Options | Default |
|----|----------|---------|---------|
| **DN-1** | `POST loan/applications` (row 11) mapping under tuple `('CASHIER_TELLER','MANAGER','OWNER')` | (a) **`loan.collect`** — strict equivalence per research row-4 palette: no access change vs today, but the name reads oddly on a creation endpoint. (b) `loan.create` — semantically clean, but widens generic STAFF to loan-application creation (STAFF base already includes `loan.create` by matrix design), a behavior change beyond the single documented tightening. | **Default: (a) `loan.collect`** — strict equivalence, research-compliant, zero regression risk for a thesis deadline. If the owner prefers (b), it is a one-line decorator edit + re-run of T12's spec. Related documented widenings (`contract.sign` on sign-staff, matrix STAFF base) are unaffected by this choice. |

## Output

Create `.planning/phases/07-permission-foundation-schema-baseline/07-01-SUMMARY.md` when done — the SUMMARY is GENERATED POST-EXECUTION by the executor, not part of this plan file. (Naming note per REVIEW NIT-4: this phase's plan file is `PLAN.md` per the GSD write convention while the summary target follows the `{phase}-{NN}-SUMMARY.md` convention — the asymmetry is intentional, not a mismatch.) Per `@C:/Users/arvie/.config/opencode/gsd-core/templates/summary.md`, record: catalog/matrix counts, guard resolution order, conversion completion proof (spec green), SC2 data-driven demo results, manual curl results, the zero-frontend-change confirmation with evidence, and the handoff notes for Phases 8-12 (pawnshopId scoping on new models; EXEMPT list must not grow; `seed.ts` never run against prod).




