# PAWNGOLD - Integrated Pawnshop Management System

## Project Overview
**Full-stack SaaS pawnshop management platform** with auction house website and mobile app. Built as a capstone/thesis project for Dasmarinas, Cavite.

**Repo:** https://github.com/WorkzbyArvie/Integrated-Pawnshop-System-with-Decision-Support-in-Dasmarinas-Cavite

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend (Dashboard) | React 19 + Vite 6 + TypeScript + TailwindCSS 4 + shadcn/Radix UI |
| Auction Frontend | React 19 + Vite 7 + TypeScript |
| Backend API | NestJS 10 + TypeScript + Prisma ORM 5.22 |
| Database | PostgreSQL (Supabase) with Row-Level Security |
| Mobile | Flutter 3.10+ (Dart) with BLoC state management |
| Auth | Supabase Auth + custom OTP + role-based (10 roles) |
| Maps | Leaflet (web) + flutter_map (mobile) |
| Payments | PayMongo |
| Deployment | Railway (backend), Supabase (DB) |

## Key Architecture
- **Monorepo**: frontend/, backend/, auction-frontend/, mobile/
- **23 Prisma models** + 23 enums
- **10 User Roles**: SUPER_ADMIN, OWNER, ADMIN, MANAGER, STAFF, HR, CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, AUDITOR

---

## Thesis Status
- **Thesis A**: Passed (system had flaws but was let through)
- **Thesis B**: In progress - must fix all panel red marks
- **Panel Feedback**: System lacks contracts, proofs, receipts, payment history, terms & agreements, proper transaction traceability

## Critical Requirements for Thesis B Defense
1. **Legality** - Contracts for loans, auction bids, customer agreements
2. **Proof & Audit Trail** - Immutable records for every transaction
3. **Receipts** - Automated receipt generation for payments, redemptions, auctions
4. **Payment History** - Full transaction history with customer visibility
5. **Terms & Agreements** - TOS acceptance flow for auction bidders, loan borrowers
6. **State Machine** - Proper lifecycle: Appraisal -> Contract -> Release -> Repayment -> Redemption/Forfeiture -> Auction
7. **Traceability** - Who-did-what-when across the entire system
8. **Realistic Process Flow** - Match real-world pawnshop operations
9. **Security** - RLS, RBAC, input validation, rate limiting

---

## Current Roadmap

### Phase 1: LEGALITY & CONTRACT BACKBONE ✅
- [x] Schema: Add contract templates, receipt generation, proof wiring
- [x] Contract Engine: Auto-generate loan contracts, bidder agreements, TOS
- [x] LegalProof Wiring: Emit proof records for EVERY transaction
- [x] State Machine: Proper lifecycle status transitions with RBAC
- [x] Finance Math: Deterministic interest, penalty, grace period calculator
- [x] Receipt System: Generate receipts for all financial events
- [x] Frontend: Contract viewing/signing, receipt printing, history views

### Phase 2: SYSTEM FLOW PROFESSIONALIZATION ✅
- [x] Auto-overdue cron integration with state machine
- [x] Auto-forfeiture cron (daily) + manual trigger
- [x] Disbursement -> Active transition endpoint
- [x] Forfeiture -> Auction queue handoff
- [x] Renewal flow endpoint

### Phase 2.5: PROCESS FLOW COMPLETION (In Progress)
- [ ] Appraisal endpoint (`POST /pawn-tickets/:id/appraise`) — RECEIVED → APPRAISED with valuation
- [ ] Grace period auto-entry cron — OVERDUE → GRACE_PERIOD after 5 days
- [ ] In-person redemption endpoint (`POST /pawn-tickets/:id/redeem`) — staff walk-in payment
- [ ] NotificationModule wiring — alerts for overdue, grace period, forfeiture, redemption

### Phase 3: SECURITY HARDENING ✅
- [x] @Roles() decorator + RbacGuard (RBAC enforcement at every endpoint)
- [x] SUPER_ADMIN-only endpoint protection (built into RbacGuard)
- [x] Per-endpoint rate limiting (Throttle decorator + RateLimitGuard)
- [x] DTO validation audit (4 DTOs fixed)
- [x] Audit log interceptor for sensitive ops

### Phase 4: FRONTEND & UX REFINEMENT ✅
- [x] Loan timeline history component (`LoanHistoryTimeline.tsx`)
- [x] Loan status progress bar + valid transitions (`LoanStatusProgress.tsx`)
- [x] Customer dashboard with aggregate stats (`CustomerHistory.tsx`)
- [x] Receipt viewer/print modal (`ReceiptViewer.tsx`)
- [x] Contract viewer + digital signature canvas (`ContractViewer.tsx`)
- [x] Loan History page wired into sidebar (`LoanHistoryPage.tsx`)

### Phase 5: LEGALITY ENFORCEMENT (PAWN TICKET FLOW) ✅
- [x] Backend: `POST /pawn-tickets` endpoint (ticket creation with LegalProof)
- [x] Backend: `POST /pawn-tickets/:id/approve` (approve → contract generation → OFFER_MADE)
- [x] Backend: `disburseLoan()` now creates LegalProof + Receipt
- [x] Backend: `redeemTicket()` now uses state machine + creates LegalProof + Receipt
- [x] Backend: Online redemption (PayMongo webhook) now creates LegalProof + Receipt
- [x] Backend: Fixed contract template lookup (by type fallback)
- [x] Frontend: `SalesPos.tsx` calls backend API instead of direct Supabase
- [x] Frontend: `AppraisalApproval.tsx` integrated with ContractViewer signing + disbursement
- [x] Frontend: `ContractViewer.tsx` added `onSignComplete` callback for workflow

### Phase 6: AUCTION & MOBILE PARITY
- [ ] Auction site contract enforcement
- [ ] Mobile app integration with new backend

---

## Active Tasks
| Task | Status |
|------|--------|
| ECC for Opencode setup | Done |
| AGENTS.md creation | Done |
| Deep code audit | Done |
| Architecture proposal | Done |
| Phase 1 development | Done |
| Phase 2 development | Done |
| Phase 2.5 (Process Flow Completion) | In Progress |
| Phase 3 development | Done |
| Phase 4 development | Done |
| Phase 5 (Legality Enforcement) | Done |
| Phase 6 (Auction & Mobile) | Pending |
| Full UI redesign (Gilded Reserve) | Done |
| Gilded Reserve color sweep (39+49 files, 70+ patterns) | Done |

---

## Recent Architectural Decisions
1. **ECC installed at user-level** - provides skills, agents, security scanning, memory hooks
2. **Phase order**: Backend first (NestJS/Prisma) -> Frontend -> Auction -> Mobile
3. **Finance math** will use integer-cents to avoid float drift
4. **State machine** will use explicit enum transitions with RBAC guards
5. **Pawn ticket flow** now goes through NestJS backend with contract enforcement (2026-07-07)
6. **Contract renderer** supports both UUID lookup and type-based fallback (2026-07-07)
7. **Redemption** now creates LegalProof + Receipt + proper lifecycleStatus transition (2026-07-07)
8. **Phase 2.5 added** to fill process gaps: appraisal endpoint, grace period cron, in-person redemption, notifications (2026-07-17)

---

## Coding Conventions
- **No comments** in source code unless explicitly asked
- **NestJS modules** follow: controller, service, module, dto/
- **Prisma** snake_case for DB columns, camelCase for JS fields
- **Prefer edit over write** for existing files
- **Backend-first** approach for all new features

---

## Decision Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-05 | Use ECC opencode profile | Get skills, agents, security + memory persistence |
| 2026-07-05 | Phase 1 first (Legality) | Panel's biggest red mark |
| 2026-07-05 | Backend-first approach | Database/logic must be solid before UI |
| 2026-07-07 | Phase 1.5 complete | Legality backbone wired: state machine, contracts, proofs, receipts, storage |
| 2026-07-07 | Phase 2 complete | System flow professionalization: auto-crons, renewal, disbursement, auction handoff |
| 2026-07-07 | Phase 3 complete | Security hardening: RBAC guard, rate limiting, DTO audit, audit log |
| 2026-07-07 | Phase 4 complete | Frontend: history timeline, status progress, customer dashboard, receipt viewer, contract viewer |
| 2026-07-07 | Phase 5 complete | Legality enforcement: pawn ticket flow now enforces contract generation + signing + disbursement receipt + redemption proof |
| 2026-07-07 | Contract renderer fallback | Template lookup falls back to `type` when `id` not found (fixes `'loan-contract'` → `LOAN_CONTRACT`) |
| 2026-07-07 | Phase 7: Gilded Reserve UI redesign | Full dark mode redesign across dashboard + auction frontend — Syne + DM Sans typography, gold (#C9A05C) accent, noise grain overlay, geometric precision, unified design system |
