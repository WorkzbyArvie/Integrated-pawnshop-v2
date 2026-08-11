---
phase: 10-onboarding-compliance-gate
plan: 02
subsystem: api
tags: [nestjs, prisma, raw-sql, tenant-governance, onboarding, rbac, permissions-catalog, hasViewed]

# Dependency graph
requires:
  - phase: 07
    provides: "PawnshopDocument.hasViewed/viewedAt/viewedBy schema columns + onboarding.review_documents/onboarding.approve permission constants"
  - phase: 10-01
    provides: "ONB-01 docs-before-trial gate in reviewClientRegistrationRequest (approval chokepoint) + REQUIRED_ONBOARDING_DOC_TYPES const"
provides:
  - "POST client-registrations/:requestId/documents/:documentId/view (D-05): idempotent hasViewed persistence via raw SQL, SUPER_ADMIN-only"
  - "reviewRegistrationDocument view-before-approve guard (D-06): APPROVED 400s unless has_viewed=true; REJECTED stays view-free; VERIFIED/REJECTED status lock untouched"
  - "adminListRegistrationDocuments now returns has_viewed so 10-04 TrialRequestsPanel can restore viewed state across sessions"
  - "D-07 @RequiresPermission wiring (onboarding.review_documents / onboarding.approve) on the 4 onboarding admin endpoints + SUPER_ADMIN_PERMISSIONS allow-list extended in lockstep"
  - "permissions-catalog spec green at 71 sites with 4 tenant-governance MATRIX rows consistent"
  - "8 mocked-Prisma ONB-02 spec cases (view persists/idempotent/403/404; approve blocked/passed; reject allowed; status lock)"
affects: [10-03, 10-04, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decorator strings and SUPER_ADMIN_PERMISSIONS must be updated in the SAME commit (RbacGuard has no blanket SUPER_ADMIN bypass — rbac.guard.ts:119-128)"
    - "Raw-SQL UPDATE with NOW()/actor-uuid binds for audit-trail fields (has_viewed/viewed_at/viewed_by), mirroring module convention"
    - "Server-side control in the service (D-06 guard) even though the decorator exists — UI disable is never the control"

key-files:
  created: []
  modified:
    - backend/src/tenant-governance/tenant-governance.service.ts
    - backend/src/tenant-governance/tenant-governance.controller.ts
    - backend/src/common/guards/rbac.guard.ts
    - backend/src/common/permissions/permissions-catalog.spec.ts
    - backend/src/tenant-governance/tenant-governance.service.spec.ts

key-decisions:
  - "markRegistrationDocumentViewed performs an idempotent UPDATE (no has_viewed pre-condition) — re-viewing an already-viewed doc succeeds"
  - "D-06 guard sits AFTER the existing VERIFIED/REJECTED status lock so finalized docs still 400 first (Pitfall 3 preserved; re-upload is the recovery path)"
  - "SUPER_ADMIN_PERMISSIONS extended with onboarding.review_documents + onboarding.approve in the same commit as the decorators (Pitfall 1) — without it the only reviewer 403s"
  - "reviewClientRegistration (request-level approve that activates the trial) maps to onboarding.approve per the plan; the ONB-01 gate stays service-side"
  - "View route is a decorator-free-body POST (no @Body) — the global ValidationPipe only validates declared body params"

patterns-established:
  - "Lockstep permission wiring: @RequiresPermission metadata + SUPER_ADMIN_PERMISSIONS allow-list + permissions-catalog MATRIX/count all updated atomically"
  - "Defense in depth: controller decorator (RbacGuard) + service normalizeRole assert (belt and suspenders) on onboarding admin endpoints"

requirements-completed: [ONB-02]

coverage:
  - id: D1
    description: "POST client-registrations/:requestId/documents/:documentId/view persists has_viewed=true, viewed_at=NOW(), viewed_by=actor on the matching registration document and returns { success: true, hasViewed: true }; idempotent on re-view; non-SUPER_ADMIN rejected; unknown document 404"
    requirement: "ONB-02"
    verification:
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#persists viewed state for a SUPER_ADMIN and returns success"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#is idempotent - re-viewing an already-viewed document still runs the UPDATE"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#rejects non-SUPER_ADMIN with BadRequestException and never queries"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#throws NotFoundException for an unknown document"
        status: pass
    human_judgment: false
  - id: D2
    description: "reviewRegistrationDocument rejects APPROVED with 400 'Document must be viewed before it can be approved.' when has_viewed=false; REJECTED remains allowed without viewing; the existing VERIFIED/REJECTED status lock is unchanged"
    requirement: "ONB-02"
    verification:
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#blocks APPROVED when the document has not been viewed"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#allows APPROVED after the document has been viewed"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#allows REJECTED without viewing"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#preserves the finalized-status lock even when the document was viewed"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-07 permission metadata: @RequiresPermission('onboarding.review_documents') on adminListRegistrationDocuments + the new view endpoint; @RequiresPermission('onboarding.approve') on reviewRegistrationDocument + reviewClientRegistration; SUPER_ADMIN_PERMISSIONS contains both onboarding permissions (no 403 for the reviewer); permissions-catalog spec green at 71 sites with matching MATRIX rows"
    requirement: "ONB-02"
    verification:
      - kind: unit
        ref: "backend/src/common/permissions/permissions-catalog.spec.ts#finds all 71 migrated endpoints across the 8 controllers"
        status: pass
      - kind: unit
        ref: "backend/src/common/permissions/permissions-catalog.spec.ts#every @RequiresPermission site matches the migration matrix and preserves holder coverage"
        status: pass
      - kind: unit
        ref: "backend/src/tenant-governance/tenant-governance.service.spec.ts#allows APPROVED after the document has been viewed"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-08-11
status: complete
---

# Phase 10 Plan 2: ONB-02 View-Before-Approve Backend + D-07 Permission Wiring Summary

**View-before-approve backend for onboarding document review: idempotent SUPER_ADMIN view endpoint (POST .../documents/:documentId/view) persisting hasViewed/viewedAt/viewedBy via raw SQL, an APPROVED-without-view 400 guard in reviewRegistrationDocument (REJECTED stays view-free, status lock preserved), and D-07 @RequiresPermission wiring on all four onboarding admin endpoints with the RbacGuard SUPER_ADMIN allow-list extended in lockstep — permissions-catalog spec green at 71 sites, 8 new mocked-Prisma cases**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-08-11T16:02:11Z
- **Completed:** 2026-08-11T16:16:11Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- **D-05 view endpoint:** New `markRegistrationDocumentViewed(actorUserId, requestId, documentId)` in tenant-governance.service.ts — SUPER_ADMIN assert via `normalizeRole` (mirroring the admin list/review methods), ownership/lookup `SELECT id ... LIMIT 1` (404 when empty), then an idempotent raw-SQL `UPDATE` setting `has_viewed = TRUE, viewed_at = NOW(), viewed_by = actor, updated_at = NOW()`; returns `{ success: true, hasViewed: true }`. Controller route `POST client-registrations/:requestId/documents/:documentId/view` placed directly after the doc-review route with the same `Headers('authorization')` + `getUserIdFromAuthHeader` + `@Param` shape and no `@Body`.
- **D-06 view-before-approve guard:** `reviewRegistrationDocument`'s doc SELECT now reads `id, status, has_viewed`; immediately after the existing VERIFIED/REJECTED status lock and before the UPDATE, `if (dto.decision === 'APPROVED' && !has_viewed)` throws `BadRequestException('Document must be viewed before it can be approved.')`. REJECTED decisions skip the branch; the finalized-status lock is byte-identical (Pitfall 3 preserved — re-upload is the recovery path).
- **adminListRegistrationDocuments SELECT gains `has_viewed`** so the 10-04 TrialRequestsPanel can restore viewed state across sessions (snake_case as returned by raw SQL).
- **D-07 permission wiring (the critical RbacGuard pitfall):** `@RequiresPermission(PERMISSIONS['onboarding.review_documents'])` on `adminListRegistrationDocuments` + the new view endpoint; `@RequiresPermission(PERMISSIONS['onboarding.approve'])` on `reviewRegistrationDocument` + `reviewClientRegistration`; `SUPER_ADMIN_PERMISSIONS` (rbac.guard.ts) extended with both onboarding permissions **in the same commit** — without this every SUPER_ADMIN call to the four endpoints 403s (`rbac.guard.ts:119-128` has no blanket SUPER_ADMIN bypass).
- **Catalog spec coordinated (Pitfall 2):** site count 69 → 71 with the it-title updated; MATRIX updated for `reviewClientRegistration` / `reviewRegistrationDocument` (platform.manage → onboarding.approve) and two new rows (`adminListRegistrationDocuments`, `markRegistrationDocumentViewed` → onboarding.review_documents). `ROLE_PERMISSIONS` (103), 37-const, KNOWN_TUPLES, and migration-SQL assertions untouched.
- **Specs:** new `markRegistrationDocumentViewed / reviewRegistrationDocument hasViewed (ONB-02)` describe block with 8 mocked-Prisma cases using the direct-construction harness.

## Task Commits

Each task was committed atomically:

1. **Task 1: markRegistrationDocumentViewed service method + hasViewed guard + has_viewed in SELECTs** - `74be5fd` (feat)
2. **Task 2: View route + D-07 @RequiresPermission wiring + SUPER_ADMIN_PERMISSIONS + catalog spec sync** - `9e2382b` (feat)
3. **Task 3: Mocked-Prisma specs for the view endpoint and the hasViewed guard** - `5f14a47` (test)

**Plan metadata:** docs commit to follow (includes this SUMMARY + STATE/ROADMAP updates)

## Files Created/Modified

- `backend/src/tenant-governance/tenant-governance.service.ts` - new `markRegistrationDocumentViewed` method (SUPER_ADMIN assert + idempotent UPDATE returning `{ success: true, hasViewed: true }`); `reviewRegistrationDocument` SELECT + D-06 APPROVED guard; `adminListRegistrationDocuments` SELECT gains `has_viewed`
- `backend/src/tenant-governance/tenant-governance.controller.ts` - new view route; `@RequiresPermission` on 4 sites (2 review endpoints switched platform.manage → onboarding.approve; admin list + view endpoint gain onboarding.review_documents)
- `backend/src/common/guards/rbac.guard.ts` - `SUPER_ADMIN_PERMISSIONS` + `'onboarding.review_documents'` + `'onboarding.approve'`
- `backend/src/common/permissions/permissions-catalog.spec.ts` - site count 69 → 71 (+it title); MATRIX: 2 permission edits + 2 new rows
- `backend/src/tenant-governance/tenant-governance.service.spec.ts` - 8 ONB-02 cases (view persists/idempotent/403/404; approve blocked/passed; reject allowed; status lock preserved)

## Decisions Made

- **Idempotent view (D-05):** the lookup has no `has_viewed` pre-condition — re-viewing an already-viewed document always succeeds and refreshes `viewed_at`/`viewed_by`.
- **Guard ordering (D-06):** the hasViewed check sits AFTER the existing VERIFIED/REJECTED status lock, so a finalized document still 400s with the original message before the view check could fire (Pitfall 3 untouched — no behavior change to the lock).
- **Lockstep guard extension (D-07):** decorators and `SUPER_ADMIN_PERMISSIONS` landed in one commit per the research pitfall; the catalog MATRIX/count were updated in that same commit (Pitfall 2).
- **Approve-permission mapping:** the request-level `reviewClientRegistration` (which activates the trial) maps to `onboarding.approve` per the plan; the ONB-01 docs gate remains a service-side check.
- **No new DTO/file:** the view endpoint has no body, so no DTO file was created (module's ValidationPipe only validates declared body params).

## Deviations from Plan

### Auto-fixed Issues

**1. [Process deviation - accidental inclusion of unrelated uncommitted work in Task 2 commit, then history recovery]**
- **Found during:** post-Task-2 verification (`git show a1aa454`)
- **Issue:** The controller file carried an uncommitted `submitMyClientRegistration` route from another workstream (part of the ~100 pre-existing uncommitted files). My `git add` of the full controller file swept that route into the Task 2 commit (`a1aa454`), which the plan explicitly said to leave untouched. An initial `--amend` attempt misfired on HEAD (the Task 3 spec commit) instead of the Task 2 commit.
- **Fix:** `git reset --soft 74be5fd` (content-preserving; no `--hard`) to rewind the two contaminated commits, then recommitted Task 2 (`9e2382b`, controller without the submit route + rbac.guard + catalog spec) and Task 3 (`5f14a47`, spec) atomically, and restored the submit route to the working tree as uncommitted content — `git diff` now shows exactly the 9-line submit route as the sole uncommitted controller change (byte-identical to its pre-plan state).
- **Files modified:** `backend/src/tenant-governance/tenant-governance.controller.ts` (working tree only)
- **Verification:** re-ran `npx tsc --noEmit` (exit 0) and `npm test -- --testPathPattern="tenant-governance|permissions-catalog" --silent` (23/23 pass) on the recovered history.
- **Committed in:** `9e2382b`, `5f14a47` (replacement commits)

---

**Total deviations:** 1 (process/scope — no source-content change vs. plan)
**Impact on plan:** None on deliverables. All plan-scoped changes are byte-identical to the originally committed content; history is now atomic per task and the other workstream's uncommitted route is untouched.

## Issues Encountered

- **Full backend suite (6 suites / 36 tests failing):** the same pre-existing failures 10-01 logged (attendance, notification, queue, auction-settlement, loan-contract, loan-history — DI/mock-prisma harness drift on modules with uncommitted working-tree edits). Re-confirmed identical at HEAD after the 10-02 commits; root cause sample `TypeError: this.prisma.ensureConnected is not a function` in notification.service.spec.ts. None import any file changed by this plan. Logged again in `deferred-items.md` for the wave-merge/full-suite gate.
- **Catalog spec initially red?** No — the 69→71 + MATRIX edits were applied together and passed on first run (8/8). The only mid-plan wrinkle was the submit-route contamination described above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ONB-02 backend complete: view persistence (D-05), server-enforced view-before-approve (D-06), permission metadata + SUPER_ADMIN allow-list in lockstep (D-07), catalog spec green at 71 sites.
- `adminListRegistrationDocuments` now returns `has_viewed` — 10-04 `TrialRequestsPanel` can restore viewed state across sessions (D-08 sequencing: open viewer → POST view → enable Approve).
- 10-03 (`GET client-registrations/me/status` aggregation) can proceed; it shares only `tenant-governance.service.ts` (additive).
- Critical runtime check for 10-04 UAT: a SUPER_ADMIN token calling the doc-review / request-review / view endpoints must NOT return 403 — guard allow-list verified by catalog spec; manual curl in 10-04 UAT.
- Blockers for the wave merge: the 6 pre-existing full-suite failures in `deferred-items.md` must be resolved by their owning workstreams before the full-suite gate.

## Self-Check: PASSED

- Files exist: `tenant-governance.service.ts`, `tenant-governance.controller.ts`, `rbac.guard.ts`, `permissions-catalog.spec.ts`, `tenant-governance.service.spec.ts`, `10-02-SUMMARY.md`, `deferred-items.md`
- Commits exist: `74be5fd` (feat), `9e2382b` (feat), `5f14a47` (test)

---
*Phase: 10-onboarding-compliance-gate*
*Completed: 2026-08-11*
