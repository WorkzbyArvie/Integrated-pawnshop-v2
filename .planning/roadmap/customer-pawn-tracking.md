# Customer Self-Service Pawn Tracking — Recommendations (Deferred)

**Created:** 2026-09-01
**Status:** Deferred — decision captured for a later phase. No build work started.
**Question raised:** How will pawnshop customers monitor their pawned items? Is having a mobile account mandatory?

## Current State (facts from the codebase)

- `Customer` table (`backend/prisma/schema.prisma:46`) has `contactNumber`, `tier`, `kycStatus` — but **no login identity** (`authId` absent).
- No `CUSTOMER` role in the `Role` enum — customers cannot authenticate anywhere today.
- Staff-only tracking exists: `CustomerHistory.tsx` + `LoanStatusProgress.tsx` live inside the staff dashboard/CRM, not customer-facing.
- Mobile app only wires `BIDDER_REGISTRATION` (auction) — the Home/Loans/Auction mock screens are not connected to the backend (Phase 6 pending).
- OTP auth infra is built and reusable: `POST /auth/request-auth-code`, `/auth/verify-auth-code`, `/auth/register-bidder`, `/auth/register-owner` (`backend/src/app.controller.ts:93-148`).
- Mobile-number lookup pattern already proven in the queue module: `POST tickets/mobile` + `GET my-tickets` (`backend/src/queue/queue.controller.ts:116,131`).
- Reusable UI components: `LoanStatusProgress` (lifecycle bar), `LoanHistoryTimeline`, `ReceiptViewer`.

## Recommendation 1 — "Track & Trace", no account (guest OTP lookup)

**Flow:** Customer visits a public `/track` page, enters **pawn ticket number + mobile number** → backend sends a 6-digit OTP → customer enters it → sees ticket status (RECEIVED → APPRAISED → OFFER → DISBURSED → … → REDEEMED/FORFEITED), maturity date, redemption amount, and event timestamps.

- Endpoints: `POST /customer-tracking/request-otp`, `POST /customer-tracking/verify`, `GET /customer-tracking/tickets/:ref` (rate-limited, short-lived token).
- **No new role, no RLS user sessions, no password management. Mobile = the identity.**
- Pros: zero customer friction, nothing to forget, fastest to build and demo, naturally "no forced account."
- Cons: re-verify each visit (or print a 24h token on the receipt); no push notifications or online renewal from the app.

## Recommendation 2 — Full customer portal (CUSTOMER role + password)

**Flow:** Customer registers (email/mobile + OTP → sets PIN), linked to their `Customer` row via a new nullable `authId` column. `GET /customer/my/tickets` behind RLS returns only their own tickets. Persistent logged-in experience with notifications + online renewal/payment later.

- Requires: new `CUSTOMER` role, RLS policy on `ticket` (`authId = auth.uid()`), registration + linking flow, password/PIN reset.
- Pros: richest experience — persistent access, notifications, online redemption, audit identity.
- Cons: biggest build (auth + RLS + linking + reset flows), biggest customer friction, and the panel may ask "why force an account to check your own pawn?" Additional security surface.

## Recommendation 3 — Hybrid (CHOSEN direction)

**Build Recommendation 1 now; design the schema so R2/R3 is one small migration later.**

- Default path is the **no-account OTP lookup** (all R1 benefits; concept for the defense demo).
- Add `Customer.authId` (nullable) to the schema now, but do not build the account UI yet.
- Later, link that identity to the **existing bidder auth** (`/auth/register-bidder`) → **one login for both auction bidding and pawn tracking**, reusing KYC, OTP, and account infra instead of building a parallel customer identity.

**Rationale:** lowest risk for the thesis (a working, frictionless demo), a clear answer to "must customers have an account?" (no — here is the proof), and the optional account layer forwards into what we would actually sell.

## Proposed future plan (when picked up)

1. Schema/prep: nullable `authId` on Customer; human-friendly `referenceNo` on ticket.
2. Backend: `CustomerTrackingModule` — `POST /customer-tracking/request-otp`, `POST /customer-tracking/verify`, `GET /customer-tracking/tickets/:ref` (rate-limited, TTL token).
3. Web: public `/track` page; print tracking code + OTP instructions on the receipt.
4. Mobile: wire the `Loans` tab to the new endpoint, replacing mock data (also satisfies Phase 6 mobile–backend integration).
5. Tests/UAT: wrong-OTP lockout, ticket of another mobile rejected, customer view matches staff dashboard.

## Open question for later

- Whether to (a) keep the reference pure no-account, or (b) add the optional account-save path (R3) before the defense. Not decided.