# Onboarding Summary

## Project State
- PROJECT.md: present
- REQUIREMENTS.md: present
- ROADMAP.md: present
- STATE.md: missing

## Codebase Context
- Brownfield repo: yes
- Map readiness: complete
- Codebase map: .planning/codebase/ (complete codebase map)
- Fast map available: yes

## Docs Context
- Existing ADR/PRD/SPEC/RFC candidates: 0

## Key Findings
- **Backend:** NestJS + Prisma, had 104 TS compilation errors (fixed with `prisma generate`)
- **Frontend:** React + Vite, runs with warnings
- **Database:** 23 Prisma models, 23 enums, Supabase PostgreSQL
- **Legality:** Models exist (ContractTemplate, Receipt, LegalProof, TOSAcceptance, LegalEntity) but unverified at runtime
- **State Machine:** Exists but transitions may not be fully wired
- **Security:** RBAC guard and rate limiter added but not fully audited
- **Critical Gap:** Frontend bypasses backend with direct Supabase writes

## Priority
1. Fix bugs and verify backend starts
2. Verify pawn ticket lifecycle end-to-end
3. Verify contract/receipt/proof generation
4. Fix frontend to use backend API
5. Security hardening

## Recommended Next Step
- `/gsd-manager` — Start Phase 1 execution (Fix & Verify Backend)
