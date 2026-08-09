---
phase: 09-kyc-verification-disbursement-guardrail
plan: 03
subsystem: ui
tags: [kyc, supabase, signed-urls, storage, react, rbac, typescript]

# Dependency graph
requires:
  - phase: 09-kyc-verification-disbursement-guardrail
    plan: 01
    provides: GET/PATCH /kyc/customers endpoints (kyc.view/kyc.verify), CustomerKyc records + Customer.kycStatus enum
  - phase: 09-kyc-verification-disbursement-guardrail
    plan: 02
    provides: 409 ConflictException KYC-gate contract whose err.message the SalesPos ticket-creation path surfaces verbatim
provides:
  - getSignedKycDocUrl minting helper (supabase createSignedUrl) + shared DocLink + SignedDocImage for all kyc-documents read surfaces
  - CustomerKycReview screen (KYC-02 UI per locked 09-UI-SPEC) with pending/all tabs, verify/reject dialog, access-restricted fallback
  - KycStatusBadge with exported KYC_STATUS_PALETTE; SalesPos KYC badge + Capture KYC form; customer-kyc nav wiring (TAB_TO_PATH, FREE_ALLOWED_NAV, OPERATIONAL nav entry)
  - Producer-only classification of getPublicUrl upload sites (AuctionMarketplace, PendingAccessDashboard, OwnerComplianceDashboard, SalesPos) per COVERAGE.md row 10
affects: [09-kyc-verification-disbursement-guardrail (plan 09-04 seed data + bucket flip — all read sites already mint signed URLs), verify-work UAT, post-execution UI review, 10-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signed-URL doc rendering: mint once per URL on mount/preview-open with cancelled-flag cleanup; skeleton/loading while minting; disabled 'Document unavailable' on failure"
    - "Shared DocLink component reused by both KYC review screens; SignedDocImage mirrors the same pattern for the super-admin grid"
    - "Extension sniffing stays on the ORIGINAL stored file_url while src/href point at the minted signed URL"
    - "Producer-side uploads keep getPublicUrl (stored URL string is the canonical value getSignedKycDocUrl parses); consumers always mint signed URLs"

key-files:
  created:
    - frontend/src/lib/kycDocs.ts
    - frontend/src/lib/kycDocs.test.ts
    - frontend/src/components/DocLink.tsx
    - frontend/src/components/KycStatusBadge.tsx
    - frontend/src/components/__tests__/KycStatusBadge.test.tsx
    - frontend/src/components/CustomerKycReview.tsx
  modified:
    - frontend/src/lib/types.ts
    - frontend/src/components/BidderKycReview.tsx
    - frontend/src/App.tsx
    - frontend/src/pages/loans/LoanManagement.tsx
    - frontend/src/components/SalesPos.tsx
    - frontend/src/pages/admin/SuperAdminComplianceOverview.tsx
    - frontend/src/pages/admin/TrialRequestsPanel.tsx

key-decisions:
  - "CustomerKycReview props typed branchId?: string | null (NOT plan-text number | null) to match what App.tsx actually passes (currentBranchId is string|null) — avoids a new TS2322; mirrors ApprovalQueue call-site convention"
  - "LoanManagement.tsx added to Task 3 scope (deviation — plan file list omitted it): SalesPos is rendered via LoanManagement, so userRole must be threaded through it"
  - "SignedDocImage + TrialRequestsPanel preview both mint via useEffect on URL/previewDoc with cancelled-flag cleanup; SuperAdminComplianceOverview keeps 6-anchor -> 3 SignedDocImage swap, everything else untouched"
  - "Extension sniffing in TrialRequestsPanel branches on ORIGINAL previewDoc.file_url; only src/href point at the signed URL"

patterns-established:
  - "KYC doc consumption: every kyc-documents render routes through getSignedKycDocUrl (DocLink for review screens, SignedDocImage for super-admin, effect+state for preview modal); producer sites unchanged"
  - "tsc delta-clean verification against the 48 pre-existing repo-wide error baseline; vitest full-suite delta (2 pre-existing failures unchanged)"
  - "Worker-tree commit discipline: stage only task-scoped files/hunks; pre-existing unrelated uncommitted work left untouched"

requirements-completed: [KYC-02, KYC-05]

# Coverage metadata — drives DETERMINISTIC UAT routing in verify-work
coverage:
  - id: D1
    description: "getSignedKycDocUrl signed-URL minting helper (supabase storage createSignedUrl, 1h TTL, non-path passthrough, exact error messages) + shared DocLink component + BidderKycReview flipped off raw public URLs"
    requirement: KYC-05
    verification:
      - kind: unit
        ref: "frontend/src/lib/kycDocs.test.ts#getSignedKycDocUrl#mints a signed URL for id-front paths"
        status: pass
      - kind: unit
        ref: "frontend/src/lib/kycDocs.test.ts#getSignedKycDocUrl#passes through non-kyc-documents paths untouched"
        status: pass
      - kind: unit
        ref: "frontend/src/lib/kycDocs.test.ts#getSignedKycDocUrl#propagates storage/sign errors"
        status: pass
    human_judgment: false
  - id: D2
    description: "KycStatusBadge shared status pill with exported KYC_STATUS_PALETTE (NOT_SUBMITTED/PENDING/VERIFIED/REJECTED tones) and per-status icon testids"
    requirement: KYC-02
    verification:
      - kind: unit
        ref: "frontend/src/components/__tests__/KycStatusBadge.test.tsx (5 tests, per-status render + aria-label + palette values)"
        status: pass
    human_judgment: false
  - id: D3
    description: "CustomerKycReview screen — pending/all tabs with live pending count, DocLink document tiles (ID Front/Back/Selfie), verify one-click + reject-with-reason dialog, access-restricted fallback for non-kyc.verify roles, refresh/loading/error/empty states"
    requirement: KYC-02
    verification: []
    human_judgment: true
    rationale: "No dedicated spec was planned for this screen; verified by tsc delta-clean + full vitest suite (no regressions). Visual confirmation (dialog scroll at small viewports, long rejection reasons) is a held-out post-execution UI-review item."
  - id: D4
    description: "SalesPos KYC badge beside Customer Name for kyc.view holders (debounced 500ms GET /kyc/customers lookup by normalized name+contact), collapsible Capture KYC form POSTing /kyc/customers with 'KYC submission recorded as pending.' toast + badge flip; ticket-creation 409 gate message surfaced verbatim"
    requirement: KYC-02
    verification:
      - kind: unit
        ref: "frontend/src/components/__tests__/SalesPos.test.tsx (existing suite passes unchanged)"
        status: pass
    human_judgment: true
    rationale: "Existing SalesPos tests pass but do not cover the new badge/capture behavior (no new spec planned); live behavior needs the 09-01 backend and 09-04 seeded data — routed to the post-merge e2e demo."
  - id: D5
    description: "Signed-URL rendering at the two super-admin read sites: SignedDocImage for idFront/idBack/selfie in SuperAdminComplianceOverview (skeleton while minting, disabled 'Document unavailable' on failure, anchor keeps target=_blank) and TrialRequestsPanel preview modal (img/iframe/Open-in-New-Tab use signed URL; loading + failure states; extension sniffing on original file_url)"
    requirement: KYC-05
    verification:
      - kind: other
        ref: "cd frontend && npx tsc --noEmit — delta-clean vs 48-error pre-existing baseline (zero new errors)"
        status: pass
      - kind: other
        ref: "grep getSignedKycDocUrl frontend/src — all 4 kyc-documents read surfaces wired (DocLink x2 consumers, SignedDocImage, TrialRequestsPanel effect)"
        status: pass
    human_judgment: true
    rationale: "Wiring proven by grep + tsc; actual signed-URL rendering against the private bucket is only observable live after the 09-04 bucket flip."

# Metrics
duration: 30min
completed: 2026-08-09
status: complete
---

# Phase 09 Plan 03: Customer KYC Review + Signed KYC Doc Delivery Summary

**Signed-URL KYC document delivery at all four kyc-documents read surfaces (BidderKycReview, CustomerKycReview, SuperAdminComplianceOverview, TrialRequestsPanel), a Customer KYC review screen with verify/reject, a SalesPos KYC status badge + capture form, and customer-kyc nav wiring — producer-only getPublicUrl upload sites classified unchanged per COVERAGE.md row 10**

## Performance

- **Duration:** ~30 min total session; task commits 20:43:55 → 21:01:22 +0800
- **Started:** 2026-08-09T12:43:55Z (first commit 0f10107)
- **Completed:** 2026-08-09T13:01:22Z (last commit 8776a9b)
- **Tasks:** 5 (Task 5 read-only — no commit)
- **Files modified:** 13 (6 created, 7 modified)

## Accomplishments
- `frontend/src/lib/kycDocs.ts` — `getSignedKycDocUrl(storedUrl, ttlSeconds = 3600)` mints a signed URL via `supabase.storage.from('kyc-documents').createSignedUrl(path, ttl)`; passes non-`kyc-documents` paths through untouched; throws with exact messages on missing path / storage error; 9 unit tests green
- Shared `DocLink` component (skeleton + failure states, `target="_blank" rel="noopener noreferrer"`) replaces the raw public-URL anchors in **BidderKycReview** (ExternalLink import + inline anchors removed — intentional deletions) and powers **CustomerKycReview** document tiles
- **CustomerKycReview** screen per the locked 09-UI-SPEC: pending/all pills with live pending count (pending tab uses server-side `?status=PENDING`), rows with `KYC_STATUS_PALETTE` icon tiles, verify one-click / reject-with-required-reason dialog, non-PENDING readout ("Verified on …" / "Rejected — … on …"), access-restricted fallback for non-OWNER/ADMIN/MANAGER (BRANCH_ADMIN canonicalized to ADMIN), refresh/loading/error/empty states
- **SalesPos**: `KycStatusBadge` beside Customer Name for `kyc.view` holders — debounced 500ms `GET /kyc/customers` lookup by normalized name+contact (failures swallowed); collapsible Capture KYC panel (KycIdType select, ID number, optional ID Front/Back/Selfie URLs) POSTs `/kyc/customers` → `'KYC submission recorded as pending.'` toast, panel hides, badge flips PENDING; ticket-creation 409 already surfaces `err.message` verbatim (unchanged, requirement met)
- **Nav wiring** (App.tsx): `customer-kyc` entry in nav array (ShieldCheck, Owner/Admin/Manager, OPERATIONAL), `TAB_TO_PATH['customer-kyc'] = '/customer-kyc'`, FREE_ALLOWED_NAV add, render after approval-queue with `branchId={currentBranchId} activeBranchId={activeOperationalBranchId} userRole={userRole}`; `sales` render now passes `userRole` to LoanManagement → SalesPos
- **SuperAdminComplianceOverview**: `SignedDocImage` sub-component (mint-on-mount with cancelled-flag cleanup, muted pulse skeleton, disabled "Document unavailable", anchor keeps `target="_blank" rel="noopener noreferrer"`) replaces the 6 raw public-URL usages for idFront/idBack/selfie
- **TrialRequestsPanel**: signed URL minted in a `useEffect` when the preview opens; img/iframe/"Open in New Tab" point at the signed URL while extension sniffing stays on the ORIGINAL `file_url`; `Loader2` spinner while minting, disabled "Document unavailable" on failure
- **Read-site sweep (Task 5, READ-ONLY)**: remaining `getPublicUrl` sites confirmed producer-only — `AuctionMarketplace.tsx:515` and `PendingAccessDashboard.tsx:166` (upload → mint → store the URL string, never render; COVERAGE.md row 10), plus `OwnerComplianceDashboard.tsx:154` and `SalesPos.tsx:208` (same upload-then-store pattern); `AuctionQueue.tsx:106` / `InventoryVault.tsx:156,190` read the non-KYC `appraisal-items` bucket (tenant's own collateral photos) — out of scope. Zero unflipped kyc-documents render sites remain

## Task Commits

Each task was committed atomically:

1. **Task 1: signed KYC doc URLs + KycStatusBadge** - `0f10107` (feat) — kycDocs.ts + tests, DocLink, KycStatusBadge + tests, BidderKycReview flip
2. **Task 2: CustomerKycReview page + shared CustomerKycRecord type** - `68f0859` (feat) — types.ts append, CustomerKycReview.tsx
3. **Task 3: customer-kyc nav wiring + SalesPos KYC badge and capture form** - `c4b2bfd` (feat) — App.tsx, LoanManagement.tsx, SalesPos.tsx
4. **Task 4: signed-URL KYC document rendering in super-admin surfaces** - `8776a9b` (feat) — SuperAdminComplianceOverview.tsx, TrialRequestsPanel.tsx
5. **Task 5: classify AuctionMarketplace + PendingAccessDashboard as producer-only** - no commit (READ-ONLY classification; documented above)

**Plan metadata:** `611bf5e` (docs: complete plan — SUMMARY + STATE + ROADMAP + REQUIREMENTS); `ad3726c` (docs: log pre-existing frontend vitest failures to deferred-items)

## Files Created/Modified
- `frontend/src/lib/kycDocs.ts` - `getSignedKycDocUrl` minting helper (createSignedUrl, TTL 3600, non-path passthrough, exact error messages)
- `frontend/src/lib/kycDocs.test.ts` - 9 tests: minting, passthrough, TTL, storage/sign error propagation
- `frontend/src/components/DocLink.tsx` - shared signed-URL doc link (skeleton/loading + "Document unavailable" failure state, new-tab anchor)
- `frontend/src/components/KycStatusBadge.tsx` - status pill + exported `KYC_STATUS_PALETTE`
- `frontend/src/components/__tests__/KycStatusBadge.test.tsx` - 5 tests: per-status render, aria-label, palette values
- `frontend/src/components/CustomerKycReview.tsx` - review screen (tabs, rows, verify/reject dialog, fallback, states)
- `frontend/src/lib/types.ts` - appended `KycIdType` union + `CustomerKycRecord` interface
- `frontend/src/components/BidderKycReview.tsx` - doc anchors → DocLink (ExternalLink import + inline anchors removed)
- `frontend/src/App.tsx` - customer-kyc import/nav/TAB_TO_PATH/FREE_ALLOWED_NAV/render; sales render passes userRole
- `frontend/src/pages/loans/LoanManagement.tsx` - added `userRole` prop, forwarded to SalesPos
- `frontend/src/components/SalesPos.tsx` - userRole prop, KYC badge + debounced lookup, Capture KYC panel, setActiveTab destructure removed
- `frontend/src/pages/admin/SuperAdminComplianceOverview.tsx` - `SignedDocImage` sub-component; 6 public-URL usages → 3 signed tiles
- `frontend/src/pages/admin/TrialRequestsPanel.tsx` - signed-URL preview effect + state; img/iframe/Open-in-New-Tab use signed URL

## Decisions Made
- **`branchId?: string | null`** on CustomerKycReview (not plan-text `number | null`): App passes `currentBranchId` (string|null); plan's type would have introduced a new TS2322. Mirrors ApprovalQueue call-site convention. The pre-existing App.tsx:1629 ApprovalQueue mismatch (number|null → string|null) is a separate untouched pre-existing error.
- **LoanManagement.tsx added to Task 3 scope**: SalesPos is not rendered by App directly — userRole must thread through LoanManagement (plan's file list omitted it; required for the badge/capture gate).
- **SignedDocImage** mint-on-mount + cancelled-flag cleanup; **TrialRequestsPanel** mint-on-preview-open via effect — both follow the Task 1 DocLink pattern.
- **Task 5 classification** recorded per COVERAGE.md row 10: producer sites keep `getPublicUrl` (stored URL string is the canonical value `getSignedKycDocUrl` parses back to an object path).

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan deviation - File scope] LoanManagement.tsx added to Task 3**
- **Found during:** Task 3 (SalesPos badge wiring)
- **Issue:** Plan's Task 3 file list omitted the file between App and SalesPos — `SalesPos` is rendered via `frontend/src/pages/loans/LoanManagement.tsx`, so `userRole` could not reach it.
- **Fix:** Added `userRole?: string | null` prop to LoanManagement and forwarded it to SalesPos.
- **Files modified:** frontend/src/pages/loans/LoanManagement.tsx
- **Verification:** tsc delta-clean; App `sales` render passes userRole; SalesPos receives it.
- **Committed in:** c4b2bfd (Task 3 commit)

**2. [Rule 1 - Bug] Removed unused `RefreshCw` import in CustomerKycReview**
- **Found during:** Task 2 verification (tsc)
- **Issue:** Component used the `Shield` icon for its empty state; `RefreshCw` was imported but unused — would fail `noUnusedLocals` (TS6133).
- **Fix:** Removed the import, added `Shield`; kept the Refresh button using `Loader2`/refresh handler as designed.
- **Files modified:** frontend/src/components/CustomerKycReview.tsx
- **Verification:** tsc count returned to baseline (zero new).
- **Committed in:** 68f0859 (Task 2 commit)

**3. [Rule 1 - Bug] Dropped unused `setActiveTab` destructure in SalesPos**
- **Found during:** Task 3 verification (tsc)
- **Issue:** `setActiveTab` was destructured from props but never used in the component body — pre-existing TS6133 on an edited line.
- **Fix:** Removed it from the destructure; the interface still declares it (SalesPos.test.tsx passes `setActiveTab={vi.fn()}`), so the props contract is unchanged.
- **Files modified:** frontend/src/components/SalesPos.tsx
- **Verification:** tsc error count dropped 49 → 48 (only this pre-existing error removed).
- **Committed in:** c4b2bfd (Task 3 commit)

**4. [Plan deviation - Props type] CustomerKycReview `branchId` typed `string | null`**
- **Found during:** Task 2 (component creation)
- **Issue:** Plan text specified `branchId?: number | null`, but App.tsx passes `currentBranchId` (string | null) — the plan's type would create a new TS2322.
- **Fix:** Typed as `branchId?: string | null`; component destructures only `userRole` (avoids TS6133 on unused props).
- **Files modified:** frontend/src/components/CustomerKycReview.tsx
- **Verification:** tsc delta-clean.
- **Committed in:** 68f0859 (Task 2 commit)

---

**Total deviations:** 4 (2 file/type scope adjustments, 2 pre-existing TS6133 fixes on edited lines)
**Impact on plan:** All adjustments necessary for correctness (tsc delta-clean). No scope creep; no new dependencies; no `npx shadcn` calls.

## Issues Encountered
- **Pre-existing repo-wide tsc baseline (49 at Task 1 start → 48 now):** unrelated files (OwnerComplianceDashboard, PlatformAnalytics, AuctionMarketplace, Dashboard, InventoryVault, ui/calendar, ui/carousel, SubscriptionManager, etc.) carry TS errors predating this plan. Only touched-file errors are pre-existing: `App.tsx(1629,90)` ApprovalQueue `activeBranchId` mismatch (shifted from 1625 by the added render line) and `TrialRequestsPanel.tsx(99,9)` unused `selectedModulesText` (shifted from 75 by the +24 added lines). Documented in deferred-items.md.
- **Pre-existing vitest failures (2 of 23):** `InventoryVault.test.tsx` "marks active items for auction" and `AuctionQueue.test.tsx` "returns an item to the vault" — `supabase.from(...).select(...).in is not a function` mock-chain gap. Neither test nor component imports any 09-03 file; failures are byte-identical before/after. Logged to deferred-items.md.
- **LF→CRLF warnings** on commit of SuperAdminComplianceOverview.tsx — git autocrlf normalization, harmless.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- **09-04 (bucket flip + seed data):** all four kyc-documents read surfaces already mint signed URLs — post-flip, direct public URLs 403 but no render site breaks. Seed customers should carry `kycStatus` values that exercise the PENDING badge + review rows; the 409 gate message contract is stable for the SalesPos toast e2e demo.
- **verify-work UAT:** D1/D2 auto-pass via unit tests; D3/D4/D5 routed to human (UI screen judgment, live badge behavior, post-flip signed rendering).
- **Deferred:** 48 pre-existing frontend tsc errors; 2 pre-existing vitest failures; held-out UI-review items (dialog scroll at small viewports, long rejection reasons) per plan verification note.

---
*Phase: 09-kyc-verification-disbursement-guardrail*
*Completed: 2026-08-09*

## Self-Check: PASSED

- Files verified on disk: kycDocs.ts, kycDocs.test.ts, DocLink.tsx, KycStatusBadge.tsx, KycStatusBadge.test.tsx, CustomerKycReview.tsx (created — all FOUND); types.ts, BidderKycReview.tsx, App.tsx, LoanManagement.tsx, SalesPos.tsx, SuperAdminComplianceOverview.tsx, TrialRequestsPanel.tsx (modified — all FOUND)
- Commits verified in git history: `0f10107`, `68f0859`, `c4b2bfd`, `8776a9b` (all FOUND)
- Tests: `npx vitest run kycDocs KycStatusBadge` → 14/14 green; full `npx vitest run` → 21 passed / 2 pre-existing failures (unchanged)
- tsc: delta-clean vs 48-error baseline (zero new errors; only pre-existing App.tsx:1629 + TrialRequestsPanel:99 in touched files)
- Read-site grep: 4 kyc-documents read surfaces route through `getSignedKycDocUrl`; AuctionMarketplace:515 + PendingAccessDashboard:166 remain producer-only getPublicUrl sites with zero render-site changes
