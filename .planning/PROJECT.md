# PROJECT.md — PawnGold Integrated Pawnshop Management System

## Vision
Full-stack SaaS pawnshop management platform for Dasmarinas, Cavite. Built as a capstone/thesis project. System handles pawn ticket lifecycle, loan management, auction house, staff operations, and customer-facing mobile app.

## Goal for Thesis B Defense
Fix all panel red marks: legality (contracts, receipts, proofs), system flow, data handling, and security. System must run without compilation/runtime errors and demonstrate complete pawn ticket lifecycle with proper legal documentation.

## Constraints
- **Timeline:** Less than 2 weeks to thesis B defense
- **Priority:** Fix bugs first → legality features → system flow → security
- **Scope:** Focus on what will be demonstrated to the panel
- **Standard:** Philippine pawnshop regulatory formats for contracts/receipts

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript + TailwindCSS + shadcn/Radix UI |
| Auction Frontend | React 19 + Vite + TypeScript |
| Backend | NestJS 10 + TypeScript + Prisma ORM |
| Database | PostgreSQL (Supabase) |
| Mobile | Flutter 3.10+ (Dart) + BLoC |
| Auth | Supabase Auth + custom OTP + role-based (10 roles) |
| Payments | PayMongo |
| Deployment | Railway (backend), Supabase (DB) |

## Current State
- Phases 1-5 marked complete in AGENTS.md but backend had 104 compilation errors (Prisma client stale — fixed with `npx prisma generate`)
- Frontend runs with warnings
- Core models exist: 23 Prisma models, 23 enums, 10 user roles
- Legality models added (ContractTemplate, ContractClause, Receipt, TOSAcceptance, LegalProof, LegalEntity) but not verified working at runtime
- State machine exists but transitions may not be fully wired
- Security: RBAC guard, rate limiting added but not audited

## Success Criteria
1. Backend compiles and starts without errors
2. Frontend compiles and starts without critical warnings
3. Pawn ticket lifecycle works end-to-end: Received → Appraised → Offer → Contract → Disbursed → Active → Redeemed/Forfeited
4. Contracts generated for loan transactions
5. Receipts generated for all financial events
6. LegalProof records created for every transaction
7. State machine enforces valid transitions
8. RBAC enforced on all endpoints

## Current Milestone: v2.0 Advisor Compliance & RBAC Overhaul

**Goal:** Close every gap from the tech advisor's review — enforce the compliance/onboarding gate, upgrade contract management, move RBAC to modular permissions with approval chains, gate loan disbursement on KYC verification, and unify customer transaction history with volume-based tiering.

**Target features:**
- Compliance & shop onboarding gate: regulatory docs required before Free Trial, admin review modal with `hasViewed` gating, overall REJECTED/ACTION_REQUIRED aggregation, real-time client compliance dashboard
- Contract management: digital signature image upload, item-specific redemption terms, pawnshop responsibilities & liability clauses
- Fine-grained RBAC: permission-based model replacing hardcoded role strings; approval chains for `CREATE_APPRAISAL` and `APPROVE_REDEMPTION` requiring OWNER sign-off
- KYC & disbursement guardrail: KYC verification on client/loan pipeline, block disbursement when client is not VERIFIED, secure KYC document storage (RLS)
- Customer transaction history & tiering: unified per-customer history covering redemptions and auction receipts, transaction-volume-based tier computation

**Key context:** Tech advisor review conducted 2026-07-31 from a week-old snapshot; audit confirmed many items partially done (canvas signatures, count-based tiers, per-doc compliance) and several missing entirely (docs-before-trial gate, permission-based RBAC, KYC gate on loans). Security gap found: `kyc-documents` storage bucket is public-read with no RLS on `bidder_kyc`.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
