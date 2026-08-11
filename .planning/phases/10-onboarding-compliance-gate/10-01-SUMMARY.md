---
phase: 10-onboarding-compliance-gate
plan: 01
subsystem: api
tags: [nestjs, prisma, raw-sql, tenant-governance, onboarding, compliance-gate, trial-activation]

# Dependency graph
requires:
  - phase: 07
    provides: "PawnshopDocument model with ComplianceDocType/ComplianceDocStatus enums (hasViewed/viewedAt/viewedBy baseline) and the client-registration approval flow"
provides:
  - "ONB-01 server-side docs-before-trial gate on reviewClientRegistrationRequest APPROVED branch"
  - "REQUIRED_ONBOARDING_DOC_TYPES shared 7-type const (D-02 single source of truth)"
  - "Mocked-Prisma spec coverage for gate pass/fail/skip (5 cases)"
affects: [10-03, 10-02, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Raw-SQL enum-array binding: Prisma.sql + Prisma.join so every enum value is a bound parameter, never interpolated into SQL text"
    - "Literal enum IN-list ('UPLOADED','UNDER_REVIEW','VERIFIED') matches module's existing enum-cast style"
    - "Mocked-Prisma direct-construction harness extended with jest.spyOn on private helpers (ensureRegistrationChatTables / ensureTenantModuleConfigTable)"

key-files:
  created:
    - .planning/phases/10-onboarding-compliance-gate/deferred-items.md
  modified:
    - backend/src/tenant-governance/tenant-governance.service.ts
    - backend/src/tenant-governance/tenant-governance.service.spec.ts
    - backend/src/approval/approval.controller.spec.ts

key-decisions:
  - "D-01 gate sits at the top of the APPROVED branch, before ensureTenantModuleConfigTable(), so a blocked approval has zero pawnshop/tenant-config/subscription side effects"
  - "D-02 REQUIRED_ONBOARDING_DOC_TYPES is the single source of truth for the 7-type set, mirroring the uploadRegistrationDocument allow-list"
  - "D-03 gate status set UPLOADED/UNDER_REVIEW/VERIFIED; REJECTED/EXPIRED fail the gate"
  - "Gate failure throws BadRequestException 400 listing the missing types"
  - "Fixture extension beyond plan's literal list: adminInvite.update and subscription.create mocks added so the gate-pass test's activation flow completes"

patterns-established:
  - "Chokepoint enforcement: one guard at the single approval decision point rather than scattered UI checks"

requirements-completed: [ONB-01]

coverage:
  - id: D1
    description: "ONB-01 server-side docs-before-trial gate: SUPER_ADMIN approval of a registration missing any of the 7 required doc types (or with a type in REJECTED/EXPIRED) is rejected with a 400 naming the missing types and zero pawnshop/tenant-config/subscription side effects; APPROVED with all 7 types in UPLOADED/UNDER_REVIEW/VERIFIED proceeds to the unchanged trial-activation flow; CONTACTED/REJECTED decisions never execute the gate"
    requirement: "ONB-01"
    verification:
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#blocks APPROVED when a required document type is missing, with zero side effects"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#blocks APPROVED when a required document is REJECTED or EXPIRED"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#approves when all 7 required document types are acceptable"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#skips the gate for CONTACTED decisions"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#skips the gate for REJECTED decisions"
        status: pass
    human_judgment: false

# Metrics
duration: 28min
completed: 2026-08-11
status: complete
---

# Phase 10 Plan 1: ONB-01 Docs-Before-Trial Gate Summary

**Server-side 7-doc compliance gate on the SUPER_ADMIN registration-approval chokepoint: APPROVED aborts with a 400 listing missing/REJECTED/EXPIRED types before any pawnshop/tenant-config/subscription write, backed by a shared REQUIRED_ONBOARDING_DOC_TYPES const and 5 mocked-Prisma gate specs**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-08-11T07:48:43Z
- **Completed:** 2026-08-11T08:16:xxZ
- **Tasks:** 2 (+1 blocker fix)
- **Files modified:** 3

## Accomplishments

- Inserted the ONB-01 gate at the top of the `if (decision === 'APPROVED')` branch in `reviewClientRegistrationRequest` (tenant-governance.service.ts:1464), immediately before `ensureTenantModuleConfigTable()` — a single `$queryRaw` LEFT JOIN returns the required doc types that have NO acceptable doc (`status IN ('UPLOADED','UNDER_REVIEW','VERIFIED')`); non-empty result throws `BadRequestException` 400 listing the missing types with zero side effects.
- Added the exported `REQUIRED_ONBOARDING_DOC_TYPES` const (DTI_REGISTRATION, MAYORS_PERMIT, BIR_COR, BSP_LICENSE, AMLC_REGISTRATION, GOVERNMENT_ID, PROOF_OF_ADDRESS) — byte-identical to the `uploadRegistrationDocument` allow-list and reusable by 10-03 `getMyRegistrationStatus`.
- Added a `reviewClientRegistrationRequest ONB-01 gate` describe block with 5 mocked-Prisma cases: missing type → 400 + zero side effects; REJECTED/EXPIRED type → 400; all-7-acceptable → activation flow reached; CONTACTED/REJECTED → gate skipped (`$queryRaw` exactly once).
- Confirmed `npx tsc --noEmit` exit 0 and `npm test -- --testPathPattern="tenant-governance" --silent` 7/7 green (2 pre-existing branding tests + 5 new gate tests).

## Task Commits

Each task was committed atomically:

1. **Task 1: Insert the 7-doc gate into the APPROVED branch of reviewClientRegistrationRequest** - `2c18fc2` (feat)
2. **Task 2: Mocked-Prisma spec coverage for the gate (pass / fail / skip)** - `15a72bb` (test)
3. **Rule 3 blocker: pre-existing tsc failure in approval controller spec** - `74f696d` (fix)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `backend/src/tenant-governance/tenant-governance.service.ts` - `REQUIRED_ONBOARDING_DOC_TYPES` const + ONB-01 gate block at the top of the APPROVED branch
- `backend/src/tenant-governance/tenant-governance.service.spec.ts` - extended shared prisma mock (pawnshop.findFirst, adminInvite.findFirst/update, subscription.findFirst/create) + 5 gate cases in a new describe block
- `backend/src/approval/approval.controller.spec.ts` - type-only `as any` on the `caller` mock (Rule 3 tsc blocker fix; no behavior change)
- `.planning/phases/10-onboarding-compliance-gate/deferred-items.md` - out-of-scope full-suite failures logged

## Decisions Made

- Gate enforced at the single chokepoint (D-01): top of the APPROVED branch, before `ensureTenantModuleConfigTable()`, so a failed gate guarantees no pawnshop/tenant-config/subscription writes.
- `REQUIRED_ONBOARDING_DOC_TYPES` exported as the D-02 single source of truth (10-03 will import it).
- Gate status semantics per D-03: UPLOADED/UNDER_REVIEW/VERIFIED acceptable; REJECTED/EXPIRED fail.
- Enum-array binding via `Prisma.sql` + `Prisma.join` — every type value is a bound parameter (T-10-02 mitigated); the status IN-list is a literal following the module's existing convention.
- Fixture completion: the plan's literal mock list omitted `adminInvite.update` and `subscription.create`, which the gate-pass test's activation flow calls; added both to the shared mock.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing tsc TS2345 in approval.controller.spec.ts blocked the mandatory tsc gate**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** At HEAD (file untouched by this plan), `approval.controller.spec.ts` passes a plain-object `caller` mock where the controller's `@Req() req: Request` is typed — TS2345 at 3 call sites, making `npx tsc --noEmit` fail before any of this plan's verification could pass.
- **Fix:** Typed the mock declaration as `any` (`const caller = {...} as any;`). Runtime behavior unchanged — the controller reads `(req as any).user ?? req`, so the plain object already worked.
- **Files modified:** `backend/src/approval/approval.controller.spec.ts` (outside plan scope — documented per scope-boundary rule "unless necessary")
- **Verification:** `npx tsc --noEmit` exit 0; full suite: approval specs pass.
- **Committed in:** `74f696d`

**2. [Minor fixture extension - spec task] adminInvite.update / subscription.create mocks added to the shared prisma mock**
- **Found during:** Task 2 (writing the gate-pass case)
- **Issue:** The plan's listed fixture set (pawnshop.findFirst, adminInvite.findFirst, subscription.findFirst) would make the gate-pass test throw `TypeError: prisma.adminInvite.update is not a function` / `prisma.subscription.create is not a function` when the activation flow completes.
- **Fix:** Added `adminInvite.update` and `subscription.create` jest.fn()s to the shared mock and stubbed their resolutions in the new describe's beforeEach.
- **Files modified:** `backend/src/tenant-governance/tenant-governance.service.spec.ts`
- **Verification:** gate-pass test green; `$executeRaw`/`pawnshop.findFirst` assertions pass.
- **Committed in:** `15a72bb`

---

**Total deviations:** 2 (1 Rule 3 blocker, 1 minor fixture extension within the spec task)
**Impact on plan:** No scope creep. The tsc fix was required for the plan's mandatory verification gate; the fixture extension was required for the plan's own test to run.

## Issues Encountered

- **Task 1 code pre-existing in the working tree:** The gate block + const were already present as uncommitted working-tree changes when execution began (a prior wave evidently wrote them before stopping). Verified the code matches the plan's specification line-for-line (const placement, SQL shape, exception message), confirmed `git diff` vs HEAD shows only the gate + const (+25 lines), then committed it as Task 1.
- **Full backend suite (6 suites / 36 tests failing):** Pre-existing failures in attendance/notification/queue/auction-settlement/loan-contract/loan-history specs (DI wiring, e.g. `LoanService` cannot resolve `NotificationService`). Independent of this plan's commits — none of the failing suites import any file changed here. Logged to `deferred-items.md` for the wave-merge/full-suite gate; the 10-01 scoped gates (tsc + tenant-governance) are green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ONB-01 gate shipped and covered — the audit finding "Docs-before-trial gate MISSING" is closed server-side.
- `REQUIRED_ONBOARDING_DOC_TYPES` exported and ready for 10-03 (`getMyRegistrationStatus` aggregation).
- 10-02 (view-before-approve) shares `tenant-governance.service.ts` and was held for the next wave as planned — no conflicts introduced (no signature changes, no new imports beyond the already-present `Prisma` namespace).
- Blockers for the wave merge: the 6 pre-existing full-suite failures listed in `deferred-items.md` must be resolved by their owning workstreams before the full-suite gate.

## Self-Check: PASSED

- Files exist: tenant-governance.service.ts, tenant-governance.service.spec.ts, approval.controller.spec.ts, 10-01-SUMMARY.md, deferred-items.md
- Commits exist: `74f696d` (fix), `2c18fc2` (feat), `15a72bb` (test)

---
*Phase: 10-onboarding-compliance-gate*
*Completed: 2026-08-11*
