---
phase: 10-onboarding-compliance-gate
plan: 03
subsystem: api
tags: [nestjs, prisma, raw-sql, tenant-governance, onboarding, idor, aggregation]

# Dependency graph
requires:
  - phase: 10-01
    provides: "ONB-01 gate + REQUIRED_ONBOARDING_DOC_TYPES const (single source for the 7 required types) in tenant-governance.service.ts"
  - phase: 10-02
    provides: "review/view doc endpoints + onboarding permission wiring in the same controller/service (shared files — this plan ran sequentially after it)"
provides:
  - "GET tenant-governance/client-registrations/me/status (D-09): owner-scoped aggregated onboarding state { overall, documents, submissionStatus }"
  - "getMyRegistrationStatus(actorUserId) service method: most-recent non-CANCELLED request by lower(owner_email) = lower(profile.email); DRAFT included; no-request shape { overall: 'INCOMPLETE', documents: [], submissionStatus: 'NONE' }"
  - "D-10 overall derivation with REJECTED dominance: any REJECTED -> ACTION_REQUIRED; missing required type -> INCOMPLETE; all 7 VERIFIED -> APPROVED; else PENDING_REVIEW"
  - "documents entries carry { document_type, status, rejection_reason } — rejection_reason passthrough powers ONB-04 dashboard rejection copy"
  - "8 mocked-Prisma ONB-03 spec cases in tenant-governance.service.spec.ts"
affects: [10-04, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-scoped raw-SQL aggregation: $queryRaw with lower(owner_email) = lower(${ownerEmail}) bind — no requestId parameter, no cross-owner reads (IDOR-safe)"
    - "Route shadowing avoidance: static /me/status declared immediately after /me and before any :requestId param route"
    - "Aggregation reads REQUIRED_ONBOARDING_DOC_TYPES (exported const) so gate and status aggregation cannot drift"

key-files:
  created: []
  modified:
    - backend/src/tenant-governance/tenant-governance.service.ts
    - backend/src/tenant-governance/tenant-governance.controller.ts
    - backend/src/tenant-governance/tenant-governance.service.spec.ts

key-decisions:
  - "Aggregation picks the most-recent non-CANCELLED request in JS (find over the ordered raw rows) — mirrors App.tsx rows[0] owner-flow ordering; CANCELLED never drives the banner"
  - "DRAFT requests are included in the pick (unlike listMyClientRegistrationRequests which filters status <> 'DRAFT') — a draft with missing docs must surface as INCOMPLETE"
  - "ownerEmail uses the trimmed profile email in the WHERE bind (module convention from listMyClientRegistrationRequests); SQL shape identical to the plan"
  - "Spec fixtures build the 7-type list from REQUIRED_ONBOARDING_DOC_TYPES (imported) so test data cannot drift from the const"

patterns-established:
  - "One-pass D-10 derivation with precedence REJECTED > missing-type > all-verified > pending"
  - "Controller route ordering rule: static subpaths (me/status) before parameter segments (:requestId)"

requirements-completed: [ONB-03]

coverage:
  - id: D1
    description: "GET client-registrations/me/status returns { overall, documents, submissionStatus } aggregated over the owner's most-recent non-CANCELLED registration request, scoped by lower(owner_email) = lower(profile.email) with no requestId parameter (IDOR-safe); no requests -> { overall: 'INCOMPLETE', documents: [], submissionStatus: 'NONE' }; CANCELLED requests skipped; DRAFT requests included"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#returns INCOMPLETE/NONE shape when the owner has no registration requests"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#skips CANCELLED requests and aggregates the most-recent non-cancelled one"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#includes DRAFT requests so missing docs surface as INCOMPLETE"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-10 overall derivation: any REJECTED doc -> ACTION_REQUIRED (dominant red state, ONB-03); required type missing entirely -> INCOMPLETE; all 7 required types VERIFIED -> APPROVED; all present with mixed statuses -> PENDING_REVIEW; rejection_reason passthrough on documents entries"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#maps any REJECTED document to ACTION_REQUIRED and passes rejection_reason through"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#reports INCOMPLETE when a required document type is missing"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#reports APPROVED when all 7 required types are VERIFIED"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#reports PENDING_REVIEW when all types are present but some are not VERIFIED"
        status: pass
    human_judgment: false
  - id: D3
    description: "Guard rails: profile email missing -> 400 BadRequestException without any DB query; route registered at GET client-registrations/me/status BEFORE any :requestId param route (no Express shadowing of 'me' as :requestId)"
    verification:
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#rejects with 400 when the profile email is missing and never queries"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-08-11
status: complete
---

# Phase 10 Plan 03: ONB-03 — Aggregated onboarding status endpoint (GET /me/status) Summary

**Owner-scoped `GET client-registrations/me/status` aggregation endpoint deriving the D-10 overall onboarding status (REJECTED → ACTION_REQUIRED dominance) from the 7 shared required doc types, with rejection-reason passthrough for the ONB-04 dashboard**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-11T16:20:00Z (approx.)
- **Completed:** 2026-08-11T16:43:18Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `getMyRegistrationStatus(actorUserId)` in `tenant-governance.service.ts`: resolves the actor profile, throws 400 when the profile email is missing, queries registration requests scoped `lower(owner_email) = lower(${ownerEmail})` (DRAFT included, ORDER BY created_at DESC LIMIT 100), picks the most-recent non-CANCELLED row, queries its `pawnshop_documents` (document_type/status/rejection_reason), and derives `overall` in one pass per D-10 precedence: any REJECTED → `ACTION_REQUIRED`; missing required type (against `REQUIRED_ONBOARDING_DOC_TYPES`) → `INCOMPLETE`; all 7 VERIFIED → `APPROVED`; else `PENDING_REVIEW`.
- No-request shape `{ overall: 'INCOMPLETE', documents: [], submissionStatus: 'NONE' }`; `documents[]` carries `{ document_type, status, rejection_reason }` with `rejection_reason ?? null` passthrough.
- Controller route `GET client-registrations/me/status` declared immediately after `/me` and before every `:requestId` route — Express cannot match `me` as `:requestId` (T-10-07 mitigated). No `@Public()`, no `@RequiresPermission` (owner-facing, mirrors `listMyClientRegistrationRequests`).
- 8 mocked-Prisma ONB-03 spec cases, green along with the full existing tenant-governance suite (23/23).

## Task Commits

Each task was committed atomically:

1. **Task 1: getMyRegistrationStatus service method (D-09/D-10)** - `f63ca85` (feat)
2. **Task 2: GET client-registrations/me/status route + ONB-03 spec block** - `52fb875` (feat)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `backend/src/tenant-governance/tenant-governance.service.ts` - NEW `getMyRegistrationStatus(actorUserId)`: email-scoped request lookup, CANCELLED skip, DRAFT included, one-pass D-10 derivation using `REQUIRED_ONBOARDING_DOC_TYPES`, documents with `rejection_reason`, no-request NONE shape (69 lines added after `listMyClientRegistrationRequests`)
- `backend/src/tenant-governance/tenant-governance.controller.ts` - NEW `@Get('client-registrations/me/status')` route placed after `/me` (:167), before `:requestId` param routes; owner-facing, no role decorator (11 lines added)
- `backend/src/tenant-governance/tenant-governance.service.spec.ts` - NEW `getMyRegistrationStatus (ONB-03)` describe block with 8 cases; import extended with `REQUIRED_ONBOARDING_DOC_TYPES`

## Decisions Made

- **CANCELLED skip in JS, not SQL:** picked via `find` over the ordered raw rows comparing uppercased status — matches the plan's spec case (`rows[0]` CANCELLED → falls through to CONTACTED) and App.tsx most-recent ordering; keeps the SQL minimal.
- **DRAFT included in the pick:** deliberately NOT filtered out (unlike `listMyClientRegistrationRequests`' `status <> 'DRAFT'`) — a draft with missing docs must surface as `INCOMPLETE` per the plan.
- **Trimmed `ownerEmail` bind:** the WHERE clause uses `lower(${ownerEmail})` with the trimmed variable (module convention) rather than the raw `actor.email`; SQL text identical to the plan's query.
- **Route handler uses `await`:** file convention (`await this.authUserService.getUserIdFromAuthHeader(authHeader)`) rather than the plan snippet's un-awaited call — `getUserIdFromAuthHeader` is async.
- **Spec fixtures derived from the const:** the 7-type docs arrays are built from the imported `REQUIRED_ONBOARDING_DOC_TYPES` so test data and the gate cannot drift.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written. No Rule 1/2/3/4 deviations occurred.

### Process notes (not code deviations)

- The working tree carried pre-existing uncommitted WIP in `tenant-governance.controller.ts`: a `POST client-registrations/:requestId/submit` route wiring the already-committed `submitMyClientRegistrationRequest` service method. To keep the Task 2 commit scoped to this plan, only the `/me/status` hunk was staged (`git add -p`); the WIP route remains uncommitted and untouched, and is logged in `deferred-items.md`.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None - all acceptance criteria met.

## Issues Encountered

- **Pre-existing full-suite failures (out of scope, unchanged):** `npm test` in backend reports 6 failing suites (attendance, notification, queue, auction-settlement, loan-contract, loan-history) — the same pre-existing DI/mock-shape failures already logged by 10-01/10-02 in `deferred-items.md`. None import tenant-governance files; the failing suites' files were not touched by this plan's commits. Scoped gates all pass (see Verification).
- **Controller partial staging:** the controller file mixes this plan's route with user WIP; resolved via `git add -p` (stage hunk 1/2 only), verified the staged diff contained exactly the `/me/status` route before committing.

## User Setup Required

None - no external service configuration required.

## Verification

- `cd backend && npx tsc --noEmit` → exit 0 (clean)
- `cd backend && npm test -- --testPathPattern="tenant-governance" --silent` → PASS, 23/23 tests (15 pre-existing + 8 new ONB-03)
- `cd backend && npm test -- --silent` (full suite) → tenant-governance PASS, permissions-catalog PASS; 6 pre-existing unrelated suites fail as documented in deferred-items.md

## Next Phase Readiness

- ONB-03 backend is complete and ready for 10-04: the `GET client-registrations/me/status` response shape (`{ overall, documents[], submissionStatus }` with `rejection_reason`) is exactly what the PendingAccessDashboard banner/chips consume.
- 10-04 must wire the frontend to this endpoint and refresh per D-12; the controller route is already ordered correctly for the new path.

---

*Phase: 10-onboarding-compliance-gate*
*Completed: 2026-08-11*

## Self-Check: PASSED

- Files exist: `10-03-SUMMARY.md`, `tenant-governance.service.ts`, `tenant-governance.controller.ts`, `tenant-governance.service.spec.ts` — all FOUND.
- Commits exist: `f63ca85` (feat, Task 1) and `52fb875` (feat, Task 2) — both verified via `git cat-file -t`.
- No accidental deletions in either commit (`git diff --diff-filter=D` empty).
