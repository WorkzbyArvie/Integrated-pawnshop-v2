# RISK-ASSESSMENT.md

**Project:** PawnGold — Integrated Pawnshop Management System (Academic Thesis / Capstone)
**Scope:** Legal, privacy, security, financial, operational, and reputational risks of the platform.
**Last updated:** September 10, 2026

Severity = Likelihood × Impact. Ratings: **High / Medium / Low**.

## 1. Legal Risks

| Risk | Likelihood | Impact | Severity | Mitigation | Status |
|------|-----------|--------|----------|-----------|--------|
| False marketing claims (fake testimonials, fabricated stats, fake certifications) | Med | High | **High** | Removed fake testimonials and fabricated stats from landing pages; added dynamic verified-owner reviews (`GET /reviews`); removed ISO/SOC2/GDPR/USP claims; replaced pricing and trust copy with truthful wording | Mitigated |
| Missing or misleading terms for consumers | Med | High | **High** | Published Terms of Service, Privacy Policy, Cookie Policy, and Refund/Cancellation pages on both the dashboard and auction frontends | Mitigated |
| Unlawful contract enforcement | Low | High | Med | Contracts generated from checked-in templates; state machine guards transitions; panel-reviewed flow | Partially mitigated |
| Platform misrepresented as a licensed financial/pawnshop entity | Med | High | **High** | Explicit academic disclaimers in footers and legal pages on both frontends | Mitigated |

## 2. Privacy Risks (RA 10173)

| Risk | Likelihood | Impact | Severity | Mitigation | Status |
|------|-----------|--------|----------|-----------|--------|
| Collecting personal data without consent | Med | High | **High** | Consent checkboxes: owner signup, trial request, bidder signup, KYC; data-processing consent notice in KYC | Mitigated |
| Sharing of KYC / government IDs | Med | High | **High** | KYC uploads stored in tenant-scoped storage; moderator-only access; review content never leaks identifying details publicly | Mitigated |
| Tracking / cookie misuse | Low | Med | Low | No tracking cookies; localStorage only for auth tokens and UI prefs; Cookie Policy published | Mitigated |
| Data subject right requests not honored | Med | Med | Med | Rights documented in Privacy Policy; contact channel defined; **needs** export/account-deletion tooling | Open |
| Third-party processor liability (payment) | Low | Med | Low | Cards handled by PayMongo; card data never stored server-side | Mitigated |

## 3. Security Risks

| Risk | Likelihood | Impact | Severity | Mitigation | Status |
|------|-----------|--------|----------|-----------|--------|
| Unauthorized cross-tenant data access | Low | High | **High** | RLS on Supabase, pawnshop-scoped queries, RBAC guard on every endpoint, tenant guard | Mitigated |
| Privilege escalation / SUPER_ADMIN abuse | Low | High | **High** | SUPER_ADMIN restricted to governance prefixes; `review.moderate` isolated; audit-log interceptor records sensitive actions | Mitigated |
| Brute-force / abuse of auth endpoints | Med | Med | Med | Per-endpoint rate limiting (Throttle + RateLimitGuard) | Mitigated |
| Injection / malformed DTO input | Low | Med | Low | class-validator DTOs; Prisma parameterized queries | Mitigated |

## 4. Financial Risks

| Risk | Likelihood | Impact | Severity | Mitigation | Status |
|------|-----------|--------|----------|-----------|--------|
| Wrong interest/penalty calculations on loans | Med | High | **High** | Deterministic integer-cents finance math; state machine; receipts capture every financial event | Partially mitigated |
| Refund disputes in the auction marketplace | Med | Med | Med | Refund & Cancellation Policy; dispute channel defined | Mitigated |
| Fraudulent bidder identities | Med | Med | Med | Automated and moderated KYC review; manual approval of auction winners | Mitigated |

## 5. Operational & Reputational Risks

| Risk | Likelihood | Impact | Severity | Mitigation | Status |
|------|-----------|--------|----------|-----------|--------|
| No uptime guarantee expected of a thesis | High | Low | Low | Explicit "no SLA" disclaimers; replaced "99.9% uptime" claim | Mitigated |
| Sparse or zero public reviews look empty | Med | Low | Low | Honest empty state + moderation notice; owners can submit after signing up | Accepted |
| Drift of the permission catalog due to new endpoints | Med | Med | Med | `permissions-catalog.spec.ts` automation fails build on unregistered guarded endpoints | Mitigated |

## 6. Open Items

1. Data-export (portability) and account-deletion tooling for data subjects
2. DPIA documentation for the KYC data category
3. Hosting/data-residency documentation for Supabase and backup retention
4. A designated point of contact / DPO for data subject requests