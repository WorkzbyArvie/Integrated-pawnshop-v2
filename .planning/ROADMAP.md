# ROADMAP.md — PawnGold Thesis B Roadmap

**Timeline:** Less than 2 weeks  
**Strategy:** Fix → Verify → Enhance → Polish

---

## Phase 1: Fix & Verify Backend (Days 1-2)

**Goal:** Backend compiles, starts, and core endpoints work

### Tasks
1. Verify `npx prisma generate` resolved all 104 TS errors
2. Run `npm run build` — confirm zero errors
3. Start backend (`npm run start:dev`) — confirm it boots
4. Test database connection via health check or simple query
5. Verify Prisma client sees all models (LegalProof, ContractTemplate, Receipt, TOSAcceptance, LegalEntity)
6. Fix any remaining compilation issues found during build

### Verification
- [ ] `npm run build` exits 0
- [ ] `npm run start:dev` starts without crash
- [ ] Database queries succeed

---

## Phase 2: Pawn Ticket Lifecycle (Days 2-4)

**Goal:** End-to-end pawn ticket flow works with state machine

### Tasks
1. Test ticket creation (RECEIVED status)
2. Test appraisal flow (RECEIVED → APPRAISED)
3. Test approval flow (APPRAISED → PENDING_APPROVAL → OFFER_MADE)
4. Test contract signing (OFFER_MADE → CONTRACT_SIGNED)
5. Test disbursement (CONTRACT_SIGNED → DISBURSED → ACTIVE)
6. Test redemption (ACTIVE → REDEEMED)
7. Test forfeiture (ACTIVE → GRACE_PERIOD → FORFEITED → AUCTION_QUEUED)
8. Verify LegalProof created at each transition
9. Verify Receipt created for disbursement and redemption
10. Fix any state machine transition errors

### Verification
- [ ] Full lifecycle: RECEIVED → REDEEMED works
- [ ] Full lifecycle: RECEIVED → FORFEITED works
- [ ] LegalProof records created at each step
- [ ] Receipts created for financial events

---

## Phase 2.5: Process Flow Completion (Days 4-6)

**Goal:** Fill missing process gaps for complete lifecycle coverage

### Tasks
1. Add appraisal endpoint (`POST /pawn-tickets/:id/appraise`) — RECEIVED → APPRAISED transition with item valuation, risk score, and recommended loan amount
2. Add grace period auto-entry cron — auto-transition OVERDUE → GRACE_PERIOD after configurable days (default: 5)
3. Add in-person redemption endpoint (`POST /pawn-tickets/:id/redeem`) — staff processes walk-in payment, transitions ACTIVE/GRACE_PERIOD → REDEEMED, generates receipt + LegalProof
4. Wire NotificationModule into lifecycle — alerts for: overdue reminder, grace period entry, forfeiture warning, redemption confirmation
5. Test all new endpoints with Postman/curl
6. Verify LegalProof + Receipt created for each new transition

### Verification
- [ ] Appraisal endpoint: ticket transitions RECEIVED → APPRAISED with valuation data
- [ ] Grace period cron: OVERDUE tickets auto-transition after 5 days
- [ ] In-person redemption: staff can process walk-in payment + generate receipt
- [ ] Notifications fire at each lifecycle milestone
- [ ] All new transitions create LegalProof records

---

## Phase 3: Contract & Receipt System (Days 6-8)

**Goal:** Contracts and receipts generate correctly

### Tasks
1. Verify ContractTemplate seed data exists or create default templates
2. Test contract generation via contract-renderer.service.ts
3. Test contract signing flow (customer + staff signatures)
4. Test receipt generation for each ReceiptType
5. Verify receipt numbering is sequential and unique
6. Test TOS acceptance flow
7. Create sample contract templates (Loan Contract, Bidder Agreement, TOS)
8. Verify LegalProof links to contracts and receipts

### Verification
- [ ] Loan contract generates with correct data
- [ ] Receipt generates for disbursement
- [ ] Receipt generates for redemption
- [ ] TOS acceptance recorded
- [ ] LegalProof links to contract and receipt

---

## Phase 4: Frontend Fixes & Integration (Days 8-10)

**Goal:** Frontend communicates with backend correctly

### Tasks
1. Fix frontend compilation warnings
2. Remove direct Supabase writes from frontend components
3. Route all writes through backend API
4. Test SalesPos → backend ticket creation flow
5. Test AppraisalApproval → contract signing flow
6. Test contract viewer displays generated contracts
7. Test receipt viewer displays generated receipts
8. Test loan history timeline shows lifecycle transitions

### Verification
- [ ] Frontend compiles without errors
- [ ] Ticket creation goes through backend
- [ ] Contract viewer works end-to-end
- [ ] Receipt viewer works end-to-end

---

## Phase 5: Security & Polish (Days 10-12)

**Goal:** Security hardening and demo-ready state

### Tasks
1. Verify RBAC guard on all critical endpoints
2. Remove auth code console logging in production
3. Fix silent catch blocks (at least log errors)
4. Remove localStorage role fallback
5. Add error handling to frontend components
6. Test all 10 role-based access paths
7. Verify no direct Supabase writes remain in frontend
8. Polish UI for demo (fix any visual bugs)

### Verification
- [ ] RBAC blocks unauthorized access
- [ ] No auth codes in console logs
- [ ] Errors are logged, not swallowed
- [ ] All roles can access their permitted features

---

## Phase 6: Demo Preparation (Days 12-14)

**Goal:** Smooth demo flow for thesis defense

### Tasks
1. Create demo script (step-by-step flow to show panel)
2. Seed test data (customers, items, staff accounts)
3. Test full demo flow end-to-end
4. Prepare backup screenshots in case of runtime issues
5. Document known limitations (for Q&A)
6. Final smoke test of all critical paths

### Verification
- [ ] Demo flow works 3 times in a row
- [ ] All features mentioned in thesis are demonstrable
- [ ] Known limitations documented
