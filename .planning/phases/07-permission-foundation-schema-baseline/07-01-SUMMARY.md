---
phase: 07-permission-foundation-schema-baseline
plan: 01
subsystem: auth
tags: [rbac, permissions, prisma, nestjs, authorization, stafftype]

# Dependency graph
requires:
  - phase: 06-auction-house
    provides: v1.0 platform with 10-role @Roles authorization on 63 endpoints
provides:
  - Data-driven permission catalog (37 permissions) + role→permission mapping (101 rows) seeded via batched migration and standalone idempotent script
  - @RequiresPermission decorator + staffType-aware dual-mode RbacGuard with SUPER_ADMIN bypass
  - Full 63-endpoint conversion from @Roles to @RequiresPermission in one pass
  - v2.0 schema baseline: ApprovalRecord, CustomerKyc, CustomerTierHistory, Permission, RolePermission + 12 additive columns
affects: [phase-08-approval, phase-09-kyc, phase-10-onboarding, phase-11-contract, phase-12-customer-tiering]

# Tech tracking
tech-stack:
  added: []
  patterns: [flat typed permission const as single source of truth, per-request DB permission read (no cache), dual-mode guard with fail-closed @Roles fallback]

key-files:
  created:
    - backend/prisma/migrations/20260731200000_v2_schema_baseline/migration.sql
    - backend/prisma/seed-permissions.ts
    - backend/src/common/permissions/permissions.const.ts
    - backend/src/common/permissions/permissions.service.ts
    - backend/src/common/permissions/permissions.module.ts
    - backend/src/common/permissions/permissions-catalog.spec.ts
    - backend/src/common/permissions/permissions.service.spec.ts
    - backend/src/common/decorators/requires-permission.decorator.ts
    - backend/src/common/guards/rbac.guard.spec.ts
  modified:
    - backend/prisma/schema.prisma
    - backend/src/common/guards/rbac.guard.ts
    - backend/src/common/common.module.ts
    - backend/src/loan/pawn-ticket.controller.ts
    - backend/src/loan/loan.controller.ts
    - backend/src/tenant-governance/tenant-governance.controller.ts
    - backend/src/app.controller.ts
    - backend/src/compliance/compliance.controller.ts
    - backend/src/auction/auction.controller.ts
    - backend/test/app.e2e-spec.ts

key-decisions:
  - "Migration-shipped catalog is the production source of truth (37 permissions, 101 role_permissions, ON CONFLICT DO NOTHING); seed-permissions.ts is a dev-only idempotent convenience mirror"
  - "ADMIN kept intentionally narrow (8 permissions) — no broad grants until Phase 8/9 define its approval responsibilities"
  - "Per-tenant permission overrides deferred — catalog is global per role"
  - "No caching: PermissionService reads role_permissions per request for SC2 freshness (TOCTOU mitigation)"
  - "Exactly one deliberate tightening: generic STAFF loses pawn_ticket.appraise (APPRAISER-only now)"

patterns-established:
  - "Single typed PERMISSIONS const is the source of truth for decorators, seed, migration SQL, and specs (permissions-catalog.spec.ts machine-asserts all four stay in sync)"
  - "Dual-mode guard: @RequiresPermission path wins; @Roles-only sites fall back fail-closed; SUPER_ADMIN bypasses before any permission lookup"
  - "Legacy-role normalization: role in {CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR} is normalized to STAFF + staffType before union resolution"

requirements-completed: [RBAC-01, RBAC-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Data-driven permission catalog: permissions (37) + role_permissions (101) seeded via one batched v2 schema baseline migration and idempotent seed script"
    requirement: RBAC-01
    verification:
      - kind: unit
        ref: "src/common/permissions/permissions-catalog.spec.ts#holds exactly 37 distinct values in the const"
        status: pass
      - kind: unit
        ref: "src/common/permissions/permissions-catalog.spec.ts#matches the migration SQL permission names both ways"
        status: pass
      - kind: unit
        ref: "src/common/permissions/permissions-catalog.spec.ts#ROLE_PERMISSIONS references only const values and sums to 101 mappings"
        status: pass
    human_judgment: false
  - id: D2
    description: "@RequiresPermission decorator + staffType-aware dual-mode RbacGuard with SUPER_ADMIN bypass and fail-closed @Roles fallback"
    requirement: RBAC-02
    verification:
      - kind: unit
        ref: "src/common/guards/rbac.guard.spec.ts#RbacGuard (12-case decision matrix)"
        status: pass
      - kind: unit
        ref: "src/common/permissions/permissions.service.spec.ts#PermissionService"
        status: pass
    human_judgment: false
  - id: D3
    description: "One-pass migration of all 63 @Roles sites to @RequiresPermission with strict holder-coverage equivalence (single appraise exception)"
    requirement: RBAC-01
    verification:
      - kind: unit
        ref: "src/common/permissions/permissions-catalog.spec.ts#63-site equivalence scan"
        status: pass
    human_judgment: false
  - id: D4
    description: "v2.0 schema baseline applied to live Supabase: 4 enums, 5 models, 12 additive columns; migration status clean"
    verification:
      - kind: manual_procedural
        ref: "npx prisma migrate status -> 'Database schema is up to date'"
        status: pass
    human_judgment: false

# Metrics
duration: 70min
completed: 2026-07-31
status: complete
---

# Phase 7: Permission Foundation & Schema Baseline Summary

**Data-driven permission catalog (37 permissions, 101 role→permission rows) with a staffType-aware dual-mode RbacGuard replacing hardcoded @Roles on all 63 endpoints, on top of the batched v2.0 schema baseline (ApprovalRecord, CustomerKyc, CustomerTierHistory + 12 additive columns)**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-07-31 20:04 (+0800)
- **Completed:** 2026-07-31 20:45 (+0800)
- **Tasks:** 13 (10 execution commits)
- **Files modified:** 15 source/artifact files

## Accomplishments
- Seeded permission catalog (37 permissions / 101 role_permissions) shipped inside one batched additive migration, applied cleanly to live Supabase
- RbacGuard rewritten as staffType-aware dual-mode guard: @RequiresPermission path wins, @Roles fallback stays fail-closed, SUPER_ADMIN bypasses before permission lookup
- All 63 @Roles endpoints converted to @RequiresPermission in one pass — machine-asserted by a static equivalence scan (zero @Roles-only endpoints)
- PermissionService resolves effective permissions per request (role ∪ staffType) with no cache — catalog edits change enforcement on the next request
- Verified 2026-08-01: migration applied, schema up-to-date, guard/catalog/service suites green, `tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema baseline models + additive columns** - `eeddf64` (feat)
2. **Task 2: Batched v2 schema baseline migration** - `7707b91` (feat)
3. **Task 4: Apply migration + assert catalog rows** - `cdfe2f6` (feat)
4. **Task 5: PERMISSIONS const + @RequiresPermission decorator** - `70bd2ee` (feat)
5. **Task 6: Idempotent standalone seed script** - `c9d51c5` (feat)
6. **Task 7: Guard/catalog/service specs (RED)** - `a4782f3` (test)
7. **Task 8: PermissionService + module wiring** - `6a28892` (feat, with guard path)
8. **Task 9: RbacGuard rewrite** - `6a28892` (feat, with service)
9. **Task 10: Loan-domain conversion (26 sites)** - `376af55` (feat)
10. **Task 11: Platform-domain conversion (25 sites)** - `376af55` (feat)
11. **Task 12: Compliance + auction conversion (12 sites)** - `51e8e67` (feat)
12. **Task 13: PERMISSIONS const refs + legacy-role normalization** - `3c47418` (refactor)

**Plan metadata:** `62025fe` (docs: plan phase 7)

## Files Created/Modified
- `backend/prisma/schema.prisma` - 4 new enums, 5 new models (Permission, RolePermission, ApprovalRecord, CustomerKyc, CustomerTierHistory), 12 additive columns on Customer/Receipt/PawnshopDocument/LoanContract
- `backend/prisma/migrations/20260731200000_v2_schema_baseline/migration.sql` - batched additive DDL + catalog seed (ON CONFLICT DO NOTHING)
- `backend/src/common/permissions/permissions.const.ts` - flat typed PERMISSIONS const + ROLE_PERMISSIONS matrix
- `backend/src/common/permissions/permissions.service.ts` - resolveEffectivePermissions(role, staffType)
- `backend/src/common/permissions/permissions.module.ts` - module wiring
- `backend/src/common/decorators/requires-permission.decorator.ts` - PERMISSIONS_KEY + RequiresPermission
- `backend/src/common/guards/rbac.guard.ts` - staffType-aware dual-mode rewrite
- `backend/prisma/seed-permissions.ts` - standalone idempotent seed
- 6 controllers + app.e2e-spec.ts - 63 decorator conversions
- 3 spec files - guard matrix, catalog consistency, service contract

## Decisions Made
- Migration-shipped catalog is production truth; seed script is a dev convenience
- ADMIN kept narrow (8 permissions) until Phases 8/9 define its role
- Per-tenant overrides deferred; no caching (per-request DB read)
- Exactly one deliberate tightening: generic STAFF no longer appraises

## Deviations from Plan

None - plan executed as written. Task 13 (normalization refactor) was folded into the conversion commits; the plan's 5-wave ordering was preserved.

## Issues Encountered
- None — migration applied cleanly, tests green, no Supabase connectivity issues.

## User Setup Required

None - no external service configuration required. Production catalog data ships in the migration (already deployed).

## Next Phase Readiness
- Phase 8 (Approval Workflows) can consume the `approval_records` model and `approval.*` permissions already in the catalog
- All guard machinery (dual-mode, staffType normalization, SUPER_ADMIN bypass) is live — Phase 8 approval queue endpoints can be protected with `approval.view_queue` / `approval.approve_appraisal` / `approval.approve_redemption`
- **Heads-up:** the working tree carries ~100 uncommitted files (owner registration, KYC, tenant governance, etc.) unrelated to Phase 7; Phase 7's own verification was run against the working tree and its suites pass, but a clean-tree test baseline should be re-established before Phase 8 execution if those changes are committed/stashed later

---
*Phase: 07-permission-foundation-schema-baseline*
*Completed: 2026-07-31*
