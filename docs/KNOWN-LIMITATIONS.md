# Known Limitations — PawnGold System

**Purpose:** Prepare for panel Q&A during thesis B defense

---

## 1. Mobile App Integration

**Limitation:** The Flutter mobile app is not yet integrated with the new backend endpoints.

**Impact:** Mobile app still uses direct Supabase queries for some operations.

**Mitigation:** The web dashboard is fully integrated. Mobile parity is a post-thesis enhancement.

**Q&A Response:** *"The mobile app was built as a companion interface. For the thesis scope, we focused on the web dashboard's backend integration. Mobile parity is planned for the production deployment phase."*

---

## 2. Auction Frontend Isolation

**Limitation:** The auction frontend (auction-frontend/) is a separate React app, not integrated into the main dashboard.

**Impact:** Auction bidding happens on a separate URL. Settlement still flows through the main backend.

**Mitigation:** The auction frontend connects to the same backend API. All auction data is in the same database.

**Q&A Response:** *"The auction frontend is intentionally separate — it's the public-facing bidding website that external users access. The pawnshop staff manage auctions through the main dashboard. This is a common SaaS pattern for multi-tenant systems."*

---

## 3. Real-Time Notifications

**Limitation:** Some notifications (overdue reminders, grace period alerts) are cron-based, not real-time push.

**Impact:** Notifications appear on next page load, not instantly.

**Mitigation:** The NotificationModule stores all notifications in the database. The frontend polls for new notifications.

**Q&A Response:** *"We use a hybrid approach — critical lifecycle events (overdue, grace period) are handled by scheduled cron jobs. Real-time push notifications can be added using Supabase Realtime or WebSockets in the production phase."*

---

## 4. PDF Contract Generation

**Limitation:** Contract PDFs are generated server-side using a basic HTML-to-PDF library.

**Impact:** PDF formatting may not match professional legal document standards.

**Mitigation:** The HTML contract templates are legally compliant. PDF generation is a rendering convenience.

**Q&A Response:** *"The contract content follows standard Philippine pawnshop agreement formats. The PDF rendering is a technical implementation detail — the legal content is what matters for compliance. In production, we would use a professional PDF generation service."*

---

## 5. Payment Gateway Sandbox

**Limitation:** PayMongo and Xendit integrations are in sandbox/test mode.

**Impact:** No real money is processed. Test cards are used for demonstrations.

**Mitigation:** The integration architecture is production-ready. Only the API keys need to be swapped.

**Q&A Response:** *"We're using sandbox mode for development and testing. The payment gateway integration is architecturally complete — webhook handling, receipt generation, and error handling are all implemented. Production deployment only requires switching to live API keys."*

---

## 6. Grace Period Cron Timing

**Limitation:** The grace period auto-entry cron runs every hour, not instantly.

**Impact:** A ticket might stay in OVERDUE status for up to 1 hour before entering GRACE_PERIOD.

**Mitigation:** The cron interval is configurable. For production, it can be reduced to 5 minutes.

**Q&A Response:** *"The cron interval is a deployment configuration. We set it to 1 hour for development to avoid excessive database queries. In production, this can be adjusted to any interval based on business requirements."*

---

## 7. Multi-Tenant Data Isolation

**Limitation:** Branch-level data isolation uses application-level filtering, not database-level RLS.

**Impact:** A bug in the application code could potentially expose data across branches.

**Mitigation:** All API endpoints filter by `pawnshopId` from the authenticated user's session. The RbacGuard enforces role-based access.

**Q&A Response:** *"We use a defense-in-depth approach — application-level filtering combined with role-based access control. For a thesis project, this provides adequate isolation. Production deployments would add Supabase RLS policies for defense-in-depth."*

---

## 8. Image Storage

**Limitation:** Item images are stored in Supabase Storage, not a dedicated CDN.

**Impact:** Image loading may be slower for production traffic.

**Mitigation:** Supabase Storage includes CDN capabilities. Images are accessible via public URLs.

**Q&A Response:** *"Supabase Storage provides built-in CDN functionality. For a thesis project with limited traffic, this is adequate. Production deployments would use a dedicated CDN like CloudFront for optimal performance."*

---

## 9. Audit Log Retention

**Limitation:** Audit logs are stored indefinitely with no retention policy.

**Impact:** Database size grows over time.

**Mitigation:** Audit logs are append-only and indexed. A retention policy can be added post-thesis.

**Q&A Response:** *"For a thesis project, we prioritize data completeness over storage optimization. A production system would implement a retention policy — typically 7 years for financial records in the Philippines."*

---

## 10. Rate Limiting Configuration

**Limitation:** Rate limiting uses in-memory stores, not distributed Redis.

**Impact:** Rate limits reset on server restart. Not effective across multiple backend instances.

**Mitigation:** For single-instance deployment (current), in-memory rate limiting is sufficient.

**Q&A Response:** *"The current architecture uses a single backend instance, so in-memory rate limiting is effective. For horizontal scaling, we would migrate to Redis-based rate limiting, which is a standard production enhancement."*

---

## Summary

| Category | Status | Notes |
|----------|--------|-------|
| Core Pawn Ticket Flow | ✅ Complete | Full lifecycle with receipts + proofs |
| Contract Generation | ✅ Complete | Legally compliant templates |
| Receipt System | ✅ Complete | All transaction types covered |
| Audit Trail | ✅ Complete | Every action logged |
| RBAC | ✅ Complete | 10 roles enforced |
| Payment Gateway | ✅ Sandbox | Production-ready architecture |
| Mobile App | ⚠️ Partial | Web dashboard is primary |
| Auction Frontend | ✅ Separate app | Intentional architecture |
