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
