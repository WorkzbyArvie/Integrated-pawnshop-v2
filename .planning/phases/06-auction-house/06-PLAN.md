# Phase 6: Auction House Professionalization — Plan

**Created:** 2026-07-24
**Waves:** 4

## Wave 1: Backend Endpoints

### 1.1 Add `contractSignedAt` to AuctionWinnerCompliance
- **File:** `backend/prisma/schema.prisma` (add field to AuctionWinnerCompliance model)
- **Command:** `npx prisma db push` after adding field
- **Details:** Add `contractSignedAt DateTime? @map("contract_signed_at")` and `signedName String? @map("signed_name")`

### 1.2 Add settlement endpoints to auction controller
- **File:** `backend/src/auction/auction.controller.ts`
- **Endpoints:**
  - `GET /auction/settlements` — list ended auctions with compliance (paginated, filterable by status)
  - `PATCH /auction/settlements/:id/release` — release item (staff)
  - `POST /auction/settlements/:id/manual-settle` — admin override
- **Auth:** MANAGER/OWNER/ADMIN roles

### 1.3 Add settlement service methods
- **File:** `backend/src/auction/auction.service.ts`
- **Methods:**
  - `listSettlements(pawnshopId, status?, limit?, offset?)` — query AuctionWinnerCompliance with joins
  - `releaseCompliance(id, releasedBy, notes?)` — update status to RELEASED
  - `manualSettle(dto)` — create compliance record + contract for arbitrary winner
  - `signContract(complianceId, signedName)` — update contractSignedAt + signedName

### 1.4 Add settlement DTOs
- **File:** `backend/src/auction/dto/` — Create `release-compliance.dto.ts` and `manual-settle.dto.ts`

### 1.5 Add contract signing endpoint (public, for winner)
- **File:** `backend/src/auction/auction.controller.ts`
- **Endpoint:** `POST /auction/settlements/:id/sign-contract` — @Public(), updates contractSignedAt
- **Gates:** Payment button checks contractSignedAt before returning checkout URL

## Wave 2: Auction-Frontend Contract + Countdown

### 2.1 Add contract step to My Winnings
- **File:** `auction-frontend/src/pages/MyWinnings.tsx`
- **Changes:**
  - Before "Pay Now", show "Review & Sign Contract" button if `contractSignedAt` is null
  - Click opens contract viewer modal (reuse Terms.tsx template fetch pattern)
  - After signing, show "Pay Now" button
  - Show countdown timer to complianceDeadline

### 2.2 Add winner banner notification
- **File:** `auction-frontend/src/pages/MyWinnings.tsx` (or create a banner component)
- **Changes:**
  - On page load, if winner has PENDING_COMPLIANCE compliance, show banner
  - Banner: "You won [listing title]! Complete payment by [deadline]"
  - Dismiss button

### 2.3 Add compliance status rendering
- **File:** `auction-frontend/src/pages/MyWinnings.tsx`
- **Changes:**
  - Distinct UI for each ComplianceStatus:
    - PENDING_COMPLIANCE: "Awaiting Payment" + countdown
    - COMPLIED: "Payment Confirmed — Awaiting Release"
    - RELEASED: "Item Released" + release date
    - EXPIRED: "Expired"

## Wave 3: Main Dashboard Settlements Tab

### 3.1 Add sidebar entry
- **File:** `frontend/src/App.tsx`
- **Changes:** Add `{ id: 'auction-settlements', label: 'Auction Settlements', icon: Gavel, roles: [...], type: 'OPERATIONAL' }`

### 3.2 Create Auction Settlements component
- **File:** `frontend/src/components/AuctionSettlements.tsx`
- **Features:**
  - Table: listing title, winner name, winning bid, compliance status, deadline, actions
  - Status badges (color-coded)
  - "Release" button (active only when status >= COMPLIED)
  - "Manual Settle" button (admin only) with modal form
  - Release confirmation dialog with notes field

### 3.3 Wire routing
- **File:** `frontend/src/App.tsx`
- **Changes:** Add route for `auction-settlements` pointing to AuctionSettlements component

## Wave 4: Integration & Polish

### 4.1 Test full flow
- Create listing → bid → settle → winner signs contract → pays → staff releases

### 4.2 Verify error states
- Empty settlements list, expired compliance, already-released items
