# Phase 6: Auction House Professionalization — Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Professionalize the auction house to match the main system's standard: winners sign contracts before payment, staff manage release workflow, and every status change is visible to both sides. The backend auction engine is already complete — this phase fills the UI and workflow gaps.

</domain>

<decisions>
## Implementation Decisions

### Winner Contract → Pay → Release Flow
- **D-01:** Full professional flow: Winner signs contract → pays → staff verifies → staff releases item
- **D-02:** Contract signing uses the existing TOS acceptance pattern (typed name electronic signature, stored in `TOSAcceptance` or `AuctionWinnerCompliance`)
- **D-03:** Payment button is disabled/gated until contract is signed
- **D-04:** A `contractSignedAt` field or equivalent must exist on the compliance record to gate payment

### Staff UI: New Auction Settlements Tab
- **D-05:** New sidebar tab "Auction Settlements" in the main dashboard alongside "Auction Queue" and "Live Auctions"
- **D-06:** Shows all ended auctions with compliance status, winner info, payment status
- **D-07:** Release button only active when compliance status >= COMPLIED
- **D-08:** Manual settle form for admin override (requires winner selection + bid amount)

### Notifications: In-App Banner
- **D-09:** Winner sees banner on auction-frontend page load: "You won [item]! Complete payment by [deadline]"
- **D-10:** Banner dismissed after winner acknowledges or after payment
- **D-11:** Countdown timer in My Winnings page in dd:hh:mm format
- **D-12:** When staff releases item, winner sees "Item Released" badge with date

### Backend Endpoint Design
- **D-13:** `GET /auction/settlements` — paginated list of ended auctions with compliance status (staff auth)
- **D-14:** `PATCH /auction/settlements/:complianceId/release` — set COMPLIED→RELEASED (staff auth, records staff ID + notes)
- **D-15:** `POST /auction/settlements/:complianceId/manual-settle` — create compliance record for arbitrary winner (admin auth)
- **D-16:** Reuse existing `@Roles()` pattern — settlements endpoints require MANAGER/OWNER/ADMIN roles
- **D-17:** Reuse existing `@Public()` — settlement listing is not public

### the agent's Discretion
- Exact UI styling for the contract viewer (follow existing Terms page pattern)
- Loading/empty/error states for the Auction Settlements tab
- How countdown timer handles timezone (server UTC vs client local)
- Exact banner dismissal behavior (persist dismissal per session or permanently)

</decisions>

<specifics>
## Specific Ideas

- Contract viewer in auction-frontend should reuse the Terms.tsx page pattern — fetch template + clauses, render formatted contract, typed-name signature
- Release workflow should feel like the existing compliance flow — clear status badges, action buttons disabled when not applicable
- Settlement tab should match the existing AuctionQueue.tsx layout (table, action buttons, status badges)

</specifics>

<canonical_refs>
## Canonical References

### Auction Backend
- `backend/src/auction/auction-settlement.service.ts` — Existing settlement cron, `generateWonAuctionContract()`, `checkExpiredCompliances()`
- `backend/src/auction/auction.controller.ts` — Existing endpoints, auth patterns, response format
- `backend/prisma/schema.prisma` lines 1104-1150 — `AuctionWinnerCompliance` model with all statuses and fields
- `backend/prisma/schema.prisma` lines 430-440 — `ContractType.AUCTION_BIDDER_AGREEMENT`

### Auction Frontend Patterns
- `auction-frontend/src/pages/Terms.tsx` — Existing TOS viewer + electronic signature pattern
- `auction-frontend/src/pages/MyWinnings.tsx` — Existing winnings page (needs contract step + countdown)
- `auction-frontend/src/services/auctionApi.ts` — API client pattern

### Main Frontend Auction Components
- `frontend/src/components/AuctionQueue.tsx` — Existing queue management tab (pattern for new Settlements tab)
- `frontend/src/App.tsx` — Sidebar routing (add new Auction Settlements entry)

### SPEC.md
- `.planning/phases/06-auction-house/06-SPEC.md` — Locked requirements, boundaries, acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `auction-frontend/src/pages/Terms.tsx` — Contract fetch + clause rendering + electronic signature can be adapted for winner contract
- `frontend/src/components/AuctionQueue.tsx` — Table layout with action buttons, status badges — direct pattern for Settlements tab
- `backend/src/auction/auction-settlement.service.ts` — `generateWonAuctionContract()` already creates the contract — just need to surface it

### Established Patterns
- Backend: `@Roles()` decorator on staff endpoints, `@Public()` on public endpoints, custom DTOs with class-validator
- Frontend: Axios `apiClient` with auth headers for dashboard, raw `fetch()` for auction-frontend
- Contract viewer: Fetch template + clauses from `/contracts/templates` and `/contracts/clauses`
- Status badges: Consistent color-coded badges (green=COMPLIED/RELEASED, yellow=PENDING, red=EXPIRED)

### Integration Points
- `auction-frontend/src/services/auctionApi.ts` — Add `fetchContract(complianceId)`, `signContract(complianceId, signedName)`
- `frontend/src/App.tsx` — Add new sidebar entry `{ id: 'auction-settlements', label: 'Auction Settlements', ... }`
- `backend/src/auction/auction.controller.ts` — Add settlement endpoints
- `backend/src/auction/auction.module.ts` — Add any new providers if needed

</code_context>

<deferred>
## Deferred Ideas

- Email/SMS notifications for winners — no notification delivery system in scope
- Mobile parity — separate phase
- Auction refunds (`ComplianceStatus.REFUNDED` flow) — no UI or endpoint
- Real-time bidding via WebSocket — polling-based approach unchanged
- Merging auction-frontend into main frontend — separate apps with different auth models

</deferred>

---

*Phase: 06-auction-house*
*Context gathered: 2026-07-24*
