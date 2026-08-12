---
phase: 10-onboarding-compliance-gate
plan: 04
subsystem: frontend
tags: [react, vite, vitest, trial-requests, onboarding, view-before-approve, banner]

# Dependency graph
requires:
  - phase: 10-01
    provides: "ONB-01 server-side 7-doc gate on registration APPROVED + REQUIRED_ONBOARDING_DOC_TYPES const"
  - phase: 10-02
    provides: "POST client-registrations/:requestId/documents/:documentId/view (has_viewed/hasViewed persisted) + GET .../documents/admin rows with has_viewed"
  - phase: 10-03
    provides: "GET client-registrations/me/status -> { overall, documents[], submissionStatus } aggregation (D-09 contract)"
provides:
  - "frontend/src/lib/onboardingStatus.ts (NEW): OnboardingOverall type + canApproveDocument / overallTone / overallLabel / rejectedDocumentCount pure helpers"
  - "frontend/src/lib/__tests__/onboardingStatus.test.ts (NEW): 23-case vitest mirror"
  - "TrialRequestsPanel.tsx: view-before-approve modal (D-08) — RegDocument.has_viewed, viewedDocIds session set, openPreviewAndMarkViewed POSTs the view endpoint, Approve gated by canApproveDocument, Reject always-enabled"
  - "PendingAccessDashboard.tsx: overall status banner (D-11) with tone/label/supporting copy + D-12 refresh semantics (mount/actions/Refresh/30s interval, no Realtime)"
affects: [verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure decision/tone logic in frontend/src/lib/onboardingStatus.ts + vitest mirror beside the module (kycDocs.ts/kycDocs.test.ts precedent)"
    - "Server truth wins: canApproveDocument returns Boolean(serverViewed) || viewedDocIds.has(id) — the UI disable is defense-in-depth over the D-06 server guard"
    - "30s polling interval for owner status banner (NotificationCenter.tsx:73 precedent) — no Supabase Realtime"

key-files:
  created:
    - frontend/src/lib/onboardingStatus.ts
    - frontend/src/lib/__tests__/onboardingStatus.test.ts
  modified:
    - frontend/src/pages/admin/TrialRequestsPanel.tsx
    - frontend/src/components/PendingAccessDashboard.tsx

key-decisions:
  - "canApproveDocument short-circuits false for VERIFIED/REJECTED (finalized docs not re-approvable) BEFORE consulting server/session viewed state"
  - "openPreviewAndMarkViewed: setPreviewDoc(doc) runs FIRST so the viewer opens immediately (existing signed-URL effect keeps working), then the view POST fires; finalized docs skip the POST entirely"
  - "View failure keeps Approve locked with an error toast ('Could not record document view. Approve stays locked.') — no false unlock"
  - "overallTone defaults INCOMPLETE/unknown to amber classes (PENDING_REVIEW palette) — same for overallLabel 'Incomplete'"
  - "PendingAccessDashboard carries interleaved prior draft-flow additions (DRAFT create-on-upload, submit gating) already present in the working tree — committed together since the hunks are inseparable"

patterns-established:
  - "UI gating mirrors the server guard: Approve unlock = server has_viewed OR in-session view POST success; never just modal-open"
  - "Owner banner re-fetch on every state-changing action (upload/submit/cancel) plus mount + manual Refresh + 30s interval"

requirements-completed: [ONB-02, ONB-03, ONB-04]

coverage:
  - id: D1
    description: "TrialRequestsPanel modal enforces view-before-approve: opening a document fires POST client-registrations/:requestId/documents/:documentId/view; Approve stays disabled until the POST succeeds or the doc row already has has_viewed=true (server truth); finalized VERIFIED/REJECTED docs are not re-approvable; Reject remains enabled without viewing"
    requirement: "ONB-02"
    verification:
      - kind: unit
        ref: "frontend/src/lib/__tests__/onboardingStatus.test.ts#canApproveDocument"
        status: pass
      - kind: typecheck
        ref: "cd frontend && npx tsc --noEmit (phase-10 files delta-clean)"
        status: pass
    human_judgment: true
  - id: D2
    description: "PendingAccessDashboard renders the overall banner (ACTION_REQUIRED / APPROVED / PENDING_REVIEW / INCOMPLETE) fed by GET client-registrations/me/status, with tone classes, label, and per-state supporting line (ACTION_REQUIRED shows the rejected-document count via rejectedDocumentCount)"
    requirement: "ONB-03"
    verification:
      - kind: unit
        ref: "frontend/src/lib/__tests__/onboardingStatus.test.ts#overallTone/overallLabel/rejectedDocumentCount"
        status: pass
      - kind: typecheck
        ref: "cd frontend && npx tsc --noEmit (phase-10 files delta-clean)"
        status: pass
    human_judgment: true
  - id: D3
    description: "D-12 refresh semantics: status refreshes on mount, after upload/submit/cancel actions, on manual Refresh, and on a 30s interval (NotificationCenter precedent; no Supabase Realtime)"
    requirement: "ONB-04"
    verification:
      - kind: typecheck
        ref: "cd frontend && npx tsc --noEmit (phase-10 files delta-clean)"
        status: pass
    human_judgment: true

# Metrics
duration: 28min
completed: 2026-08-11
status: complete
---

# Phase 10 Plan 04: ONB-02/03/04 — Review modal view-before-approve + owner dashboard status banner (frontend) Summary

**SUPER_ADMIN review modal enforces view-before-approve against the new view endpoint (server has_viewed OR in-session view), and the owner PendingAccessDashboard shows the aggregated ACTION_REQUIRED/APPROVED/PENDING_REVIEW/INCOMPLETE status live with mount/action/Refresh/30s refresh semantics — closing the loop for ONB-02, ONB-03, and ONB-04.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-08-11T16:50:00Z (approx.)
- **Completed:** 2026-08-11T17:11:00Z (approx.)
- **Tasks:** 3
- **Files created:** 2
- **Files modified:** 2

## Accomplishments

- **Task 1 — Pure helpers + vitest mirror:** new `frontend/src/lib/onboardingStatus.ts` exports `OnboardingOverall`, `canApproveDocument`, `overallTone`, `overallLabel`, `rejectedDocumentCount`; 23-case vitest mirror `onboardingStatus.test.ts` green.
- **Task 2 — TrialRequestsPanel view-before-approve (D-08):** `RegDocument` gains `has_viewed`; new `openPreviewAndMarkViewed` opens the viewer first, then POSTs the view endpoint (skipped for finalized docs); session `viewedDocIds` set; modal Approve gated by `canApproveDocument` (server truth wins); locked-state helper copy shown; Reject unchanged (always enabled).
- **Task 3 — PendingAccessDashboard banner + refresh (D-11/D-12):** `statusSummary`/`rejectedCount` state; `loadStatusSummary` reads `GET client-registrations/me/status`; overall banner with `overallTone`/`overallLabel` and per-state supporting line (rejection count on ACTION_REQUIRED); refresh wired to mount, upload, submit, cancel, manual Refresh, and a 30s interval.

## Task Commits

Each task was committed atomically:

1. **Task 1: pure helpers + vitest mirror** - `bd6ecfd` (feat)
2. **Task 2: view-before-approve modal (D-08)** - `ab4d379` (feat)
3. **Task 3: owner banner + refresh semantics (D-11/D-12)** - `68735f9` (feat)

## Files Created/Modified

- `frontend/src/lib/onboardingStatus.ts` - NEW (33 lines): `OnboardingOverall` type; `canApproveDocument` (finalized → false; server truth OR session set); `overallTone`/`overallLabel` (4 states + INCOMPLETE default); `rejectedDocumentCount` (case-insensitive REJECTED count)
- `frontend/src/lib/__tests__/onboardingStatus.test.ts` - NEW (125 lines): 23 vitest cases — finalized-doc lock, server-truth unlock, session-set unlock, tone/label maps, rejection count
- `frontend/src/pages/admin/TrialRequestsPanel.tsx` - MOD: `has_viewed` on RegDocument; `viewedDocIds` state; `openPreviewAndMarkViewed` (viewer first, then POST); modal Approve `disabled` via `canApproveDocument`; locked-state helper copy
- `frontend/src/components/PendingAccessDashboard.tsx` - MOD: `statusSummary`/`rejectedCount` state; `loadStatusSummary`; overall banner (emerald/rose/amber theme tokens); refresh wiring + 30s interval

## Decisions Made

- **Server truth wins over session state:** `canApproveDocument` returns `Boolean(serverViewed) || viewedDocIds.has(documentId)` — reopening a previously-viewed doc unlocks Approve without a new POST, exactly per D-08.
- **Finalized docs short-circuit:** VERIFIED/REJECTED return false before any viewed-state check — re-approving a finalized doc is impossible from the UI (mirrors the D-06 server status-lock).
- **Viewer opens before the POST:** `setPreviewDoc(doc)` runs first so the existing signed-URL effect keeps working and the view is recorded as a side effect of the modal-open handler (T-10-08 accepted UX contract).
- **Failed view POST keeps Approve locked** with an error toast — no optimistic unlock that could violate the server guard's intent.
- **Banner tone defaults to amber for INCOMPLETE/unknown** (same classes as PENDING_REVIEW), reusing the KycStatusBadge/owner-dashboard palette — no new design-system work.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written. No Rule 1/2/3/4 deviations occurred.

### Process notes (not code deviations)

- **Task 3 commit carries interleaved prior WIP:** the working-tree version of `PendingAccessDashboard.tsx` already contained uncommitted draft-flow additions (DRAFT create-on-upload in `handleUploadDocument`, `hasDraft`/`allRequiredDocsUploaded` submit gating, DRAFT cancellability) from prior owner-registration work. The Task 3 hunks are interleaved with these edits in the same regions, so they cannot be separated with `git add -p`; the file was committed whole with the prior WIP noted in the commit body.

## Issues Encountered

- **Pre-existing frontend `tsc --noEmit` errors (out of scope, unchanged):** 48 lines of errors at HEAD predating phase 10 — missing shadcn/ui peer deps (`react-hook-form`, `input-otp`, `react-resizable-panels`, `sonner`, `next-themes`, `react-day-picker`, `embla-carousel-react`, `cmdk`, `vaul`) and unused/type issues in legacy files (`App.tsx:1625`, `AuctionMarketplace.tsx`, `chart.tsx`, `PlatformAnalytics.tsx`, `OwnerComplianceDashboard.tsx`). None of the 4 phase-10 files appear in the error list — phase-10 work is delta-clean. Logged in `deferred-items.md` for the defense-demo cleanup.
- **Build passes** with only the pre-existing chunk-size (>500 kB) and dynamic-import warnings.

## User Setup Required

None - no external service configuration required.

## Verification

- `cd frontend && npx vitest run src/lib/__tests__/onboardingStatus.test.ts` → PASS, 23/23 tests
- `cd frontend && npx tsc --noEmit` → phase-10 files delta-clean (0 errors from onboardingStatus/TrialRequestsPanel/PendingAccessDashboard; pre-existing HEAD errors unchanged)
- `cd frontend && npm run build` → PASS (chunk-size + dynamic-import warnings only)

## Next Phase Readiness

- Phase 10 (Onboarding Compliance Gate) is now feature-complete end-to-end: server docs gate (10-01), view-before-approve server + UI (10-02, 10-04), aggregated status endpoint (10-03), and the owner dashboard banner (10-04).
- Manual UAT checklist remains in `10-VALIDATION.md` Wave 4 (admin view→approve unlock; reopen unlock via has_viewed; reject-without-view; owner banner states; 30s banner update).

---

*Phase: 10-onboarding-compliance-gate*
*Completed: 2026-08-11*

## Self-Check: PASSED

- Files exist: `10-04-SUMMARY.md`, `frontend/src/lib/onboardingStatus.ts`, `frontend/src/lib/__tests__/onboardingStatus.test.ts` — all FOUND.
- Commits exist: `bd6ecfd` (Task 1), `ab4d379` (Task 2), `68735f9` (Task 3) — all verified via `git cat-file -t`.
- No accidental deletions in the plan's commits (`git diff --diff-filter=D` empty for the touched files).
