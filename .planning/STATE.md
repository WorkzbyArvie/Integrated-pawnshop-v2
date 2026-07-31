---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Advisor Compliance & RBAC Overhaul
status: planning
last_updated: "2026-07-31T10:42:58.087Z"
last_activity: 2026-07-31
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# STATE.md — PawnGold Project State

## Current Phase: Phase 6 — Auction House Professionalization (Complete)

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Onboarding | ✓ Complete | Codebase mapped, project initialized |
| Phase 1: Fix Backend | ✓ Complete | prisma generate fixed compilation, backend starts |
| Phase 2: Pawn Ticket Lifecycle | ✓ Complete | Ticket creation, approval, contract, disbursement working |
| Phase 2.5: Process Flow Completion | ✓ Complete | Appraisal endpoint, grace period cron, in-person redemption, notifications |
| Phase 3: Contract & Receipt System | ✓ Complete | All receipt types + legal proofs for every transaction |
| Phase 4: Frontend Integration | ✓ Complete | All writes routed through backend API, viewers verified |
| Phase 5: Security & Polish | ✓ Complete | RBAC hardened, auth leaks fixed, pending access flow fixed |
| Performance Optimization | ✓ Complete | Platform analytics 13→1 query, N+1 batch fix, 15 new DB indexes |
| Audit History Fix | ✓ Complete | Role mismatch fixed, cross-tenant data leak removed |
| Redemption Receipt UI | ✓ Complete | ReceiptViewer modal after redeem + Inventory Vault receipt button |
| Phase 6: Demo Prep | ○ Pending | |
| Phase 6: Auction House Professionalization | ✓ Complete | Winner contract signing, staff release workflow, countdown timer, settlement admin |

## Blockers

- None currently

## Decisions

- Fix bugs first, then add features
- Use standard Philippine pawnshop formats for contracts/receipts
- Less than 2 weeks timeline — focus on demo-critical paths
- Phase 2.5 added to fill missing process gaps
- All frontend writes now route through NestJS backend (no direct DB writes from browser)
- Presence/heartbeat and Supabase Auth operations remain client-side (standard practice)
- Contract templates auto-seed on first startup when table is empty (2026-07-27)
- Auction bidder endpoints exempt from pawnshop-id header (external users, 2026-07-27)
- KYC requires manual admin review — no more auto-approval (2026-07-27)
- KYC rejects obviously fake names via pattern matching (2026-07-27)

## Backend Endpoints Added

- `POST /pawn-tickets/:id/send-to-auction` — Active ticket → AUCTION with proof
- `PATCH /tenant-governance/pawnshops/:id/toggle-status` — Super Admin toggle
- `PATCH /tenant-governance/pawnshops/:id/settings` — Update pawnshop settings
- `POST /tenant-governance/pawnshops/:id/delete` — Cascading delete with audit
- `GET /auction/settlements` — List ended auctions with compliance status
- `PATCH /auction/settlements/:id/release` — Release item to winner (staff)
- `POST /auction/settlements/:id/manual-settle` — Admin manual settlement
- `POST /auction/settlements/:id/sign-contract` — Winner signs contract (public)

## Receipt Types (All Implemented)

| Transaction | Receipt | Proof |
|---|---|---|
| Appraisal | APPRAISAL_CERTIFICATE | ✅ |
| Payment | PAYMENT | PAYMENT_PROOF |
| Penalty | PENALTY | PENALTY_PROOF |
| Forfeiture | FORFEITURE | FORFEITURE_PROOF |
| Grace period | — | GRACE_PERIOD_ENTRY |
| Auction won | AUCTION_SALE | AUCTION_SELLER_PROOF |
| Auction compliance | AUCTION_SALE | RECEIPT_PROOF |
| Auction unsold | AUCTION_UNSOLD | AUCTION_UNSOLD_PROOF |

## Frontend Components Using Backend API

- ContractViewer → GET/PATCH /loan/contracts/*
- ReceiptViewer → GET /receipts/*
- LoanHistoryTimeline → GET /loan/*/history
- LoanStatusProgress → GET /loan/*/status
- AppraisalApproval → POST /pawn-tickets/*, POST /loan/*/disburse
- SalesPos → POST /pawn-tickets
- InventoryVault → POST /pawn-tickets/*/send-to-auction
- PlatformControl → POST/PATCH /tenant-governance/pawnshops/*
- SystemSettings → PATCH /tenant-governance/pawnshops/*/settings
- AuctionSettlements → GET/PATCH /auction/settlements/*
- MyWinnings (auction-frontend) → POST /auction/settlements/*/sign-contract

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-31 — Milestone v2.0 started
