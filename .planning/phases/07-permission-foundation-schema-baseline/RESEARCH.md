<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RBAC-01 | Permission catalog (enum) plus role→permission mapping replaces hardcoded `@Roles('OWNER','MANAGER')` role strings; endpoints declare `@RequiresPermission(...)` and RbacGuard evaluates permissions | Permission data model (§ Architecture Patterns P2), 37-value catalog + 10-role matrix (§ Permission Catalog), equivalence table proving all 63 existing `@Roles` usages map losslessly (§ Equivalence Table), guard resolution flow (§ P1/P3) |
| RBAC-02 | RbacGuard honors `staffType` so APPRAISER/CASHIER_TELLER/INVENTORY_CUSTODIAN/AUDITOR checks work after the role-normalization migration | Verified mixed-state bug from migration `20260324_rbac_role_alignment_staff_subroles` (§ Current RBAC Mechanics), staffType resolution order (§ P3), legacy-role defensive normalization (§ P3, Pitfall 3) |

</phase_requirements>

# Phase 7: Permission Foundation & Schema Baseline - Research

**Researched:** 2026-07-31
**Domain:** Data-driven RBAC (NestJS guards + Prisma/Postgres permission catalog) and a batched additive schema migration for v2.0
**Confidence:** HIGH (codebase mechanics — verified by direct read), MEDIUM (design proposals — flagged `[ASSUMED]` for discuss-phase confirmation)

## Summary

Phase 7 replaces the hardcoded role-string authorization in `RbacGuard` (`backend/src/common/guards/rbac.guard.ts`) with a **data-driven permission catalog**: a relational `Permission` + `RolePermission` mapping (seeded via migration SQL with `ON CONFLICT DO NOTHING`), a new `@RequiresPermission(...)` decorator whose values come from a typed const object, and a guard that resolves a caller's effective permission set per request. The guard keeps the existing `@Roles` path as a fail-closed fallback during the conversion of all 63 decorated endpoints (12 distinct role tuples — enumerated in this research), so no endpoint silently loses protection mid-migration.

The **staffType bug is verified and is worse than the audit note described**: the audit claimed `rbac.guard.ts` lines 46-49 read `user.staffType`; the current code does **not** read `staffType at all** (`rbac.guard.ts:46-49` reads only `profile.role`). Because migration `20260324_rbac_role_alignment_staff_subroles` normalized staff subroles to `role='STAFF'` + `staff_type`, the guard today (a) **denies** normalized CASHIER_TELLER users on `@Roles('CASHIER_TELLER','MANAGER','OWNER')` endpoints (fail-closed but wrong), (b) **fails open** — any generic STAFF can hit `@Roles('APPRAISER','STAFF','MANAGER','OWNER')` endpoints, and (c) is **inconsistent per user** because the migration only normalized rows whose `staff_type` was NULL/invalid, so pre-existing `role='CASHIER_TELLER'` rows still pass. The fix is a resolution order: SUPER_ADMIN bypass → base `role` permissions → union `staffType` permissions, with defensive normalization of legacy role values.

The **schema baseline** is fully additive and safe as one batched migration: new models `Permission`, `RolePermission`, `ApprovalRecord` (Phase 8), `CustomerKyc` (Phase 9), `CustomerTierHistory` (Phase 12); new columns `Receipt.customerId`, `Customer.tier` + `Customer.kycStatus`, `PawnshopDocument.hasViewed/viewedAt/viewedBy` (Phase 10), and signature-image metadata on `LoanContract` (Phase 11); new enums `CustomerTier`, `ApprovalStatus`, `ApprovalTargetType`, `SignatureType` (reusing existing `KycStatus`/`KycIdType`). No destructive changes; no new npm dependencies.

**Primary recommendation:** relational permission tables (not a Prisma enum, not a JSON column) + typed const `PERMISSIONS` for decorator↔catalog sync + migration-embedded idempotent catalog seed + per-request DB permission resolution in a refactored `RbacGuard` that unions role and staffType permission sets.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Permission catalog + role→permission mapping (RBAC-01) | Database / Storage | API / Backend | Data-driven criterion (SC2) means enforcement reads mapping from DB, not code |
| `@RequiresPermission` enforcement (RBAC-01) | API / Backend | — | Global NestJS guard (`APP_GUARD`), mirroring existing `RbacGuard` placement |
| staffType resolution (RBAC-02) | API / Backend | Database / Storage | Guard reads `profile.staffType`; permission semantics defined per staffType row in catalog |
| SUPER_ADMIN bypass (SC4) | API / Backend | — | Guard short-circuit before permission lookup, preserving current `rbac.guard.ts:71-78` behavior |
| Tenant (pawnshop) data isolation | Database / Storage | API / Backend | Unchanged: `PawnshopGuard` + service-level `pawnshopId` checks; new models carry `pawnshopId` |
| Schema baseline (all v2.0 fields) | Database / Storage | — | Single additive Prisma migration |

## Current RBAC Mechanics (verified)

### How the guard works today

1. **Guard registration**: `RbacGuard` is a global `APP_GUARD`, registered 2nd in `app.module.ts:57-72` after `PawnshopGuard`, before `RateLimitGuard`/`ComplianceGuard`. Guards run in registration order.
2. **Identity resolution**: `AuthUserService.getUserIdFromAuthHeader` (`backend/src/common/auth-user.service.ts:17-31`) decodes the Supabase JWT via the **service-role client** (`supabaseAdmin.auth.getUser`), not a NestJS Passport strategy. Every request pays 1 Supabase API call.
3. **Profile load**: `rbac.guard.ts:46-49` — `prisma.profile.findUnique({ where: { id: userId }, select: { role: true, pawnshopId: true } })`. **`staffType` is never selected or read.**
4. **Metadata**: `@Roles(...)` (`backend/src/common/decorators/roles.decorator.ts`) stores an array under key `'roles'` via `SetMetadata`; `RbacGuard` reads it with `Reflector.getAllAndOverride` (handler + class) at `rbac.guard.ts:57-60`.
5. **Decision flow** (`rbac.guard.ts:27-92`):
   - `@Public()` → allow (line 28-32).
   - No `@Roles` → populate `request.user = { id, role, pawnshopId }` and allow (lines 62-69). **This means every endpoint without the decorator is open to any authenticated user — ~most GET endpoints.**
   - `role === 'SUPER_ADMIN'` → allow (lines 71-78).
   - `requiredRoles.includes(userRole)` → exact string match (lines 80-87), else `ForbiddenException` listing required roles.
6. **`request.user` shape** consumed by controllers/services: `{ id: string; role: string; pawnshopId?: string }` (set at lines 63-68, 72-77, 81-86). Services also read the `pawnshop-id` header (e.g., `auction.controller.ts:244`) — pre-existing dual source of tenant identity.
7. **Service-level role checks remain**: e.g., `tenant-governance.service.ts:621-625` (`normalizeRole(actor.role)` + manual allow-list), `tenant-governance.service.ts:642`. These are out of phase-7 scope but must be remembered when converting endpoints in those controllers.

### The staffType bug (verified, corrected from audit note)

Migration `backend/prisma/migrations/20260324_rbac_role_alignment_staff_subroles/migration.sql`:
- Added `profiles.staff_type TEXT` + CHECK constraint limiting to `('CASHIER_TELLER','APPRAISER','INVENTORY_CUSTODIAN','AUDITOR')` (or NULL).
- Normalized rows where `role IN ('CASHIER','APPRAISER','INVENTORY','CASHIER_TELLER','INVENTORY_CUSTODIAN','AUDITOR')` **and** `staff_type IS NULL OR staff_type NOT IN (allowed set)` → `role='STAFF'` + `staff_type` set.
- **Critical consequence**: rows that already carried a valid `staff_type` (e.g., `role='CASHIER_TELLER', staff_type='CASHIER_TELLER'`) were **skipped** by the UPDATE's WHERE clause. The profiles table today holds a **mixed state**: some staff have `role='CASHIER_TELLER'` (legacy), most have `role='STAFF'` + `staff_type`. New staff created via `app.service.ts:518-571` (`parseRoleAndStaffType`) always get `role='STAFF'` + staffType. The frontend already writes `{ role: 'STAFF', staff_type }` (`frontend/src/components/StaffMatrix.tsx:90-93`).

Guard consequences (all verified against the 63-usage enumeration):

| Scenario | Today's behavior | Why |
|---|---|---|
| Normalized CASHIER_TELLER hits `@Roles('CASHIER_TELLER','MANAGER','OWNER')` (6 uses: `loan.controller.ts:54,172,243,263,276`, `pawn-ticket.controller.ts:140`) | **DENIED (403)** | Their `role` is `'STAFF'`, not in the tuple |
| Normalized APPRAISER hits `@Roles('APPRAISER','STAFF','MANAGER','OWNER')` (`pawn-ticket.controller.ts:122`) | **ALLOWED via STAFF** (fail-open) | `'STAFF'` is in the tuple; any generic STAFF also passes |
| Normalized CASHIER_TELLER hits `@Roles('CASHIER_TELLER','STAFF','MANAGER','OWNER')` (5 uses) | ALLOWED via STAFF | Same fail-open |
| Legacy `role='CASHIER_TELLER'` user hits the same tuple | ALLOWED via role | Never normalized |
| Any generic STAFF user hits `@Roles('APPRAISER','STAFF',...)` | ALLOWED (fail-open) | `'STAFF'` in tuple |

So RBAC-02's "checks no longer fail **or bypass**" describes exactly this: fail-closed on some endpoints, fail-open on others, inconsistent between users of the same specialization.

### Complete `@Roles` inventory (63 usages, 12 distinct tuples)

Enumerated from `backend/src` (regex over all `.ts`):

| Tuple | Count | Controllers (representative endpoints) |
|---|---|---|
| `('SUPER_ADMIN')` | 25 | app.controller:354 (`GET pawnshops`); tenant-governance.controller:38-448 (support-access, onboarding/configure, branding, subscriptions/status, registration review); compliance.controller:36,68,74,80 |
| `('OWNER','MANAGER')` | 10 | loan.controller:88,105,152,334,371; pawn-ticket.controller:57,73,91,106,164; tenant-governance.controller:289,299 (branches) |
| `('MANAGER','OWNER')` | 6 | loan.controller:183,195,215,223,336,373 |
| `('CASHIER_TELLER','MANAGER','OWNER')` | 6 | loan.controller:54,172,243,263,276; pawn-ticket.controller:140 (redeem) |
| `('CASHIER_TELLER','STAFF','MANAGER','OWNER')` | 5 | pawn-ticket.controller:18,41,158; loan.controller:116,141 |
| `('OWNER','STAFF','SUPER_ADMIN')` | 4 | compliance.controller:21,27,56,62 |
| `('OWNER','ADMIN','MANAGER')` | 2 | auction.controller:236,253 (settlements) |
| `('SUPER_ADMIN','OWNER','ADMIN')` | 1 | tenant-governance.controller:86 (audit/history) |
| `('OWNER','STAFF')` | 1 | compliance.controller:46 (renew) |
| `('APPRAISER','STAFF','MANAGER','OWNER')` | 1 | pawn-ticket.controller:122 (appraise) |
| `('OWNER')` | 1 | tenant-governance.controller:459 (trial extension request) |
| `('OWNER','ADMIN')` | 1 | auction.controller:264 (manual-settle) |

**Findings that matter for the permission matrix:**
- `HR`, `AUDITOR`, and `INVENTORY_CUSTODIAN` appear in **zero** decorators — the guard denies them on all 63 endpoints today (they pass only on undecorated endpoints). The permission catalog must *grant* them a first real permission set (this is a net behavior improvement, not a regression).
- `ADMIN` (post branch-admin normalization) appears only in auction + audit-history tuples.
- `@Roles('SUPER_ADMIN')` × 25 is effectively redundant (guard already bypasses SUPER_ADMIN at `rbac.guard.ts:71`) — converting these to `platform.manage` keeps the catalog honest but the bypass means behavior is unchanged.
- The Prisma `enum Role` in `schema.prisma:392-400` is **dead code**: `Profile.role` is a `String` (`schema.prisma:323`) and no backend file type-uses the enum (verified by grep — only comments/strings matched).

## Standard Stack

**This phase adds zero new npm dependencies.** Everything needed is already installed:

| Library | Version (verified in `backend/package.json` + node_modules) | Purpose | Why Standard |
|---|---|---|---|
| NestJS core/common | ^10.0.0 | Guards, decorators, Reflector metadata | Existing app framework; `@Roles` already follows the official guard pattern |
| @prisma/client + prisma | ^5.22.0 | Schema models, migration, seeding | Existing ORM; `upsert`/`createMany skipDuplicates` documented for idempotent seeds |
| @supabase/supabase-js | ^2.90.1 | JWT verification (service-role) | Existing auth path via `AuthUserService` |
| tsx | ^4.7.1 (dev) | Run seed scripts | Existing seed runner (`package.json` `"prisma": {"seed": "tsx prisma/seed.ts"}`) |
| jest + ts-jest | ^29.5.0 (dev) | Unit tests for guard + catalog consistency | Existing test infra (21 spec files) |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase — the implementation is schema + existing-framework code (NestJS decorator/guard, Prisma models/migration, no new runtime or dev dependencies). The Package Legitimacy Gate protocol is therefore not applicable; no `[ASSUMED]` package names are introduced anywhere in this research.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                Request (Bearer JWT)                 │
                    └───────────────────────┬─────────────────────────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ APP_GUARD chain (app.module.ts:57-72, registration order)                │
│ 1. PawnshopGuard      → tenant-id header shape (exempt list, SUPER_ADMIN)│
│ 2. RbacGuard  ◄─────── THIS PHASE'S CHANGE                               │
│ 3. RateLimitGuard                                                         │
│ 4. ComplianceGuard    → document-score gate                              │
└───────────────────────────────────────────────────────────────────────────┘
                                            │
                        ┌───────────────────▼───────────────────┐
                        │  RbacGuard.canActivate (refactored)  │
                        │  1. @Public → allow                  │
                        │  2. resolve userId (Supabase JWT)    │
                        │  3. load profile {role,staffType,    │
                        │     pawnshopId}                      │
                        │  4. normalize legacy role values     │
                        │  5. SUPER_ADMIN → allow              │
                        │  6. no metadata → request.user, allow│
                        │  7. resolve effective permissions:   │
                        │     perms(role) ∪ perms(staffType)   │
                        │     ← PermissionService (Prisma,     │
                        │       role_permissions JOIN          │
                        │       permissions)                   │
                        │  8. @Roles present && no @Requires-  │
                        │     Permission → legacy role match   │
                        │     (fail-closed fallback)           │
                        │  9. @RequiresPermission → all held?  │
                        │     else ForbiddenException (403)    │
                        └───────────────────┬───────────────────┘
                                            ▼
                        ┌──────────────────────────────────────┐
                        │  Controller handler                   │
                        │  request.user = { id, role, staffType,│
                        │    pawnshopId }                       │
                        │  Service-level pawnshopId scoping     │
                        └──────────────────────────────────────┘
                                            ▲
┌───────────────────────────────────────────┴───────────────────────────────┐
│  Supabase Postgres (single public schema)                                │
│  NEW: permissions, role_permissions (global catalog, no tenant column)   │
│  NEW: approval_records, customer_kyc, customer_tier_history              │
│  NEW columns: receipts.customer_id, customers.tier/kyc_status,           │
│    pawnshop_documents.has_viewed/viewed_at/viewed_by,                    │
│    loan_contracts.*signature_image_*                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions only)

```
backend/
├── prisma/
│   ├── schema.prisma                  # + Permission, RolePermission, ApprovalRecord,
│   │                                  #   CustomerKyc, CustomerTierHistory; + fields/enums
│   ├── migrations/
│   │   └── <ts>_v2_schema_baseline/   # ONE batched migration: DDL + catalog INSERTs
│   │                                  #   (permissions, role_permissions) w/ ON CONFLICT
│   └── seed-permissions.ts            # standalone idempotent upsert (local dev only)
└── src/common/
    ├── permissions/
    │   ├── permissions.const.ts       # typed const PERMISSIONS (single source for decorators)
    │   ├── permissions.service.ts     # resolveEffectivePermissions(role, staffType)
    │   └── permissions.module.ts      # exports service to guard
    ├── decorators/
    │   ├── roles.decorator.ts         # unchanged (legacy fallback path)
    │   └── requires-permission.decorator.ts  # NEW @RequiresPermission(...perms)
    └── guards/rbac.guard.ts           # refactored per P3 resolution order
```

### Pattern 1: Permission Decorator + Guard (data-driven)

**What:** The canonical NestJS authorization pattern (`@Roles` SetMetadata + Reflector guard — the exact pattern this codebase already uses per official docs) extended so the guard checks **permissions held** rather than role strings. Routes declare `@RequiresPermission(PERMISSIONS.pawn_ticket.approve)`; the guard reads metadata, loads the caller's effective permission set from the catalog, and denies with 403 unless every required permission is held. `@Roles` semantics (OR any-role) map naturally: each current tuple becomes ONE permission granted to every role in the tuple.
**When to use:** Every guarded endpoint, replacing `@Roles` tuples 1:1 (equivalence table below proves no access regression).
**Why this satisfies SC2:** Enforcement reads the mapping at request time. An `UPDATE role_permissions SET permission_id=...` changes enforcement with zero code change.

### Pattern 2: Permission Data Model (relational, global catalog)

**What:** Two new tables, no tenant column:

```
Permission      (id uuid PK, name text UNIQUE, "group" text, description text?, createdAt)
RolePermission  (id uuid PK, role text, permissionId uuid FK→permissions ON DELETE CASCADE,
                 UNIQUE(role, permissionId), INDEX(role))
```

`role` stores the canonical profile role strings (`SUPER_ADMIN, OWNER, ADMIN, MANAGER, HR, STAFF`) **plus the four staffType values** (`CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR`) as first-class catalog rows. Guard resolution = perms(`profile.role`) ∪ perms(`profile.staffType`).
**Why relational over the alternatives:**
- vs. **Prisma enum `Permission`** (PG `CREATE TYPE`): a PG enum requires a migration + `ALTER TYPE ... ADD VALUE` every time a permission is added; the catalog is expected to grow as later phases (8-12) land decorators. Relational rows are insert-only. (The "enum" in RBAC-01 is satisfied by the typed `PERMISSIONS` const that decorators use.)
- vs. **JSON column on a role table**: no join integrity; no `permission_id` referential checks; harder to enumerate/grant in UI; weaker story for per-role auditing.
- The **global (tenant-less) catalog** matches the current model: `profiles.role` is a global string across tenants, and tenant owners cannot edit roles today (no UI; SUPER_ADMIN-only). Per-tenant overrides are deferred (see Open Questions).
- Permission **names** are `resource.action` strings (`pawn_ticket.approve`) — the naming convention with broad industry consensus — kept in sync by a single typed const + a seed-consistency unit test.

### Pattern 3: staffType Resolution (RBAC-02)

**What:** Resolution order in `RbacGuard.canActivate`:
1. `@Public` → allow.
2. Resolve userId → load `profile { role, staffType, pawnshopId }`.
3. **Normalize legacy role values**: if `role ∈ {CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR}` (rows the 03-24 migration skipped), treat as `role='STAFF'` + `staffType=role`. This kills the per-user inconsistency.
4. `role === 'SUPER_ADMIN'` → allow (bypass, SC4).
5. No `@Roles` and no `@RequiresPermission` metadata → populate `request.user` (now including `staffType`) and allow.
6. If only `@Roles` present (endpoint not yet converted) → legacy exact-match path (kept during conversion so no endpoint opens up).
7. If `@RequiresPermission` present → `effective = perms(role) ∪ perms(staffType)`; allow iff required ⊆ effective, else 403.

**Permission semantics per staffType** (design proposal `[ASSUMED]` — seeded, so tunable without code change):

| staffType | Grants (over STAFF base) | Matches current tuples? |
|---|---|---|
| CASHIER_TELLER | `pawn_ticket.redeem`, `loan.collect`, `approval.view_queue` | restores `('CASHIER_TELLER',...)` denials |
| APPRAISER | `pawn_ticket.appraise`, `approval.view_queue` | restores fail-open fix (no longer any-STAFF) |
| INVENTORY_CUSTODIAN | `inventory.manage` | first real access (was denied everywhere) |
| AUDITOR | `reports.view`, `tenant.view_audit`, `finance.manage` (read) | first real access |

Generic `STAFF` base keeps exactly what the current STAFF-inclusive tuples grant (`pawn_ticket.create`, `pawn_ticket.view`, `pawn_ticket.submit_approval`, `loan.create`, `compliance.view`, `compliance.manage_documents`, `contract.sign`, `customer.view_history`) — no fail-open leak of specialization abilities.

### Anti-Patterns to Avoid

- **JWT-embedded permission claims**: permissions go stale the moment the catalog is edited — directly violating SC2 ("no code change"). This backend already pays a Supabase `getUser` call per request; two extra Prisma reads (profile + permission join) are consistent and always fresh.
- **Permission string literals in decorators**: `@RequiresPermission('pawn_ticket.approve')` drifts from the seed. Always import from `PERMISSIONS` const; add the consistency spec test.
- **Per-tenant permission rows prematurely**: adds join complexity and a cross-tenant cache story for zero current requirement. Global catalog now; `RolePermission.pawnshopId` is a documented extension point.
- **Guard doing tenant checks**: keep `pawnshopId` scoping in `PawnshopGuard` + services; the permission layer answers "may this role", not "may this tenant".

## Permission Catalog (37 values `[ASSUMED]` — confirm in discuss-phase)

Typed const groups (`PERMISSIONS.*`), each value seeded as a `permissions.name` row:

**Platform & Tenant:** `platform.manage`, `tenant.manage`, `tenant.view_audit`, `tenant.manage_branches`
**Users & Staff:** `user.manage_staff`
**Pawn Tickets:** `pawn_ticket.create`, `pawn_ticket.view`, `pawn_ticket.submit_approval`, `pawn_ticket.approve`, `pawn_ticket.decline`, `pawn_ticket.appraise`, `pawn_ticket.redeem`, `pawn_ticket.send_to_auction`
**Loans:** `loan.create`, `loan.manage`, `loan.collect`
**Auction:** `auction.manage`, `auction.settle`, `auction.manual_settle`
**Inventory:** `inventory.manage`
**Compliance & Onboarding:** `compliance.view`, `compliance.manage_documents`, `onboarding.review_documents` (P10), `onboarding.approve` (P10)
**Finance & Reports:** `reports.view`, `finance.manage`
**Approvals (P8):** `approval.view_queue`, `approval.approve_appraisal`, `approval.approve_redemption`
**KYC (P9):** `kyc.view`, `kyc.verify`
**Contracts (P11):** `contract.sign`, `contract.upload_signature`
**Customer (P12):** `customer.view_history`, `customer.manage_tier`
**People Ops:** `payroll.manage`, `attendance.manage`

### Role → Permission matrix (seed content)

| Role | Permissions |
|---|---|
| SUPER_ADMIN | bypass (all) + `platform.manage` (catalog completeness) |
| OWNER | all except `platform.manage`, `onboarding.review_documents`, `onboarding.approve` (SUPER_ADMIN-only) |
| ADMIN | `tenant.view_audit`, `auction.settle`, `auction.manual_settle`, `approval.view_queue`, `approval.approve_appraisal`, `approval.approve_redemption`, `kyc.view`, `kyc.verify` (equivalence-preserving: audit/auction/approval/KYC per RBAC-03/04 + KYC-02) |
| MANAGER | `tenant.manage_branches`, `user.manage_staff`, `pawn_ticket.*` (all 8), `loan.create`, `loan.manage`, `loan.collect`, `auction.settle`, `inventory.manage`, `reports.view`, `finance.manage`, `approval.view_queue`, `contract.sign`, `customer.manage_tier`, `attendance.manage` |
| HR | `payroll.manage`, `attendance.manage` |
| STAFF (generic base) | `pawn_ticket.create`, `pawn_ticket.view`, `pawn_ticket.submit_approval`, `loan.create`, `compliance.view`, `compliance.manage_documents`, `contract.sign`, `customer.view_history` |
| CASHIER_TELLER (staffType) | STAFF base + `pawn_ticket.redeem`, `loan.collect`, `approval.view_queue` |
| APPRAISER (staffType) | STAFF base + `pawn_ticket.appraise`, `approval.view_queue` |
| INVENTORY_CUSTODIAN (staffType) | `pawn_ticket.view`, `inventory.manage` |
| AUDITOR (staffType) | `pawn_ticket.view`, `reports.view`, `tenant.view_audit`, `finance.manage` |

### Equivalence table: current tuples → permission (proves no access regression on the 63 endpoints)

| Current `@Roles(...)` tuple | Replacement `@RequiresPermission(...)` | Holders (from matrix) |
|---|---|---|
| `('SUPER_ADMIN')` | `platform.manage` | SUPER_ADMIN (bypass anyway) |
| `('OWNER','MANAGER')` / `('MANAGER','OWNER')` (16) | per-endpoint: `pawn_ticket.approve`/`pawn_ticket.decline`/`pawn_ticket.send_to_auction`/`loan.manage`/`tenant.manage_branches`/`contract.sign`(staff) | OWNER, MANAGER |
| `('CASHIER_TELLER','MANAGER','OWNER')` (6) | `pawn_ticket.redeem`/`loan.collect` | CASHIER_TELLER, MANAGER, OWNER |
| `('CASHIER_TELLER','STAFF','MANAGER','OWNER')` (5) | `pawn_ticket.create`/`pawn_ticket.submit_approval`/`loan.create`/`customer.view_history` | CASHIER_TELLER, STAFF, MANAGER, OWNER |
| `('OWNER','STAFF','SUPER_ADMIN')` (4) | `compliance.view` | OWNER, STAFF (+bypass) |
| `('OWNER','ADMIN','MANAGER')` (2) | `auction.settle` | OWNER, ADMIN, MANAGER |
| `('SUPER_ADMIN','OWNER','ADMIN')` (1) | `tenant.view_audit` | OWNER, ADMIN (+bypass) |
| `('OWNER','STAFF')` (1) | `compliance.manage_documents` | OWNER, STAFF |
| `('APPRAISER','STAFF','MANAGER','OWNER')` (1) | `pawn_ticket.appraise` | APPRAISER, MANAGER, OWNER (**generic STAFF loses it — the intended RBAC-02 fix**) |
| `('OWNER')` (1) | `tenant.manage` (extension-request endpoint) | OWNER |
| `('OWNER','ADMIN')` (1) | `auction.manual_settle` | OWNER, ADMIN |

The one deliberate tightening: `pawn_ticket.appraise` is no longer available to generic STAFF (currently fail-open).

## Schema Baseline — Complete Change List (all additive; single migration)

### New enums
| Enum | Values | Used by |
|---|---|---|
| `CustomerTier` | `STANDARD BRONZE SILVER GOLD VIP` | `Customer.tier`, `CustomerTierHistory` |
| `ApprovalStatus` | `PENDING APPROVED REJECTED CANCELLED` | `ApprovalRecord` (Phase 8 decision lifecycle) |
| `ApprovalTargetType` | `APPRAISAL REDEMPTION LOAN_APPLICATION` | `ApprovalRecord` (extensible for Phase 8) |
| `SignatureType` | `CANVAS TYPED UPLOADED` | `LoanContract` signature metadata (Phase 11) |
| *(reuse)* `KycStatus`, `KycIdType` | existing at `schema.prisma:869-888` | `CustomerKyc`, `Customer.kycStatus` |

### New models
| Model | Fields (name, type, notes) | Relations | Phase |
|---|---|---|---|
| `Permission` | `id String @id @default(uuid()) @db.Uuid`, `name String @unique`, `group String`, `description String?`, `createdAt DateTime @default(now())` | `rolePermissions RolePermission[]` | 7 |
| `RolePermission` | `id String @id @default(uuid()) @db.Uuid`, `role String`, `permissionId String @db.Uuid`; `@@unique([role, permissionId])`, `@@index([role])` | `permission Permission @relation(fields:[permissionId], references:[id], onDelete: Cascade)` | 7 |
| `ApprovalRecord` | `id`, `pawnshopId String @db.Uuid`, `targetType ApprovalTargetType`, `targetId String`, `status ApprovalStatus @default(PENDING)`, `amount Float?`, `requestedById String @db.Uuid`, `decidedById String? @db.Uuid`, `decidedAt DateTime?`, `decisionComment String?`, `createdAt`, `updatedAt`; `@@index([pawnshopId, status])`, `@@index([targetType, targetId])` | `pawnshop`, `requestedBy Profile @relation("ApprovalRequestedBy", fields:[requestedById],...onDelete: Restrict)`, `decidedBy Profile? @relation("ApprovalDecidedBy",...)` | 8 (RBAC-06: "activate the dead LoanApproval or add PawnTicketApproval" → a generic record covers both appraisal + redemption) |
| `CustomerKyc` | `id`, `customerId String @unique @db.Uuid`, `pawnshopId String @db.Uuid`, `status KycStatus @default(NOT_SUBMITTED)`, `fullName`, `contactNumber`, `address`, `idType KycIdType`, `idNumber`, `idFrontUrl`, `idBackUrl String?`, `selfieUrl String?`, `verificationData Json?`, `reviewedBy String? @db.Uuid`, `reviewedAt DateTime?`, `rejectionReason String?`, `createdAt`, `updatedAt`; `@@index([pawnshopId, status])` | `customer`, `pawnshop` | 9 (KYC-01: customer-scoped KYC distinct from auction-bidder `BidderKyc` keyed by Profile; reuses `KycStatus`/`KycIdType`) |
| `CustomerTierHistory` | `id`, `customerId String @db.Uuid`, `fromTier CustomerTier?`, `toTier CustomerTier`, `reason String`, `changedById String? @db.Uuid`, `changedAt DateTime @default(now())`; `@@index([customerId, changedAt])` | `customer` | 12 (CUST-04) |

### New columns on existing models
| Model | Column | Type / constraint | Phase |
|---|---|---|---|
| `Customer` (`schema.prisma:46-63`) | `tier` | `CustomerTier @default(STANDARD)` — **new field**; keep legacy `loyaltyTier String` untouched until Phase 12 retires it (readers/writers exist: `pawn-ticket.service.ts:673`, `loan.service.ts:598`, `app.service.ts:1955`) | 12 (CUST-03) |
| `Customer` | `kycStatus` | `KycStatus @default(NOT_SUBMITTED)` | 9 (KYC-01) |
| `Customer` | `customerKyc` relation | `CustomerKyc?` | 9 |
| `Receipt` (`schema.prisma:1310-1338`) | `customerId` | `String? @db.Uuid` + FK `customer Customer? @relation(...)` with `onDelete: SetNull`; `@@index([customerId])` — **nullable**: receipts are polymorphic (`referenceType/referenceId`) and some predate customer linking | 12 (CUST-02) |
| `PawnshopDocument` (`schema.prisma:1670-1695`) | `hasViewed` | `Boolean @default(false)` | 10 (ONB-02: approve disabled until doc opened) |
| `PawnshopDocument` | `viewedAt` | `DateTime?` | 10 |
| `PawnshopDocument` | `viewedBy` | `String? @db.Uuid` | 10 |
| `LoanContract` (`schema.prisma:822-846`) | `customerSignatureType` | `SignatureType @default(TYPED)` | 11 (CTR-01) |
| `LoanContract` | `customerSignatureImageUrl` | `String?` | 11 |
| `LoanContract` | `customerSignatureImageMime` | `String?` | 11 |
| `LoanContract` | `staffSignatureType` | `SignatureType @default(TYPED)` | 11 |
| `LoanContract` | `staffSignatureImageUrl` | `String?` | 11 |
| `LoanContract` | `staffSignatureImageMime` | `String?` | 11 |

Existing canvas/typed `customerSignature`/`staffSignature` String columns stay; Phase 11 adds the upload path alongside (`loan-contract.service.ts:172-226` currently persists the drawn/typed string).

### Migration safety verdict
**Safe as ONE batched migration** — every change is additive: 4 new enums, 5 new tables, nullable or defaulted columns, FK relations that don't rewrite existing rows. No data loss, no `ALTER COLUMN` type changes, no renames. Prisma generates `CREATE TYPE` before the columns that use them within the same migration. The existing `profiles_staff_type_check` constraint is untouched (guard normalizes reads only — the migration adds no `staff_type` writes).

## Migration + Seed Strategy

**Recommendation `[ASSUMED]` (confirm in discuss-phase): schema DDL + catalog data both live in the single migration; a standalone idempotent script for local dev.**

| Concern | Decision | Rationale |
|---|---|---|
| Schema DDL | In the migration (Prisma standard) | Versioned, ordered, applied by `prisma migrate deploy` |
| Permission catalog rows (37 names) | Migration `INSERT ... ON CONFLICT (name) DO NOTHING` | Railway deploys run `prisma migrate deploy` — no separate seed step, catalog guaranteed present in every env. Migrations run exactly once, so this is safe reference-data shipping |
| Role→permission rows (matrix above) | Migration `INSERT ... SELECT ... ON CONFLICT (role, permission_id) DO NOTHING` (JOIN permissions by name) | Same guarantee; idempotent by construction |
| Editing a role's permission set (SC2) | Plain SQL `UPDATE role_permissions` at runtime | No code change required — enforcement is data-driven. Documented extension: SUPER_ADMIN-only endpoint to manage mappings (future) |
| Local dev | `backend/prisma/seed-permissions.ts` — upsert-based, safe to re-run | **Do NOT touch `seed.ts`**: it is destructive (`deleteMany` on 10 tables, `seed.ts:14-23`) and must never run against production/Supabase |
| Dev convenience | `"prisma": {"seed": ...}` unchanged | The destructive dev seed stays dev-only; the permission script is invoked explicitly (`npx tsx prisma/seed-permissions.ts`) |

**Ordering:** `prisma migrate deploy` → (prod: nothing more) / (dev: `npx tsx prisma/seed-permissions.ts` if the migration pre-dates the seed).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Decorator metadata plumbing | A hand-rolled middleware chain reading role strings | NestJS `SetMetadata` + `Reflector` guard — the pattern already in `roles.decorator.ts`/`rbac.guard.ts` | Official NestJS authorization pattern; zero new abstraction |
| Permission-to-role persistence | In-memory maps or a JSON config file | Relational `permissions` + `role_permissions` tables with FK integrity | SC2 requires runtime-editable data; JSON-in-repo is code (needs deploy), in-memory maps vanish on restart |
| Idempotent seeding | Hand-written existence checks per row | `ON CONFLICT DO NOTHING` (migration) / `prisma.permission.upsert()` + `createMany skipDuplicates` (script) | Documented Postgres/Prisma patterns; race-safe |
| Legacy-role normalization | Duplicating `normalizeRole` logic in the guard | Single private helper in the guard mapping legacy `CASHIER_TELLER/APPRAISER/INVENTORY_CUSTODIAN/AUDITOR` → `STAFF`+staffType | One authoritative spot; mirrors `app.service.ts:493-502` semantics |

**Key insight:** the hard part of RBAC is not the guard — it's the catalog staying consistent with the decorators and the enforcement staying fresh when the catalog changes. Both are solved by (a) one typed const consumed by decorators and asserted against the seed, and (b) per-request DB resolution instead of JWT claims.

## Runtime State Inventory

> Included because this phase ships a migration touching live profile data semantics (the 03-24 staffType normalization).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `profiles` rows in **mixed role state**: legacy `role='CASHIER_TELLER'/'APPRAISER'/...` rows (skipped by the 03-24 migration because they already had valid `staff_type`) coexist with `role='STAFF'` + `staff_type` rows. `subscriptions`/`pawnshops` rows reference `settings.onboardingSource`/`isTrial` (tenant-governance.service.ts:1342-1353) — no change needed for baseline | Code edit: guard-level defensive normalization (Pattern 3 step 3). Optional (not required) data migration: one UPDATE normalizing remaining legacy rows — **defer** to keep the migration purely additive; the guard handles both shapes |
| Live service config | None (no external service config holds role/permission strings; RLS policies are SQL in `RLS_POLICIES.sql` and unchanged) | None — verified by repo grep |
| OS-registered state | None | None — verified |
| Secrets/env vars | `.env` holds `DATABASE_URL`/`DIRECT_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`VITE_SUPABASE_URL` — no key renames in this phase; backend connects to Postgres via service role (RLS-bypassing) | None |
| Build artifacts | `backend/prisma/seed.ts` is destructive (deleteMany) — must not be pointed at prod; `@prisma/client` must be regenerated after schema change (`npm run build` runs `scripts/prisma-generate-safe.js`) | Code edit: new standalone `seed-permissions.ts`; regenerate client |

## Common Pitfalls

### Pitfall 1: Endpoint opens up during conversion
**What goes wrong:** An `@Roles`-decorated endpoint converted to permissions with a permission missing from the matrix → 403 for everyone; worse, an endpoint *left* with neither decorator → open to any authenticated user.
**Why:** The guard's "no metadata → allow" path (`rbac.guard.ts:62-69`) is a default-open design; the permission model inherits it.
**How to avoid:** Dual-mode guard — if `@Roles` present and `@RequiresPermission` absent, keep evaluating roles (fail-closed fallback). Convert all 63 endpoints in the same wave as the guard change, using the equivalence table; add a spec test enumerating all 63 decorators and asserting each has a mapped permission.
**Warning signs:** A controller with `@Roles` imports removed but no `@RequiresPermission` added.

### Pitfall 2: Permission-name drift between decorators and seed
**What goes wrong:** Typo in a decorator (`pawn_ticket.aprrove`) → endpoint 403s for everyone; or a seeded name never referenced → dead catalog row.
**How to avoid:** Single typed const `PERMISSIONS`; decorator only accepts `keyof typeof PERMISSIONS` values; consistency spec test asserts every const value exists as a `permissions.name` row and every seeded row is in the const.
**Warning signs:** Permission strings appearing as string literals in controllers.

### Pitfall 3: staffType mixed-state enforcement inconsistency (the phase's core bug)
**What goes wrong:** Legacy `role='CASHIER_TELLER'` users behave differently from normalized `role='STAFF'` + staffType users.
**Why:** The 03-24 migration's WHERE clause skipped rows with valid `staff_type`.
**How to avoid:** Guard normalizes legacy role values into (STAFF, staffType) before permission resolution; seed the four staffType rows in the catalog; integration test covers both profile shapes.
**Warning signs:** User created before 2026-03-24 with a specialization role.

### Pitfall 4: Cross-tenant leakage via new models
**What goes wrong:** `ApprovalRecord`/`CustomerKyc`/`CustomerTierHistory` queries without `pawnshopId` filter let tenant A see tenant B's records — the classic horizontal-escalation hole in multi-tenant apps (this backend is Supabase multi-tenant).
**Why:** Permissions are role-global; nothing in the guard is tenant-aware by design.
**How to avoid:** Every new model carries `pawnshopId`; every service query filters by it (mirror `pawn-ticket.service.ts:705` `assertPawnshopId` pattern); the `PawnshopGuard` EXEMPT list must not grow to cover the new approval/KYC endpoints.
**Warning signs:** New list endpoints accepting `pawnshopId` as a query param without service-level scoping (existing anti-pattern at `auction.controller.ts:244` — header pawnshop-id wins over user's own).

### Pitfall 5: SUPABASE_ADMIN / service-role confusion
**What goes wrong:** Assuming RLS will double-enforce the permission catalog. The backend's Prisma connection (`DATABASE_URL`) and `AuthUserService` service-role client both **bypass RLS** — RLS policies keyed on `auth.uid()` never see the app's permission checks.
**Why:** This is the intended architecture (app-layer enforcement), but it means the catalog must never be relied on to protect Supabase-direct access.
**How to avoid:** App-layer `RbacGuard` remains the sole authority for phase-7 permissions; RLS hardening for `bidder_kyc`/`kyc-documents` is explicitly Phase 9 (KYC-05) and unchanged here.
**Warning signs:** New Supabase policies referencing `role_permissions` or app-role claims.

### Pitfall 6: Migration/seed ordering on Supabase
**What goes wrong:** `prisma migrate dev` needs a shadow DB — on Supabase free tier this fails without `shadowDatabaseUrl`/`DIRECT_URL` handling; or the destructive dev `seed.ts` runs against prod.
**Why:** Multi-tenant SaaS DB + brownfield migration tooling.
**How to avoid:** Use `prisma migrate deploy` for prod (no shadow needed); configure `shadowDatabaseUrl` only if `migrate dev` is used locally; keep catalog data inside the migration so no prod seed step exists; never run `prisma migrate reset`/`db push` against prod.
**Warning signs:** `P3014`/shadow-DB errors in CI; `deleteMany` logs in prod.

## Code Examples

> Reference patterns only — implementation is the planner's job. The canonical NestJS guard pattern is the one this codebase already implements (`roles.decorator.ts` + `rbac.guard.ts`); the additions below are the standard data-driven extension (industry consensus, `[CITED: web]`).

### Decorator (mirrors existing `roles.decorator.ts`)
```typescript
// Source: pattern from docs.nestjs.com/security/authorization + roles.decorator.ts:3-4
import { SetMetadata } from '@nestjs/common';
export const PERMISSIONS_KEY = 'permissions';
export const RequiresPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

### Idempotent catalog seed (upsert pattern)
```typescript
// Source: prisma.io/docs (upsert) + prisma.io/dataguide/postgresql (ON CONFLICT) — [CITED]
// In migration SQL instead: INSERT ... ON CONFLICT (name) DO NOTHING;
// dev script equivalent:
await prisma.permission.upsert({
  where: { name: PERMISSIONS.pawn_ticket.approve },
  update: {},
  create: { name: PERMISSIONS.pawn_ticket.approve, group: 'pawn_ticket' },
});
```

### Effective-permission resolution (design sketch)
```typescript
// Sketch: guard step 7 — perms(role) ∪ perms(staffType), DB-per-request (fresh catalog reads)
const rows = await prisma.rolePermission.findMany({
  where: { role: { in: [normalizedRole, ...(staffType ? [staffType] : [])] } },
  select: { permission: { select: { name: true } } },
});
// allow iff required.every((p) => held.has(p))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Hardcoded `@Roles('OWNER','MANAGER')` strings (12 tuples, 63 sites) | Data-driven `@RequiresPermission(...)` + seeded catalog | This phase | Catalog edits change enforcement without deploys (SC2); permission names auditable |
| Guard ignores `staffType` (denies or over-grants staff specializations) | Guard unions base-role + staffType permission sets | This phase | APPRAISER/CASHIER_TELLER/INVENTORY_CUSTODIAN/AUDITOR access correct (SC3) |
| JWT-claim permissions (industry older practice) | Per-request DB resolution (this repo's existing pattern) | Already chosen by codebase shape | Catalog edits take effect immediately; cost = 1 extra indexed read/request |

**Deprecated/outdated:**
- `enum Role` (`schema.prisma:392-400`): dead code — not referenced by any backend type usage; leave as-is (removal is a separate cleanup, not this phase).
- `@Roles('SUPER_ADMIN')` × 25: functionally redundant (guard bypass at `rbac.guard.ts:71`); converted to `platform.manage` for catalog completeness only.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Permission catalog values + role matrix (37 values) match product intent | Permission Catalog | Wrong grants → 403s for legitimate users after conversion; matrix is seeded data, so fixable without code change but needs a re-seed |
| A2 | Generic STAFF should lose `pawn_ticket.appraise` (the one deliberate tightening) | Equivalence table | If the owner expects any STAFF to appraise, this is an access regression — confirm in discuss-phase |
| A3 | StaffType semantics: CASHIER_TELLER/APPRAISER/INVENTORY_CUSTODIAN/AUDITOR get the permission sets listed (over STAFF base) | Pattern 3 | Mis-tuned sets break the daily pawnshop flow (e.g., cashier cannot redeem) |
| A4 | Catalog rows ship inside the migration (not a seed script) | Migration + Seed Strategy | If the project prefers seed-script data (Railway postdeploy hook exists), the deploy adds a step; enforcement behavior identical |
| A5 | `ApprovalTargetType` starts with APPRAISAL/REDEMPTION/LOAN_APPLICATION | Schema Baseline | Phase 8 might need more target types — additive enum extension, low risk |
| A6 | `CustomerKyc` is a new customer-keyed model rather than reusing `BidderKyc` | Schema Baseline | KYC-01 explicitly allows either; reuse would avoid a parallel table but couples pawnshop-client KYC to auction-bidder KYC |
| A7 | `Customer.tier` (enum) coexists with legacy `loyaltyTier` string until Phase 12 | Schema Baseline | Two sources of truth risk drift between phases 7-12; mitigation: Phase 12 owns retirement, baseline keeps writers on `loyaltyTier` |
| A8 | `Receipt.customerId` nullable | Schema Baseline | If product demands receipts always link to a customer, seed/backfill logic is needed in Phase 12 instead |
| A9 | `PawnshopDocument` is the right home for `hasViewed` (ONB-02 admin viewer) | Schema Baseline | If the review modal is per-registration-request rather than per-document, the field belongs on `ClientRegistrationRequest` — confirm in discuss-phase |

## Open Questions (RESOLVED — see PLAN.md for detail)

All four questions were resolved in the Phase 7 plan (`.planning/phases/07-permission-foundation-schema-baseline/PLAN.md`); kept here for traceability.

1. **Catalog row placement — migration vs seed script (A4).** What we know: `prisma migrate deploy` is the prod path (no seed step today); `seed.ts` is destructive. What's unclear: whether the team prefers reference data in migrations (my recommendation) or an explicit seed step. Recommendation: migration + `seed-permissions.ts` for dev; confirm in discuss-phase.
   → **RESOLVED (A4):** catalog rows ship inside the batched migration (`ON CONFLICT DO NOTHING`) + standalone idempotent `seed-permissions.ts` for dev — PLAN.md T2/T6; matches the user's explicit constraint (not the destructive `seed.ts`).
2. **ADMIN's narrow permission set (equivalence-preserving).** What we know: today ADMIN only reaches auction + audit endpoints. What's unclear: whether branch-admin users should also get manager-level operational permissions now that they're normalized to ADMIN. Recommendation: keep equivalence now; let Phase 8 (approval queue for OWNER/ADMIN) and later phases widen; flag as a discuss-phase decision.
   → **RESOLVED:** ADMIN stays narrow (equivalence-preserving); Phase 8+ widens — PLAN.md Assumptions Log A2/A3 and DN-1 context.
3. **Per-tenant role overrides (future).** What we know: catalog is global (role-name keyed), tenant owners have no role-editing UI today. What's unclear: whether Phase 12+ wants `RolePermission.pawnshopId` (NULL = global default). Recommendation: defer; document the extension point.
   → **RESOLVED:** deferred; `RolePermission.pawnshopId` documented as an extension point in PLAN.md §Out of Scope.
4. **Permission caching.** What we know: 3 outbound calls per request today (Supabase getUser + profile + permission join). What's unclear: whether request volume justifies an in-memory TTL cache (30-60s) on the role→permission join. Recommendation: no cache in phase 7 (simplicity, SC2 freshness); revisit if profiling shows hot-path cost.
   → **RESOLVED:** no cache in Phase 7 — per-request DB reads (PLAN.md T8, SC2 freshness, threat register T-07-04).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | ✓ | v26.4.0 (local) | Project has run on it; Prisma 5.22 officially targets Node 18.18+/20.9+/22.11+ — Node 26 works but watch for deprecation warnings |
| npm | Install/scripts | ✓ | 11.17.0 | — |
| Prisma CLI + @prisma/client | Migration, generation, seeding | ✓ | 5.22.0 (verified in node_modules) | — |
| tsx | Seed script runner | ✓ | ^4.7.1 (devDep) | — |
| Supabase Postgres | All schema/migration work | ✓ (config present) | — (remote) | `.env` exists with `DATABASE_URL`/`DIRECT_URL`/service key; **connectivity unverified in this research** — planner should include a preflight `prisma migrate status` step |
| Supabase Auth | Guard JWT verification | ✓ (config present) | — (remote) | Same .env; unverified connectivity |
| jest + ts-jest | Validation suite | ✓ | ^29.5.0 | 21 existing spec files + `test/jest-e2e.json` present |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** none — all tools present; only remote-service connectivity is unverified (preflight step recommended).

## Validation Architecture

> `.planning/config.json` has no `workflow.nyquist_validation` key → treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^29.5.0 + ts-jest (configured in `backend/package.json` `jest` block) |
| Config file | inline in `package.json`; e2e: `test/jest-e2e.json` |
| Quick run command | `npx jest src/common/guards/rbac.guard.spec.ts --runInBand` |
| Full suite command | `npm test -- --runInBand` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RBAC-01 | Guard denies 403 when role lacks permission; allows when catalog grants it | unit | `npx jest src/common/guards/rbac.guard.spec.ts --runInBand` | ❌ Wave 0 |
| RBAC-01 | Every `PERMISSIONS` const value exists in seed catalog and vice versa | unit | `npx jest src/common/permissions/permissions-catalog.spec.ts --runInBand` | ❌ Wave 0 |
| RBAC-01 | All 63 `@Roles` sites have a mapped permission (equivalence completeness) | unit (static scan) | `npx jest src/common/permissions/permissions-catalog.spec.ts --runInBand` | ❌ Wave 0 |
| RBAC-02 | staffType resolution: normalized STAFF+staffType and legacy role forms both resolve; SUPER_ADMIN bypass; generic STAFF denied `pawn_ticket.appraise` | unit | `npx jest src/common/guards/rbac.guard.spec.ts --runInBand` | ❌ Wave 0 |
| RBAC-01/02 | End-to-end 401/403/200 through full APP_GUARD chain | e2e | `npm run test:e2e -- --runInBand` (extend `test/app.e2e-spec.ts`) | ⚠️ exists, needs extension |
| Schema baseline | `prisma migrate deploy` applies cleanly; catalog rows present | smoke (manual/scripted) | `npx prisma migrate deploy && npx prisma db execute --stdin < seed check` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx jest src/common/guards/rbac.guard.spec.ts --runInBand`
- **Per wave merge:** `npm test -- --runInBand`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `backend/src/common/guards/rbac.guard.spec.ts` — covers RBAC-01/RBAC-02 guard decision matrix (SUPER_ADMIN bypass, legacy-role normalization, staffType union, 403)
- [ ] `backend/src/common/permissions/permissions-catalog.spec.ts` — const↔seed consistency + 63-site equivalence scan
- [ ] Migration smoke check (scripted `prisma migrate deploy` against a scratch schema + row-count assertions) — required because Supabase connectivity is unverified

## Security Domain

> `security_enforcement` is not set to `false` in config → enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged (Supabase JWT via `AuthUserService`) |
| V3 Session Management | no | Unchanged |
| V4 Access Control | **yes** | `@RequiresPermission` + catalog-driven `RbacGuard` (this phase); service-level `pawnshopId` scoping remains |
| V5 Input Validation | no | DTOs unchanged this phase |
| V6 Cryptography | no | No new crypto material |

### Known Threat Patterns for {NestJS + Prisma + Supabase}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Vertical escalation via role-string tampering | Elevation | Permissions resolved from DB catalog by profile lookup — client claims carry no role data; never trust JWT claims for authz (only for user id) |
| Horizontal escalation / cross-tenant read (new models) | Information disclosure | `pawnshopId` on `ApprovalRecord`/`CustomerKyc`/`CustomerTierHistory` + service-level filtering; `PawnshopGuard` exempt list unchanged |
| Permission bypass on unguarded routes (default-open guard) | Elevation | Dual-mode guard during conversion; all 63 `@Roles` sites converted in same wave; static equivalence scan in tests |
| TOCTOU on catalog edits | Tampering | Per-request DB resolution (no cache in phase 7) — catalog edit takes effect on next request |
| RLS bypass via service-role connection | — (by design) | Documented: app-layer guard is the authority; Phase 9 owns RLS hardening for KYC documents (KYC-05) |

## Sources

### Primary (HIGH confidence)
- **Codebase (direct reads, tagged `[VERIFIED: codebase]` throughout):** `backend/src/common/guards/rbac.guard.ts`, `backend/src/common/decorators/roles.decorator.ts`, `backend/src/common/auth-user.service.ts`, `backend/src/common/guards/pawnshop.guard.ts`, `backend/src/common/guards/compliance.guard.ts`, `backend/src/app.module.ts`, `backend/prisma/schema.prisma` (1778 lines, full read), `backend/prisma/migrations/20260324_rbac_role_alignment_staff_subroles/migration.sql`, `backend/package.json`, `backend/prisma/seed.ts`, all 63 `@Roles` sites (regex enumeration + representative controllers: `pawn-ticket.controller.ts`, `loan.controller.ts`, `auction.controller.ts`, `tenant-governance.controller.ts`, `compliance.controller.ts`, `app.controller.ts`), `tenant-governance.service.ts:600-1628`, `app.service.ts:486-571`, `pawn-ticket.service.ts:654-692`, `receipt.service.ts`, `loan-contract.service.ts:172-226`, `frontend/src/App.tsx`/`StaffMatrix.tsx` (staffType client handling), `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/config.json`, `AGENTS.md`

### Secondary (MEDIUM confidence)
- `[CITED: docs.nestjs.com/security/authorization]` — canonical RolesGuard/decorator pattern (pattern confirmed as already implemented in this repo)
- `[CITED: prisma.io/docs]` (upsert), `[CITED: prisma.io/dataguide/postgresql]` (INSERT ON CONFLICT) — idempotent seeding patterns
- `[CITED: web]` — industry consensus 2024-2026 on data-driven RBAC (OneUptime Jan 2026; NestBolt Apr 2026; Medium/Abdullahi May 2025; dev.to RBAC guides 2024-2025): three-table model, `verb_noun` naming, DB-driven permissions, avoid magic strings, cache permission lookups

### Tertiary (LOW confidence)
- None used — all design claims are tagged `[ASSUMED]` in the Assumptions Log rather than cited

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all tooling verified in `package.json`/node_modules
- Architecture: HIGH (codebase mechanics) / MEDIUM (catalog values + matrix are `[ASSUMED]` design proposals)
- Pitfalls: HIGH — staffType mixed-state, default-open guard, and cross-tenant vectors verified directly in code

**Research date:** 2026-07-31
**Valid until:** 2026-08-30 (30 days — stable codebase, slow-moving deps)
