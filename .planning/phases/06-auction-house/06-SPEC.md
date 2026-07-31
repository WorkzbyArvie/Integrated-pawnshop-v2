# Phase 6: Auction House Professionalization — Specification

**Created:** 2026-07-24
**Ambiguity score:** 0.12
**Requirements:** 5 locked

## Goal

Auction house matches the same professional standard as the main system — winners sign contracts before payment, staff manage the release workflow, and every transaction has proper audit trail and notification.

## Background

The backend auction system is well-built: full CRUD, KYC, TOS, bidding engine, settlement cron, PayMongo payments, LegalProof + Receipt generation for every event. The auction-frontend (separate public-facing app) lets users browse, bid, pay. Two gaps remain for thesis B professional standard:

1. **Winner contract** — `AuctionSettlementService.generateWonAuctionContract()` already generates contracts, but the winner never sees/signs them in the auction-frontend UI
2. **Release workflow** — `AuctionWinnerCompliance` has `RELEASED` status and tracking fields, but no staff UI exists to verify compliance and release items
3. **Compliance visibility** — Winners see "Pay Now" but no countdown, no notification when they win

The main frontend dashboard has `AuctionQueue.tsx` and `AuctionMarketplace.tsx` but no compliance/settlement admin view.

## Requirements

1. **Winner contract viewer + signing**: Winner must review and sign the won-auction contract before paying.
   - Current: `generateWonAuctionContract()` creates the contract server-side but no UI shows it to the winner. Winner goes straight to PayMongo checkout.
   - Target: After auction ends with a win, auction-frontend shows a "Review & Sign Contract" step. Winner views contract terms, types their name (electronic signature), and only then proceeds to payment.
   - Acceptance: After settlement creates a winner compliance record, opening my-winnings shows "Sign Contract" button → contract renders → signing unlocks "Pay Now" button

2. **Staff release workflow**: Staff can view winning bidders and mark items as released.
   - Current: No release UI exists. `AuctionWinnerCompliance` has `RELEASED` status and `releasedAt`/`releasedBy`/`releaseNotes` fields but no endpoint or UI to set them.
   - Target: Main dashboard gets new "Auction Settlements" tab. Staff see list of won items with compliance status, can verify payment proof, and click "Release Item" which sets status to `RELEASED` with staff ID + notes.
   - Acceptance: Staff can view compliance records, verify a winner, and click Release → status changes to `RELEASED` → winner sees "Item Released" in their winnings view

3. **Winner compliance countdown + notification**: Winner sees payment deadline countdown and gets notified when they win.
   - Current: Winner only sees "Pay Now" button. No deadline shown. No notification when auction ends with a win.
   - Target: My Winnings page shows countdown timer to compliance deadline. When settlement runs and marks winner, auction-frontend shows a notification banner.
   - Acceptance: Winnings page displays remaining time in dd:hh:mm format. After settlement, refreshing shows compliance deadline. Winner sees status changes.

4. **Auction settlement admin endpoint**: Backend endpoint for staff to view and manage auction settlements.
   - Current: `AuctionSettlementService` runs as a cron and has `manualSettle()` but no general "list settlements" or "get compliance detail" endpoint exposed to controllers.
   - Target: `GET /auction/settlements` returns all ended auctions with compliance status. `PATCH /auction/settlements/:complianceId/release` updates compliance to RELEASED with staff ID + notes. `POST /auction/settlements/:complianceId/manual-settle` allows admin override.
   - Acceptance: Endpoints return correct data. Release endpoint updates status and records staff info. Manual settle creates compliance record.

5. **Auction-frontend release notification**: Winner UI shows release status.
   - Current: My Winnings page shows compliance status but not a clear "Released" state with release details.
   - Target: When compliance status is `RELEASED`, winner sees "Item Released" badge with release date. When `COMPLIED`, they see "Payment Confirmed — Awaiting Release".
   - Acceptance: Each compliance status renders a distinct UI state in My Winnings page.

## Boundaries

**In scope:**
- Winner contract viewer + electronic signature in auction-frontend (Terms page pattern reused)
- Staff release workflow in main dashboard (new Auction Settlements tab)
- Compliance countdown timer in auction-frontend My Winnings page
- Backend endpoints: list settlements, release item, manual settle
- Notifications for winners (in-app banner on page load)
- Clear status rendering for all ComplianceStatus values in auction-frontend

**Out of scope:**
- Mobile parity — separate phase (no Flutter changes here)
- Merging auction-frontend into main frontend — separate apps, different auth models
- Email/SMS notifications — server-side notification system exists but out of scope for this phase
- Auction refunds (`ComplianceStatus.REFUNDED`) — no endpoint or UI for processing refunds
- Real-time bid updates via WebSocket — polling-based approach unchanged
- Auction listing creation enhancements — listing creation flow is already functional

## Constraints

- No changes to the settlement cron logic — `AuctionSettlementService` stays untouched
- Contract viewer in auction-frontend must reuse the existing Terms page pattern (`fetchTosTemplate`, contract clause rendering)
- Release endpoint must record staff identity from JWT (existing `user?.id` pattern)
- All new backend endpoints must use existing `@Roles()` + `@Public()` guard patterns

## Acceptance Criteria

- [ ] Winner sees "Review & Sign Contract" before "Pay Now" in my-winnings
- [ ] Electronic signature (typed name) is stored and prevents re-signing
- [ ] Staff can view a list of settlements with compliance statuses
- [ ] Staff can release a won item → status becomes `RELEASED` with staff info
- [ ] My Winnings page shows countdown timer to compliance deadline
- [ ] Winner sees status change after staff releases item
- [ ] `GET /auction/settlements` returns paginated compliance records
- [ ] `PATCH /auction/settlements/:id/release` updates status correctly
- [ ] `POST /auction/settlements/:id/manual-settle` creates compliance for arbitrary winner

## Edge Coverage

**Coverage:** 6/6 applicable edges resolved · 0 unresolved

| Category | Requirement | Status | Resolution / Reason |
|----------|-------------|--------|---------------------|
| Missing contract before payment | R1 | ✅ covered | Winner cannot pay until contract is signed — gate enforced in API |
| Already-paid winner sees contract | R1 | ✅ covered | If payment exists, skip contract step, show receipt |
| Release without payment proof | R2 | ✅ covered | Staff cannot release unless status ≥ COMPLIED — 400 error |
| Compliance already expired | R3 | ✅ covered | Expired compliance shows "Expired" status, not countdown |
| Manual settle with invalid data | R4 | ✅ covered | Validation DTO enforces winnerId + winningBid fields required |
| No settlements to list | R4 | ✅ covered | Empty array returned, not 404 |

## Prohibitions (must-NOT)

**Coverage:** 2/2 applicable prohibitions resolved · 0 unresolved

| Prohibition (must-NOT statement) | Requirement | Status | Verification / Reason |
|----------------------------------|-------------|--------|------------------------|
| MUST NOT allow payment before contract signature | R1 | resolved | verification: test — backend endpoint checks `contractSignedAt` before returning payment URL |
| MUST NOT allow staff to release without COMPLIED status | R2 | resolved | verification: test — release endpoint returns 400 if compliance status < COMPLIED |

## Ambiguity Report

| Dimension | Score | Min | Status | Notes |
|-----------|-------|-----|--------|-------|
| Goal Clarity | 0.92 | 0.75 | ✓ | Professional auction house with contracts + release workflow |
| Boundary Clarity | 0.90 | 0.70 | ✓ | Explicit in/out of scope; mobile and merge excluded |
| Constraint Clarity | 0.85 | 0.65 | ✓ | Reuse existing patterns, no settlement cron changes |
| Acceptance Criteria | 0.88 | 0.70 | ✓ | 9 pass/fail criteria across 5 requirements |
| **Ambiguity** | **0.12** | ≤0.20 | ✓ | |

## Interview Log

| Round | Perspective | Question summary | Decision locked |
|-------|-------------|-----------------|-----------------|
| 1 | Researcher | What exists in auction today? | Full backend auction system with proofs, receipts, KYC, TOS, payments; gaps in winner contract UI and release workflow |
| 2 | Simplifier | Minimum viable professional auction? | Winner contract signing + staff release workflow + deadline visibility — 5 requirements |
| 2 | Researcher | Merge or keep separate? | Keep auction-frontend separate — different auth and styling stacks |
| 3 | Boundary Keeper | What's NOT this phase? | Mobile parity, email notifications, refunds, real-time WebSocket — all out of scope with reasoning |
| 4 | Failure Analyst | What breaks if requirements are wrong? | Payment before contract (prohibition added), release before payment (prohibition added) |

---

*Phase: 06-auction-house*
*Spec created: 2026-07-24*
*Next step: /gsd-discuss-phase 6 — implementation decisions*
