---
phase: 09-kyc-verification-disbursement-guardrail
plan: 01
subsystem: api
tags: [nestjs, prisma, kyc, permissions, rbac, validation]

# Dependency graph
requires:
  - phase: 07-schema-baseline
    provides: CustomerKyc model + Customer.kycStatus (KycStatus enum, default NOT_SUBMITTED)
provides:
  - Tenant-scoped customer KYC module (upsert / list / review) with dual-column status sync
  - MANAGER role kyc.view + kyc.verify permission grant
  - PH PhilSys National ID 12-digit validator fix
affects: [09-kyc-verification-disbursement-guardrail (plan 09-02 disbursement gates), 10-frontend, verify-work UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dual-column denormalized status writes in one interactive Prisma $transaction
    - Find-or-create customer by fullName + contactNumber for walk-in counter capture
    - Caller pawnshop resolution via user.pawnshopId ?? req.headers['pawnshop-id']
    - Guarded permissions metadata asserted via Reflect.getMetadata in specs

key-files:
  created:
    - backend/src/kyc/kyc.module.ts
    - backend/src/kyc/kyc.controller.ts
    - backend/src/kyc/kyc.service.ts
    - backend/src/kyc/dto/upsert-customer-kyc.dto.ts
    - backend/src/kyc/dto/review-customer-kyc.dto.ts
    - backend/src/kyc/kyc.service.spec.ts
    - backend/src/kyc/kyc.controller.spec.ts
  modified:
    - backend/src/kyc/kyc-validation.ts
    - backend/src/app.module.ts
    - backend/src/common/permissions/permissions.const.ts
    - backend/src/common/permissions/permissions-catalog.spec.ts
    - backend/prisma/migrations/20260731120000_v2_schema_baseline/migration.sql

key-decisions:
  - "D-01 counter upsert stays ungated; GET list gated kyc.view; PATCH review gated kyc.verify (from CONTEXT/RESEARCH, kept as planned)"
  - "D-02 dual-column writes (CustomerKyc.status + Customer.kycStatus) in one interactive $transaction; specs assert top-level mocks never called"
  - "D-14 mocked-Prisma specs only; no live-DB dependency (kept as planned)"
  - "Added explicit 404 (NotFoundException) on dto.customerId miss — Rule 2 deviation, prevents phantom duplicate customer creation"

patterns-established:
  - "Interactive $transaction dual-write is asserted by capture-tx harness: top-level prisma mock must NOT be called (dual-column invariant)"
  - "Tenant scoping mirrors approval.controller.ts: user.pawnshopId ?? req.headers['pawnshop-id']"
  - "Cross-tenant review guard mirrors approval.service.ts:119-121 (ForbiddenException unless SUPER_ADMIN)"

requirements-completed: [KYC-01, KYC-02]

# Coverage metadata — drives DETERMINISTIC UAT routing in verify-work
coverage:
  - id: D1
    description: "Staff counter KYC capture — POST /kyc/customers (ungated) upserts CustomerKyc PENDING and Customer.kycStatus PENDING inside one interactive transaction, creating a walk-in customer when none matches"
    requirement: KYC-01
    verification:
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#writes CustomerKyc PENDING and Customer.kycStatus PENDING inside one interactive transaction"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#creates a customer when dto.customerId is absent and no match exists"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.controller.spec.ts#POST /kyc/customers delegates to upsertCustomerKyc with the caller pawnshopId"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tenant review list — GET /kyc/customers returns records scoped to caller pawnshop (optional status filter), requires kyc.view permission"
    requirement: KYC-01
    verification:
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#returns KYC records scoped to the caller pawnshop"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#applies the status filter when provided"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.controller.spec.ts#exposes GET /kyc/customers guarded by kyc.view"
        status: pass
    human_judgment: false
  - id: D3
    description: "Review decision — PATCH /kyc/customers/:id/review (requires kyc.verify) writes VERIFIED or REJECTED to both columns in one transaction, enforces non-blank rejection reason, blocks already-decided records and cross-tenant reviewers (SUPER_ADMIN exempt)"
    requirement: KYC-02
    verification:
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#approves a PENDING record writing VERIFIED to both columns in one transaction"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#rejects a PENDING record persisting the rejection reason"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.service.spec.ts#forbids cross-tenant review unless the caller is SUPER_ADMIN"
        status: pass
      - kind: unit
        ref: "backend/src/kyc/kyc.controller.spec.ts#exposes PATCH /kyc/customers/:id/review guarded by kyc.verify"
        status: pass
    human_judgment: false
  - id: D4
    description: "MANAGER role gains kyc.view + kyc.verify — permissions.const.ts MANAGER block, migration SQL seed rows, and catalog spec counts (101→103 mappings, 67→69 endpoint sites across 8 controllers) updated in lockstep"
    requirement: KYC-02
    verification:
      - kind: unit
        ref: "backend/src/common/permissions/permissions-catalog.spec.ts#ROLE_PERMISSIONS references only const values and sums to 103 mappings"
        status: pass
      - kind: unit
        ref: "backend/src/common/permissions/permissions-catalog.spec.ts#finds all 69 migrated endpoints across the 8 controllers"
        status: pass
    human_judgment: false
  - id: D5
    description: "National ID validator accepts exactly 12 digits (PH PhilSys PSN, e.g. 123456789012) with corrected error message — the two previously-failing kyc-validation.spec.ts tests are green"
    requirement: KYC-01
    verification:
      - kind: unit
        ref: "backend/src/kyc/kyc-validation.spec.ts#rejects invalid national id length"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-08-09
status: complete
---

# Phase 09 Plan 01: KycModule (upsert/list/review) + MANAGER grant + 12-digit fix Summary

**Tenant-scoped customer KYC backend module (POST/GET /kyc/customers + PATCH review) with dual-column status sync in interactive $transaction, MANAGER kyc.view/kyc.verify RBAC grant in const + migration + catalog lockstep, and the PH PhilSys 12-digit National ID validator fix**

## Performance

- **Duration:** ~5 min of task commits (20:04:28 → 20:08:58 +0800); session included earlier setup/verification
- **Started:** 2026-08-09T12:04:28Z
- **Completed:** 2026-08-09T12:08:58Z
- **Tasks:** 3
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments
- KycModule wired: `POST /kyc/customers` (ungated counter capture), `GET /kyc/customers` (tenant-scoped, `kyc.view`), `PATCH /kyc/customers/:id/review` (`kyc.verify` + AuditLog KYC_REVIEW), registered in app.module.ts after ApprovalModule
- Dual-column status invariant: `CustomerKyc.status` and `Customer.kycStatus` always written together in one interactive `$transaction` (upsert → PENDING; review → VERIFIED/REJECTED); walk-in find-or-create by fullName + contactNumber
- Cross-tenant review guard (`ForbiddenException` unless SUPER_ADMIN), already-decided guard, non-blank rejection-reason enforcement, 404 on unknown customerId
- MANAGER role granted `kyc.view` + `kyc.verify` in permissions.const.ts, migration SQL seed, and catalog spec (101→103 mappings, 67→69 sites, 7→8 controllers)
- National ID validation fixed to exactly 12 digits; kyc-validation suite green 10/10 (previously 2 failing)
- 42 tests green across kyc-validation (10), kyc.service (15), kyc.controller (9), permissions-catalog (8); tsc clean for all plan files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create KycModule with DTOs, service, controller + 12-digit fix** - `d1af104` (feat)
2. **Task 2: KycService + KycController mocked-Prisma specs** - `881bb97` (test)
3. **Task 3: MANAGER kyc.view/kyc.verify grant (const + migration + catalog)** - `ebe57ee` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified
- `backend/src/kyc/kyc.module.ts` - Module wiring (PrismaModule, KycController, KycService)
- `backend/src/kyc/kyc.controller.ts` - POST /customers (ungated, @HttpCode(OK)), GET /customers (kyc.view), PATCH /customers/:id/review (AuditLog KYC_REVIEW + kyc.verify); pawnshopId = user.pawnshopId ?? header
- `backend/src/kyc/kyc.service.ts` - upsertCustomerKyc / listCustomers / review with dual-column $transaction writes, find-or-create, guards
- `backend/src/kyc/dto/upsert-customer-kyc.dto.ts` - fullName, contactNumber, address, idType (KycIdType), idNumber, idFrontUrl, idBackUrl?, selfieUrl?, verificationData?, customerId?
- `backend/src/kyc/dto/review-customer-kyc.dto.ts` - decision @IsIn(['VERIFIED','REJECTED']), rejectionReason optional MaxLength(500)
- `backend/src/kyc/kyc.service.spec.ts` - 15 tests, capture-tx dual-column harness (top-level mocks not called)
- `backend/src/kyc/kyc.controller.spec.ts` - 9 tests incl. metadata reflection + header fallback
- `backend/src/kyc/kyc-validation.ts` - 12-digit National ID regex + message (was 16)
- `backend/src/app.module.ts` - KycModule imported after ApprovalModule
- `backend/src/common/permissions/permissions.const.ts` - MANAGER block gains kyc.view, kyc.verify
- `backend/src/common/permissions/permissions-catalog.spec.ts` - MATRIX entries kyc.controller.ts::list (['OWNER','ADMIN','MANAGER'], kyc.view) and ::review (same tuple, kyc.verify); counts 101→103 / 67→69 / 8 controllers
- `backend/prisma/migrations/20260731120000_v2_schema_baseline/migration.sql` - ('MANAGER','kyc.view'), ('MANAGER','kyc.verify') seed rows

## Decisions Made
- Followed locked decisions D-01, D-02, D-04, D-05, D-14 exactly (ungated counter upsert; dual-column interactive transaction; kyc.view/kyc.verify gates; bidder /auth/kyc/* untouched; mocked-Prisma specs)
- Added explicit `NotFoundException('Customer not found')` when `dto.customerId` is provided but does not exist — without it the find-or-create fallback would silently create a phantom duplicate customer (Rule 2)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Explicit 404 on unknown customerId in upsert**
- **Found during:** Task 1 (KycService upsert implementation)
- **Issue:** With `dto.customerId` provided, a typo'd ID would fall through to find-or-create and create a second customer row — silent data corruption at a trust boundary
- **Fix:** `findUnique` existence check raising `NotFoundException('Customer not found')` before the find-or-create path
- **Files modified:** backend/src/kyc/kyc.service.ts
- **Verification:** kyc.service.spec.ts#throws NotFoundException when dto.customerId does not exist (pass)
- **Committed in:** d1af104 (Task 1 commit)

**2. [Rule 1 - Bug] Prisma Json strictness on verificationData cast**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `verificationData` (Json) failed strict TS assignment in the upsert payload
- **Fix:** Cast `as Prisma.InputJsonValue` (2 occurrences; `Prisma` namespace import added)
- **Files modified:** backend/src/kyc/kyc.service.ts
- **Verification:** tsc --noEmit shows zero errors in plan files
- **Committed in:** d1af104 (Task 1 commit)

**3. [Minor - Spec harness] Added prisma.customer.create mock**
- **Found during:** Task 2 (spec authoring)
- **Issue:** Plan's harness list omitted `customer.create`, but the find-or-create behavior asserts it
- **Fix:** Mock added to harness; dual-column invariant proven by asserting top-level mocks NOT called (capture-tx pattern)
- **Files modified:** backend/src/kyc/kyc.service.spec.ts
- **Verification:** 15/15 service tests pass
- **Committed in:** 881bb97 (Task 2 commit)

**4. [Minor - Plan bookkeeping] kyc-validation.spec.ts listed in files_modified but unchanged**
- **Found during:** Task 1
- **Issue:** The two failing validation tests already existed; only kyc-validation.ts source needed fixing
- **Fix:** Source fixed; spec file left untouched (its failures were the RED baseline)
- **Verification:** kyc-validation suite green 10/10 after fix
- **Committed in:** d1af104 (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (1 missing critical, 1 bug, 2 minor)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. No architectural changes required (Rule 4 not triggered).

## Issues Encountered
- **Pre-existing tsc errors (out of scope, not fixed):** `backend/src/approval/approval.controller.spec.ts` lines 31/42/57 (TS2345 — caller object vs Request type) and `backend/src/approval/approval.service.spec.ts:412` (TS2339 requiresApproval) fail `tsc --noEmit`. Cause: committed spec files vs dirty uncommitted prior-work sources (`approval.service.ts`, `pawn-ticket.service.ts`) — a pre-existing working-tree inconsistency in files this plan does not touch. Verified absent from plan files. Logged to `deferred-items.md`.
- One of my own spec lines initially had the same TS2345 trap (plain object passed to a `Request` param) — fixed with `as any` cast before commit; new specs are type-clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- **09-02 (disbursement gates):** can read `Customer.kycStatus` produced here for gate logic
- **Frontend review flow:** has POST/GET/PATCH endpoints, DTO shapes, and MANAGER permissions to consume
- **Deferred:** 4 pre-existing tsc errors in approval specs (requires the pending approval/pawn-ticket source work to land); `ConflictException` import in kyc.service.ts is unused-but-allowed (no noUnusedLocals) to match plan's import list

---
*Phase: 09-kyc-verification-disbursement-guardrail*
*Completed: 2026-08-09*

## Self-Check: PASSED

- Files verified on disk: 7 kyc module files + SUMMARY.md + deferred-items.md (all FOUND)
- Commits verified in git history: `d1af104`, `881bb97`, `ebe57ee` (all FOUND)
- Tests: 42/42 green (kyc-validation 10, kyc.service 15, kyc.controller 9, permissions-catalog 8)
- tsc: zero errors in plan files; 4 pre-existing approval-spec errors documented as deferred
