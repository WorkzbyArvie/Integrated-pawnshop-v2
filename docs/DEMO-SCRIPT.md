# PawnGold Demo Script — Thesis B Defense

**Duration:** 15-20 minutes  
**Goal:** Demonstrate all panel red marks are fixed

---

## Pre-Demo Checklist

- [ ] Backend running (`npm run start:dev` in backend/)
- [ ] Frontend running (`npm run dev` in frontend/)
- [ ] Database connected (Supabase)
- [ ] Test accounts ready (see below)
- [ ] Browser with 2 windows (Owner + Super Admin)
- [ ] Backup screenshots ready

---

## Test Accounts

| Role | Email | Password | Purpose |
|------|-------|----------|---------|
| Super Admin | (use existing) | — | Approve owners, manage platform |
| Owner | demo-owner@pawngold.test | (create during demo) | Full demo flow |
| Staff | (create via Owner dashboard) | — | Process transactions |

---

## Demo Flow

### Act 1: Onboarding & Access Control (3 min)

**Step 1: Landing Page**
- Open `http://localhost:5173`
- Show professional landing page with PawnGold branding
- Narrate: *"This is the PawnGold landing page for our integrated pawnshop management system in Dasmarinas, Cavite."*

**Step 2: Owner Signup**
- Click "Sign Up" → fill form (name, email, password)
- Submit → redirected to email verification page
- Narrate: *"New owners must sign up and verify their email before gaining access."*

**Step 3: Email Verification**
- Show the professional email template in Supabase dashboard (or show screenshot)
- Narrate: *"Email templates are branded with PawnGold styling for a professional experience."*

**Step 4: Pending Access**
- After email verification, owner sees "Pending Access" dashboard
- Show the trial request form
- Narrate: *"After verification, owners don't get immediate access. They must request a trial, which requires Super Admin approval. This ensures only legitimate pawnshop operators can use the system."*

**Step 5: Super Admin Approval**
- Switch to Super Admin window
- Show the Support Hub with incoming trial request
- Approve the request
- Narrate: *"The Super Admin reviews and approves trial requests. This is our access control mechanism."*

**Step 6: Dashboard Unlocked**
- Switch back to Owner window
- Refresh → full dashboard appears
- Narrate: *"Once approved, the owner gains access to the full dashboard."*

---

### Act 2: Pawn Ticket Lifecycle (7 min)

**Step 7: Create Pawn Ticket (RECEIVED)**
- Navigate to "New Appraisal" (SalesPos)
- Fill customer info + item details (gold ring, 10g, etc.)
- Submit → ticket created with RECEIVED status
- Narrate: *"The pawn ticket flow starts with item intake. The system creates a ticket with RECEIVED status and generates a LegalProof record for traceability."*

**Step 8: Appraise Item (APPRAISED)**
- Navigate to "Appraisal Approval"
- Select the ticket → enter valuation (appraised value, risk score, recommended loan)
- Approve appraisal → status changes to APPRAISED
- Show the generated Appraisal Certificate receipt
- Narrate: *"The appraiser evaluates the item and assigns a value. An appraisal certificate receipt is automatically generated."*

**Step 9: Approve & Generate Contract (OFFER_MADE)**
- Owner/Manager approves the ticket
- System generates a loan contract PDF
- Show the Contract Viewer with the generated contract
- Narrate: *"Upon approval, the system generates a legally compliant loan contract. The customer can review and sign digitally."*

**Step 10: Disburse Loan (ACTIVE)**
- Staff disburses the loan amount
- Show the disbursement receipt
- Status changes to ACTIVE
- Narrate: *"Once the contract is signed, the loan is disbursed. A receipt is generated and a LegalProof record is created."*

---

### Act 3: Redemption & Receipts (3 min)

**Step 11: Process Redemption**
- Navigate to "Redemption"
- Select the active ticket
- Process payment (full loan + interest)
- Show the redemption receipt
- Status changes to REDEEMED
- Narrate: *"When the customer returns to redeem their item, staff processes the payment. A redemption receipt is generated and the ticket is closed."*

**Step 12: Show Receipt History**
- Navigate to "Loan History"
- Show the full timeline: RECEIVED → APPRAISED → OFFER_MADE → ACTIVE → REDEEMED
- Show all receipts and proofs at each stage
- Narrate: *"Every transaction generates a receipt and legal proof. The complete audit trail is visible in the loan history."*

---

### Act 4: Forfeiture & Auction (3 min)

**Step 13: Grace Period Entry**
- Show a ticket that has entered grace period (or explain the cron)
- Narrate: *"If a customer doesn't redeem within the loan period, the system automatically enters a 5-day grace period."*

**Step 14: Forfeiture**
- Show a forfeited ticket
- Show the forfeiture receipt and proof
- Narrate: *"After the grace period, the ticket is forfeited. A forfeiture receipt is generated and the item moves to the auction queue."*

**Step 15: Auction**
- Navigate to "Auction Queue"
- Show the item listed for auction
- Navigate to "Live Auctions" (auction frontend)
- Show bidding interface
- Narrate: *"Forfeited items are listed for auction. Bidders can place bids through the auction website."*

---

### Act 5: Security & Compliance (2 min)

**Step 16: RBAC Demonstration**
- Try to access a restricted endpoint as a lower-privilege role
- Show the "Forbidden" response
- Narrate: *"All endpoints are protected by Role-Based Access Control. Staff cannot access owner-only features."*

**Step 17: Audit Trail**
- Navigate to "Audit History"
- Show the complete log of all actions
- Narrate: *"Every action in the system is logged with who did it, when, and what changed. This satisfies the panel's concern about traceability."*

---

### Act 6: Wrap-up (2 min)

**Step 18: Summary**
- Show the system flow chart (from docs/)
- Narrate: *"To summarize, we've addressed all panel concerns:*
  - *Legality — Contracts generated for every loan*
  - *Proof & Audit Trail — LegalProof records at every transaction*
  - *Receipts — Automated receipt generation*
  - *Payment History — Full transaction timeline*
  - *Terms & Conditions — TOS acceptance flow*
  - *State Machine — Proper lifecycle with RBAC*
  - *Security — RBAC, rate limiting, input validation"*

---

## Backup Plans

| If this fails... | Do this instead... |
|------------------|-------------------|
| Email verification doesn't work | Use Supabase Dashboard to manually verify the user |
| Contract PDF doesn't generate | Show the contract data in the Contract Viewer (HTML view) |
| Receipt doesn't print | Show the receipt data in the Receipt Viewer |
| Auction frontend doesn't load | Show screenshots of the auction interface |
| Backend times out | Restart backend and retry |

---

## Panel Q&A Preparation

**Q: What stops anyone from signing up?**
A: Super Admin manually approves every trial request. Only approved owners gain access.

**Q: How do you ensure data integrity?**
A: Every transaction creates a LegalProof record with immutable metadata. Receipts are sequentially numbered. Audit logs track all changes.

**Q: What happens if the system goes down?**
A: Supabase handles database backups. Backend on Railway has auto-restart. All state is persisted in PostgreSQL.

**Q: How does the state machine work?**
A: Pawn tickets follow: RECEIVED → APPRAISED → OFFER_MADE → CONTRACT_SIGNED → ACTIVE → REDEEMED/FORFEITED. Each transition requires specific role permissions and creates proof records.

**Q: Is this scalable?**
A: Yes. The system uses a multi-tenant architecture with branch isolation. Each pawnshop has its own data scope enforced at the database level.
