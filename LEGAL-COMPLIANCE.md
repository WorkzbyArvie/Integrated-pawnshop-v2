# LEGAL-COMPLIANCE.md

**Project:** PawnGold — Integrated Pawnshop Management System (Academic Thesis / Capstone)
**Location:** Dasmarinas, Cavite, Philippines
**Last verified:** September 10, 2026

## 1. Purpose

This document maps the PawnGold platform surface to the Philippine legal framework and records the
compliance measures implemented in the codebase. It supports Thesis B defense by demonstrating that the
system addresses legality, proof, receipts, payment history, terms & agreements, traceability, and a
realistic process flow.

## 2. Applicable Philippine Laws

| Law | Applies To | PawnGold Relevance | Status |
|-----|-----------|--------------------|--------|
| **RA 10173 — Data Privacy Act of 2012** | Any personal data processing in the Philippines | The platform stores owner, staff, customer, and bidder personal data (identity data, contact details, KYC documents, transaction records). Must honor data subject rights, exercising of consent, and security safeguards. | **Implemented** — consent checkboxes on owner signup, trial request, bidder signup, and KYC; Privacy Policy + Cookie Policy published; no tracking cookies. Human-readable data-privacy notice in codebase. |
| **RA 7394 — Consumer Act of the Philippines** | Transactions with consumers; prohibition of deceptive practices | Auction sales and paid plans must not mislead. Refund/cancellation disclosure exists. | **Implemented** — Refund & Cancellation Policy pages published on both frontends; fake testimonials and fabricated claims removed from marketing pages. |
| **RA 8792 — E-Commerce Act** | Validity of electronic contracts and signatures | Loan contracts, bidder agreements, and TOS acceptance rely on recognized electronic consent and binding records. | **Implemented** — contract generation, digital signature capture, acceptance tracking, and immutable legal proofs per transaction. |
| **RA 10175 — Cybercrime Prevention Act** | Unauthorized access, hacking, identity theft | Security controls and role-based access (RBAC) prevent unauthorized access; audit logs enable tracing of wrongdoing. | **Implemented** — RBAC guard on every endpoint, per-endpoint rate limiting, audit-log interceptor, tenant isolation. |
| **RA 9160 — Anti-Money Laundering Act (as amended)** | Covered persons and reporting entities | Pawnshop operators historically regulated under AMLA; platform records identity verification for auction bidders (KYC) to support pawnshop-partner compliance. | **Partially implemented** — BUYER KYC flow exists; the platform itself is a software tool, not a covered person. See §4. |
| **RA 386 — Civil Code of the Philippines** | Loans, pledges, contracts of commodatum and barter | Pawn transaction lifecycle (loan → interest → redemption/forfeiture) and auction agreements are contract-based. | **Implemented** — state machine, contracts, receipts, proof-of-event records. |
| **RA 11523 — Pawnshop Regulation** (and BSP supervisory context) | Pawnshops as businesses | The platform is a SaaS tool, not a pawnshop. The thesis does not claim the platform is BSP-supervised or licensed. | **Addressed** — disclaimers on both frontends state the platform is not a licensed financial institution or pawnshop operator. |

## 3. Law-to-Feature Mapping

| Compliance Measure | Where Implemented |
|-------------------|-------------------|
| Consent before account creation | `LandingPage.tsx` (owner signup), `PendingAccessDashboard.tsx` (trial request), `auction-frontend Home.tsx` (bidder signup), `KycVerification.tsx` (KYC — explicit data-processing consent) |
| Public Terms of Service | `frontend/src/pages/LegalDocPage.tsx` → `/terms`; auction `Terms.tsx` (signed bidder agreement) |
| Public Privacy Policy | Both frontends → `/privacy` |
| Cookie disclosure (no tracking cookies) | Both frontends → `/cookies` + cookie-notice banner on landing page |
| Refund & Cancellation Policy | Both frontends → `/refunds` |
| Audit trail / traceability | `LegalProof` emission on every transaction; `security_logs` audit interceptor for sensitive operations |
| Contracts & receipts | Contract engine, receipts on payments/redemptions/disbursements |
| Truthful marketing | Fake testimonials removed; dynamic verified-owner reviews from `GET /reviews`; fabricated stats, certification badges, and uptime claims removed |
| Data isolation | Multi-tenant isolation (RLS + pawnshop scoping), RBAC on all endpoints |

## 4. Important Exclusions

1. **PawnGold is not a pawnshop.** It is an administrative software platform. Loan rates, contracts, and
   disclosure obligations for actual pawn loans remain the responsibility of the operating pawnshop.
2. **PawnGold is not regulated by BSP.** The platform (and this thesis) does not claim BSP registration,
   ISO 27001, SOC 2, GDPR certification, or any formal compliance certification.
3. **Academic disclaimer.** The project is for demonstration and education. No uptime SLA is offered.
4. **KYC is informational.** The bidder KYC flow supports the platform's auction marketplace but does not
   itself satisfy AML reporting duties, which belong to covered persons under RA 9160.

## 5. Status & Recommended Next Steps

- [ ] Register the thesis Data Protection Officer / designate a contact for data subject requests
- [ ] Add a formal DPIA (Data Privacy Impact Assessment) doc for the KYC data category
- [ ] Add user-facing data-export (portability) and account-deletion tooling
- [ ] Add an admin action to moderate reviews faster (already present as SUPER_ADMIN `review.moderate`)
- [ ] Review hosting/data-residency terms with the platform host (Supabase/PostgreSQL) and document them