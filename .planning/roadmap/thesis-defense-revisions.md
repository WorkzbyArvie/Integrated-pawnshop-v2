---
title: Thesis Defense Revisions - Pawnshop System Enhancements
status: in_progress
updated: 2026-07-03
---

## What The Panel Wants Fixed

1. Strong relational data model with explicit history and traceability.
2. Verifiable contract lifecycle with proof of contract and audit trail.
3. Deterministic finance math for interest, fees, grace periods, and penalties.
4. Realistic process flow from appraisal to contract, release, expiry, and auction.
5. Evidence-backed business rules validated with real pawnshop interviews.

## Roadmap

### Phase 1: Finance Engine Hardening

Goal: centralize pawn charge math so interest and penalties are computed from one deterministic source.

Deliverables:
- Shared charge calculator used by redemption and backfill flows.
- Integer-cented math to avoid float drift.
- Test coverage for interest, fee, and late penalty scenarios.

### Phase 2: Contract And History Backbone

Goal: ensure contracts, appraisals, tickets, and inventory records are linked through explicit relationships.

Deliverables:
- Contract lifecycle events and immutable history rows.
- Appraiser-linked valuation history.
- Item and transaction history views with proper foreign keys.

### Phase 3: Workflow State Machine

Goal: enforce the real shop process from received item to pawned, redeemed, expired, or auctioned.

Deliverables:
- Explicit status transitions.
- Legal/RBAC checks on sensitive actions.
- Proof-of-contract generation for customer-facing records.
- Proof-of-transaction records for every pawn, payment, redemption, and auction event.
- Transaction transparency so staff and auditors can trace who did what, when, and why.
- Compliance-oriented record keeping to reduce disputes, theft exposure, and unauthorized contract changes.

### Phase 4: Operational Realism

Goal: make subscription, inventory, and auction behavior match multi-tenant pawnshop operations.

Deliverables:
- Clear active-vs-expired inventory buckets.
- Subscription duration rules per tenant.
- Auction handoff rules for expired collateral.

### Phase 5: Defense Evidence

Goal: close the research gap cited by the panel.

Deliverables:
- Interview notes from real pawnshop operators.
- Traceability matrix from critique to implemented feature.
- Final documentation for submission.

## Current Status

- The legal proof flow is underway and now emits auditable proof records for applications and payments.
- The history-relationship layer is now in place for loan, payment, ticket, and auction proof trails.
- The next implementation target is contract lifecycle wiring and workflow RBAC.