# REQUIREMENTS.md — PawnGold Thesis B Requirements

## R1: Backend Compilation & Startup (CRITICAL)
- Backend must compile with zero TypeScript errors
- Backend must start and connect to Supabase database
- All Prisma models must be accessible via generated client
- **Status:** Partially resolved — `prisma generate` fixed compilation, runtime startup unverified

## R2: Pawn Ticket Lifecycle — End-to-End (CRITICAL)
- Complete state machine: RECEIVED → APPRAISED → PENDING_APPROVAL → OFFER_MADE → CONTRACT_SIGNED → DISBURSED → ACTIVE → REDEEMED/FORFEITED/AUCTION_QUEUED
- Each transition must create a LegalProof record
- State transitions must be enforced (no illegal jumps)
- RBAC must gate which roles can trigger which transitions
- **Status:** Code exists in pawn-ticket.service.ts, loan.service.ts, loan-forfeiture.service.ts — needs runtime verification

## R3: Contract Generation (CRITICAL)
- Auto-generate loan contracts when ticket reaches CONTRACT_SIGNED
- Contract templates stored in ContractTemplate model
- Contracts must include: parties, terms, interest rates, penalties, signatures
- Contract renderer must work (contract-renderer.service.ts)
- Philippine pawnshop standard format
- **Status:** ContractTemplate, ContractClause models exist; renderer service exists but had compilation errors (now fixed)

## R4: Receipt Generation (CRITICAL)
- Generate receipts for: loan disbursement, repayment, redemption, penalty, auction sale
- Receipts stored in Receipt model with unique receipt numbers
- Receipts must reference the transaction (referenceType + referenceId)
- Printable format
- **Status:** Receipt model and receipt.service.ts exist — needs runtime verification

## R5: LegalProof Audit Trail (CRITICAL)
- Every significant transaction must create a LegalProof record
- ProofRecordType enum covers: APPLICATION_SUBMITTED, CONTRACT_PROOF, PAYMENT_PROOF, REPAYMENT_PROOF, PENALTY_PROOF, RECEIPT_PROOF, REDEMPTION_PROOF, DISBURSEMENT_PROOF, etc.
- Each proof must have: proofNumber, sourceHash, payload, links to source records
- **Status:** LegalProof model exists with all relations; services exist but had compilation errors

## R6: TOS Acceptance Flow (HIGH)
- Auction bidders must accept Terms of Service before bidding
- Loan applicants must accept TOS before application
- TOSAcceptance records stored with timestamp, IP, user agent
- **Status:** TOSAcceptance model and tos.service.ts exist — needs runtime verification

## R7: Security Hardening (HIGH)
- RBAC guard enforced on all endpoints
- Rate limiting on all endpoints (no bypass for auth routes)
- No direct Supabase writes from frontend (all through backend)
- Auth codes not logged to console in production
- No localStorage-based role authorization
- **Status:** RBAC guard and rate limiter exist; frontend still has direct Supabase calls

## R8: Frontend Compilation & No Critical Warnings (MEDIUM)
- Frontend must compile without errors
- Warnings should be addressed but not blocking
- **Status:** Frontend runs with warnings — needs audit

## R9: System Flow Completeness (MEDIUM)
- Auto-forfeiture cron must work
- Renewal flow must work
- Auction handoff from forfeiture must work
- **Status:** Services exist but may have runtime issues

## R10: Data Integrity (MEDIUM)
- Financial calculations must be accurate (consider Float → Decimal migration for critical paths)
- No silent error swallowing (empty catch blocks)
- Proper error handling throughout
