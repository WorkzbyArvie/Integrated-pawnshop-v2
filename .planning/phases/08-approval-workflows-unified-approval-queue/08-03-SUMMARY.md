---
phase: 08-approval-workflows-unified-approval-queue
plan: 03
subsystem: frontend
tags: [react, radix-ui, approval-workflow, rbac, gilded-reserve, settings]
requires:
  - phase: 08-approval-workflows-unified-approval-queue
    provides: 08-02 approval-queue API (GET /approval-queue + approve/reject) and tenant.manage settings endpoint
provides:
  - ApprovalQueue component: Appraisal | Redemption | Decision History tabs, per-row approve/reject with required rejection comment, Review dialog with valuation/redemption detail + previous-rejection callout, ContractViewer handoff on appraisal approval, Decision History table (overflow-x-auto), live pending badges, search toolbar, refresh, loading/error/empty states, RBAC role gate + self-approval prevention
  - App.tsx consolidation (D-10): approval-queue import/TAB_TO_PATH/nav/FREE_ALLOWED_NAV/render wired; AppraisalApproval fully retired; PendingApprovalPanel ticket-creation flow untouched
  - ApprovalQueue.test.tsx green 5/5 (tabs render, per-tab fetch with pawnshopId, approve POST, reject-comment gate, empty state)
  - SystemSettings redemptionApprovalThreshold field (PHP numeric, default 50000) with merge-on-write branch-admin save so a threshold-only save cannot wipe finance/payroll/ledger keys (T-08-07 mitigated)
affects: [08-verify-wave, gsd-verify-work visual pass]
tech-stack:
  added: []
  patterns:
    - Radix Tabs v2 activates on onMouseDown (not click) — tests must dispatch fireEvent.mouseDown for tab switches
    - Vitest scaffold safety: vi.hoisted for the module-mocked api client (TDZ-safe), guarded localStorage polyfill in setup.ts under Node 22
    - Merge-on-write settings save: spread currentSettings BEFORE sanitizedConfig (Pitfall 7 / T-08-07)
    - Direct-POST approve/reject (no Swal confirm gate) to satisfy the RED test contract; ContractViewer mounts only when the approve response carries applicationId/contractId
key-files:
  created:
    - frontend/src/components/ApprovalQueue.tsx
  modified:
    - frontend/src/App.tsx
    - frontend/src/components/__tests__/ApprovalQueue.test.tsx
    - frontend/src/test/setup.ts
    - frontend/src/pages/admin/SystemSettings.tsx
key-decisions:
  - "The 08-01 RED test scaffold is the executable contract: approve must POST on click (no Swal gate) and the reject comment is an inline Textarea ('Rejection comment (required)') with the Reject button disabled until non-empty — the plan's Swal-dialog prose is superseded by the test contract"
  - "Radix Tabs v2 triggers activate on onMouseDown; fireEvent.click alone never fires onValueChange, so the tab-switch test uses fireEvent.mouseDown (assertion unchanged)"
  - "Frontend sends `type` as the query param per the RED scaffold; the backend DTO declares `targetType` — the server ignores `type` and the component filters client-side by record.targetType, so tabs stay correct; flagged for param alignment in a future cleanup"
  - "Threshold is local SystemSettings state (not feature-toggle config); super-admin global_overrides save path unchanged; threshold is branch-level and written only by branch-admin saves"
  - "Self-approval prevention: Approve disabled + 'You cannot approve your own request.' copy when supabase session user id equals record.requestedBy.id; backend guard remains authoritative (T-08-10 accept)"
requirements-completed: [RBAC-04, RBAC-05]
coverage:
  - id: M1
    description: "Unified Approval Queue page under the approval-queue tab (path /approval-queue) for Owner/Admin/Manager with Appraisal | Redemption | Decision History tabs, live pending-count badges, search toolbar, and per-row Review/Approve/Reject actions; old Appraisal Approval nav/route/render removed from App.tsx while the ticket-creation PendingApprovalPanel flow stays intact (D-10)"
    requirement: RBAC-05
    verification:
      - kind: unit
        ref: "frontend/src/components/__tests__/ApprovalQueue.test.tsx#renders the Approval Queue title with Appraisal, Redemption, and Decision History tabs"
        status: pass
      - kind: static
        ref: "frontend/src/App.tsx — approval-queue import/route/nav/FREE_ALLOWED_NAV/render; appraisal-approval and AppraisalApproval absent (grep clean); PendingApprovalPanel usage untouched"
        status: pass
    human_judgment: false
  - id: M2
    description: "Approve/Reject decisions posted to the backend decide endpoints (POST /approval-queue/:id/approve and /reject) with the reject gate enforcing a non-empty comment"
    requirement: RBAC-05
    verification:
      - kind: unit
        ref: "frontend/src/components/__tests__/ApprovalQueue.test.tsx#approves a record via POST /approval-queue/:id/approve and refreshes the queue (2 GETs total)"
        status: pass
      - kind: unit
        ref: "frontend/src/components/__tests__/ApprovalQueue.test.tsx#keeps reject disabled until a rejection comment is provided"
        status: pass
    human_judgment: false
  - id: M3
    description: "Distinct empty states per scope — 'All caught up!' (page), 'No pending appraisals'/'No pending redemptions' (tabs), 'No decisions yet' (audit) — per-tab states render independently, tabs never hide"
    requirement: RBAC-05
    verification:
      - kind: unit
        ref: "frontend/src/components/__tests__/ApprovalQueue.test.tsx#renders the empty state when the queue has no pending approvals (All caught up!)"
        status: pass
      - kind: static
        ref: "frontend/src/components/ApprovalQueue.tsx empty-state branch (DECIDED vs pending tabs)"
        status: pass
    human_judgment: false
  - id: M4
    description: "3 Skeleton rows while loading; inline error card with Retry plus a toast on fetch failure"
    requirement: RBAC-05
    verification:
      - kind: static
        ref: "frontend/src/components/ApprovalQueue.tsx isLoading/error branches (3 Skeletons; AlertTriangle card + Retry + showToast in loadQueue catch)"
        status: pass
    human_judgment: false
  - id: M5
    description: "Tab and header badge counts reflect pending counts live (zero-one-many); icon-only buttons carry aria-labels (Refresh queue); status conveyed by text AND color (humanizeStatus + statusColor)"
    requirement: RBAC-05
    verification:
      - kind: static
        ref: "frontend/src/components/ApprovalQueue.tsx pending-count pill, per-tab Badge counts, Refresh aria-label, statusColor spans"
        status: pass
    human_judgment: false
  - id: M6
    description: "Redemption tab shows the threshold note (per-item threshold with 50000 fallback); OWNER can configure redemptionApprovalThreshold in System Settings via the existing PATCH endpoint with merge-on-write so finance/payroll/ledger keys are preserved; non-positive values rejected before PATCH"
    requirement: RBAC-04
    verification:
      - kind: static
        ref: "frontend/src/pages/admin/SystemSettings.tsx — redemptionApprovalThreshold input, spread-currentSettings-first merge, Number.isFinite(threshold) && threshold > 0 guard with Swal abort"
        status: pass
      - kind: static
        ref: "frontend/src/components/ApprovalQueue.tsx redemption threshold note (record.threshold ?? 50000 via formatCurrency)"
        status: pass
    human_judgment: false
duration: 150min
completed: 2026-08-06
status: complete
---

# Phase 8 Plan 3: Unified Approval Queue Frontend Summary

**Gilded-Reserve ApprovalQueue page (Appraisal | Redemption | Decision History) with direct approve/reject + required rejection comment, ContractViewer handoff, Decision History table, App.tsx consolidation (AppraisalApproval retired, PendingApprovalPanel preserved), the 08-01 RED test scaffold implemented green 5/5, and an OWNER-configurable redemption threshold in System Settings with merge-on-write protection**

## Performance

- **Duration:** ~2.5h across two sessions (component authored prior session; test iteration, App wiring, SystemSettings this session)
- **Started:** prior session (T1 component authoring)
- **Completed:** 2026-08-06
- **Tasks:** 3 (T1 ApprovalQueue component, T2 App wiring + test to green, T3 SystemSettings threshold)
- **Files modified:** 5 (1 created, 4 modified — includes test-infra `setup.ts`)

## Accomplishments

- **ApprovalQueue.tsx (created):** unified queue page per 08-UI-SPEC — header with display title + pending-count pill + Refresh (aria-label, Loader2 spin), Radix Tabs (Appraisal | Redemption | Decision History, gold active state, live count badges), search toolbar (customer name / ticket number), redemption threshold note on the Redemption tab, card-style rows with type badge + ticket + customer + item summary + gold amount + requestedBy/date, per-row [Review] [Approve] [Reject], Review dialog (valuation block, risk flag, appraisal notes, amber previous-rejection callout, redemption amountPaid/threshold), Decision History table (overflow-x-auto per backstop), 3-Skeleton loading, inline error card + Retry + toast, per-scope empty states, role gate (`MANAGER/OWNER/ADMIN/SUPER_ADMIN` with `BRANCH_ADMIN→ADMIN` normalization), self-approval prevention via session user id, ContractViewer handoff when the approve response carries `applicationId`/`contractId`
- **Test contract green 5/5:** the 08-01 RED scaffold's assertions implemented without loosening — three tab labels render, appraisal tab fetches `GET /approval-queue` with `{ pawnshopId, type: 'APPRAISAL' }` and the redemption tab refetches with `type: 'REDEMPTION'`, approve POSTs `/approval-queue/1/approve` then refetches (2 GETs total — refresh is an awaited re-fetch), reject stays disabled until the comment is non-empty then POSTs `/approval-queue/1/reject` with the comment, empty queue renders "All caught up!"
- **App.tsx consolidation (D-10):** 5 wiring points — `ListChecks` added to the lucide import, `AppraisalApproval` import → `ApprovalQueue`, `'appraisal-approval'` route → `'approval-queue': '/approval-queue'`, nav item → `{ id: 'approval-queue', label: 'Approval Queue', icon: ListChecks, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL' }`, FREE_ALLOWED_NAV entry swapped, render → `<ApprovalQueue branchId activeBranchId userRole />`. `PendingApprovalPanel` and the `pending-approval` tab/route untouched (Pitfall 8). Grep confirms zero residual `appraisal-approval`/`AppraisalApproval` references.
- **SystemSettings threshold (RBAC-04):** numeric PHP input bound to new `redemptionThreshold` state (default 50000), loaded in both super-admin and branch-admin settings fetches, persisted as `redemptionApprovalThreshold` in the branch-admin save path; merge fixed to spread `currentSettings` FIRST (Pitfall 7 / T-08-07) so a threshold-only save preserves finance/payroll/ledger/global_overrides; positive-finite validation with Swal error + abort before PATCH; super-admin global-overrides path unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build ApprovalQueue.tsx** - `da39236` (feat) — component + test-scaffold fixes (vi.hoisted apiMock, localStorage polyfill in setup.ts, fireEvent.mouseDown)
2. **Task 2: App.tsx wiring + test to green** - `30d7b12` (feat) — 5 wiring points; uncommitted auction hunk stashed before edit and restored after (verified both hunks present)
3. **Task 3: SystemSettings threshold + merge-on-write** - `a960273` (feat)

**Plan metadata:** `docs(08-03): complete approval queue plan` (final commit)

## Files Created/Modified

- `frontend/src/components/ApprovalQueue.tsx` (created) — 608 lines: full queue page, named + default export
- `frontend/src/App.tsx` (modified) — 5 wiring points, AppraisalApproval retired (D-10)
- `frontend/src/components/__tests__/ApprovalQueue.test.tsx` (modified) — vi.hoisted apiMock; `fireEvent.mouseDown` for the Redemption tab click; assertions unchanged from the 08-01 scaffold
- `frontend/src/test/setup.ts` (modified) — jest-dom + guarded localStorage polyfill (Node 22/jsdom)
- `frontend/src/pages/admin/SystemSettings.tsx` (modified) — `Undo2` icon, threshold state, both load paths, validation, merge-on-write save, UI card

## Decisions Made

- **Test contract > Swal-dialog prose:** the plan's T1 action text described Swal confirm gates and a separate "Reason for rejection" dialog; the 08-01 RED scaffold (the executable contract per T2) requires approve to POST on click and an inline rejection textarea. Implemented to the test: direct approve POST with `{ decisionComment: '' }` and inline `Textarea` ("Rejection comment (required)") with disabled-until-non-empty Reject. The review dialog still carries full detail; the backend remains the enforcement authority (T-08-09).
- **Radix Tabs v2 activation is `onMouseDown`** (verified in installed `@radix-ui/react-tabs` dist: trigger's `onMouseDown` calls `context.onValueChange`, not `onClick`). Tab-switch test uses `fireEvent.mouseDown` — a faithful simulation of a real pointer press; `fireEvent.click` alone never activates.
- **`type` query param kept per the RED scaffold:** the backend `ApprovalQueueQueryDto` declares `targetType`; the server ignores the unknown `type` param and the component's client-side `record.targetType === activeTab` filter keeps every tab correct. Noted for a future param-alignment cleanup (see deferred-items).
- **Threshold is branch-level local state**, excluded from the feature-toggle `config` object (destructured out of `localSettings` in the branch load path); super-admin `global_overrides` save path untouched per plan.
- **Self-approval prevention** implemented when the supabase session user id is available (Approve disabled + muted copy); the 08-02 backend guard is authoritative (T-08-10).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test scaffold TDZ crash: `Cannot access 'apiMock' before initialization`**
- **Found during:** T1 first test run (collection phase)
- **Issue:** The 08-01 scaffold declares `const apiMock = { get: vi.fn(), ... }` AFTER `vi.mock('../../lib/apiClient', () => ({ api: apiMock, default: apiMock }))`; vitest hoists the mock factory above the declaration, so the factory read an uninitialized `apiMock`.
- **Fix:** `const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));` — the canonical vi.hoisted pattern (same family as AuctionQueue's fetch stub). Assertions untouched.
- **Files modified:** frontend/src/components/__tests__/ApprovalQueue.test.tsx
- **Commit:** da39236

**2. [Rule 1 - Bug] `Cannot read properties of undefined (reading 'setItem')` — no localStorage in jsdom env**
- **Found during:** T1 second test run
- **Issue:** `environment: 'jsdom'` is configured, but under Node 22 + vitest the global `localStorage` was undefined (experimental Node localStorage not enabled), so the component's `localStorage.getItem('active_pawnshop_id')` threw on mount.
- **Fix:** guarded polyfill in `frontend/src/test/setup.ts` — if `typeof globalThis.localStorage === 'undefined'`, define a Map-backed Storage via `Object.defineProperty` (configurable/writable). Assertions untouched.
- **Files modified:** frontend/src/test/setup.ts
- **Commit:** da39236

**3. [Rule 1 - Bug] Tab switch never refetched — `fireEvent.click` doesn't activate Radix Tabs v2**
- **Found during:** T2 (test 2 failing: last GET still `type: 'APPRAISAL'`)
- **Issue:** Installed `@radix-ui/react-tabs` (v2, data-slot era) activates triggers in `onMouseDown` (`event.button === 0 && !ctrlKey`), not `onClick`. `fireEvent.click` dispatches only a click, so `onValueChange` never fired and the refetch never happened. The component is correct for real users (pointer press activates).
- **Fix:** `fireEvent.mouseDown(screen.getByText('Redemption'))` in the test (one line; assertion unchanged). No new dependency — `@testing-library/user-event` is not installed and package installation is not auto-fixable.
- **Files modified:** frontend/src/components/__tests__/ApprovalQueue.test.tsx
- **Commit:** da39236

**4. [Rule 2 - Missing critical functionality] Branch-admin settings save wiped existing keys (Pitfall 7 / T-08-07)**
- **Found during:** T3 (reading `handleConfirmSave`)
- **Issue:** The branch-admin path built `updatedSettings = { ...sanitizedConfig, global_overrides }` — a wholesale replacement that deletes any settings key not in the feature-toggle config (finance/payroll/ledger keys, and anything future). A threshold-only save would clobber them; the backend replaces the whole settings JSON, so the frontend merge IS the protection (plan point 4).
- **Fix:** `{ ...currentSettings, ...sanitizedConfig, redemptionApprovalThreshold: threshold, global_overrides: currentSettings.global_overrides || {} }` — spread currentSettings FIRST. Added positive-finite threshold validation with Swal abort before PATCH.
- **Files modified:** frontend/src/pages/admin/SystemSettings.tsx
- **Commit:** a960273

**5. [Plan staleness - no code fix] Full frontend suite not green at baseline**
- **Found during:** wave verification
- **Issue:** Plan success criterion "full frontend test suite green" cannot hold: the frontend suite has 2 pre-existing failures (AuctionQueue `returns an item to the vault` — SweetAlert2 `window.matchMedia` crash; InventoryVault "Gold Necklace" expectations) that exist before 08-03's commits and are unrelated to this plan's files.
- **Fix:** None (out of scope per scope boundary). ApprovalQueue suite is green 5/5; suite totals are identical before/after (2 failed files / 7 passed tests). Logged to deferred-items.md.
- **Files modified:** none
- **Commit:** n/a

---

**Total deviations:** 5 (3 test-infra bugs, 1 settings-wipe correctness fix, 1 baseline staleness)
**Impact on plan:** All fixes required to satisfy the locked RED scaffold or the plan's own Pitfall 7/T-08-07 mitigation. No scope creep; no architectural changes; no new dependencies.

## Issues Encountered

- **Pre-existing frontend suite failures (out of scope, documented, NOT fixed):** `AuctionQueue.test.tsx` (`returns an item to the vault` — SweetAlert2 crashes on `window.matchMedia('(prefers-color-scheme...)').addEventListener` under jsdom) and `InventoryVault.test.tsx` ("Gold Necklace" expectation). Neither file is touched by this plan (`git diff --name-only` confirms; failure counts identical before/after 08-03 commits). Logged to `deferred-items.md`.
- **Known contract mismatch (flagged, not blocking):** frontend sends `type=` on GET /approval-queue (per the locked RED scaffold) while the backend `ApprovalQueueQueryDto` declares `targetType`; the server drops the unknown param and the component's client-side filter keeps the tabs correct. Recommend aligning the param in a future cleanup.

## Known Stubs

None — the queue renders real persisted data; `threshold ?? 50000` and `customer/requestedBy` null-fallbacks are deliberate defaults (server also defaults the threshold to 50000), not placeholders blocking the plan's goal.

## User Setup Required

None — threshold defaults to ₱50,000 server- and client-side when unset; no external service configuration.

## Next Phase Readiness

- Phase 08 complete: RBAC-04 (threshold config surface) and RBAC-05 (unified queue UI) delivered end-to-end; backend 08-02 + frontend 08-03 form the full approval workflow.
- Held-out manual verifications (08-VALIDATION + UI-SPEC backstops): long-text truncation in queue rows and Decision History table (implemented via `truncate` + `overflow-x-auto`) and the ContractViewer sign → disbursement handoff need a human browser pass via /gsd-verify-work with an OWNER account at /approval-queue.

---

*Phase: 08-approval-workflows-unified-approval-queue*
*Completed: 2026-08-06*

## Self-Check: PASSED

- Created file present: `frontend/src/components/ApprovalQueue.tsx`; all 4 modified files present
- Commits verified in git log: `da39236`, `30d7b12`, `a960273`
- Plan verification gates: `npx vitest run src/components/__tests__/ApprovalQueue.test.tsx` 5/5 green; full suite totals unchanged (2 pre-existing failures); `npm run build` exit 0 (ApprovalQueue/SystemSettings/App.tsx type-clean in tsc scan); grep: no residual `appraisal-approval`/`AppraisalApproval` in App.tsx; merge-on-write grep: `...currentSettings,` precedes `...sanitizedConfig`
