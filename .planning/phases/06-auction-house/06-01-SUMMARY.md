---
phase: 06-auction-house
plan: 01
subsystem: auction
tags: [auction, contract, compliance, nestjs, react, prisma]
provides:
  - Auction settlement endpoints (list, release, manual-settle, sign-contract)
  - AuctionWinnerCompliance contract signing fields
  - Winner-facing contract step, banner, and compliance status UI
  - Staff/admin Auction Settlements tab in main dashboard
key-files:
  created:
    - backend/src/auction/dto/manual-settle.dto.ts
    - backend/src/auction/dto/release-compliance.dto.ts
    - frontend/src/components/AuctionSettlements.tsx
  modified:
    - backend/prisma/schema.prisma
    - backend/src/auction/auction.controller.ts
    - backend/src/auction/auction.service.ts
    - auction-frontend/src/pages/MyWinnings.tsx
    - frontend/src/App.tsx
key-decisions:
  - "Contract signing is public (@Public) so external winners can sign without a tenant session"
  - "Payment button gates on contractSignedAt in the UI before returning the checkout URL"
requirements-completed: []
coverage:
  - id: D1
    description: "AuctionWinnerCompliance extended with contractSignedAt and signedName for contract signing"
    requirement: ""
    verification:
      - kind: other
        ref: "backend/prisma/schema.prisma AuctionWinnerCompliance model"
        status: pass
    human_judgment: false
  - id: D2
    description: "Backend settlement endpoints: GET /auction/settlements (paginated, filterable), PATCH /auction/settlements/:id/release (staff), POST /auction/settlements/:id/manual-settle (admin), POST /auction/settlements/:id/sign-contract (public)"
    requirement: ""
    verification:
      - kind: other
        ref: "backend/src/auction/auction.controller.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Settlement service methods listSettlements, releaseCompliance, manualSettle, signContract with MANAGER/OWNER/ADMIN auth"
    requirement: ""
    verification:
      - kind: other
        ref: "backend/src/auction/auction.service.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "My Winnings page shows Review & Sign Contract step, winner banner, and per-ComplianceStatus UI (Awaiting Payment / Payment Confirmed / Item Released / Expired) with countdown"
    requirement: ""
    verification:
      - kind: other
        ref: "auction-frontend/src/pages/MyWinnings.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Main dashboard Auction Settlements tab with status badges, Release action, and admin Manual Settle modal, wired into routing"
    requirement: ""
    verification:
      - kind: other
        ref: "frontend/src/components/AuctionSettlements.tsx"
        status: pass
    human_judgment: false

## Accomplishments

- Added `contractSignedAt` and `signedName` to the AuctionWinnerCompliance model (`contract_signed_at`, `signed_name`).
- Added settlement DTOs: `manual-settle.dto.ts`, `release-compliance.dto.ts`.
- Added auction controller endpoints: `GET /auction/settlements`, `PATCH /auction/settlements/:id/release`, `POST /auction/settlements/:id/manual-settle`, `POST /auction/settlements/:id/sign-contract` (public).
- Added settlement service methods: `listSettlements`, `releaseCompliance`, `manualSettle`, `signContract` with MANAGER/OWNER/ADMIN role auth.
- My Winnings page: contract step before "Pay Now" when `contractSignedAt` is null, winner notification banner for PENDING_COMPLIANCE, countdown to compliance deadline, and distinct UI per ComplianceStatus.
- Main dashboard: Auction Settlements tab (status color badges, Release button gated on status >= COMPLIED, admin Manual Settle modal) with sidebar entry and routing in App.tsx.
- Full-flow integration: listing → bid → settle → winner signs contract → payment → staff release.

## Verification Notes

- No automated test suite run for this phase; verified via endpoint/component existence and manual QA. Full end-to-end flow (4.1) and error-state checks (4.2) were exercised manually.
