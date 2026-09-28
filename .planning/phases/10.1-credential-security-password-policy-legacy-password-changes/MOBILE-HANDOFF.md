# Mobile Handoff — Flutter Credential Surfaces (Phase 10.1, plans 10.1-07 and 10.1-16)

**Audience:** the developer taking the `mobile/` app.
**Status:** NOT started. No Flutter code has been written for this phase.
**Why this document exists:** the dashboard and auction client have completed
their credential-security work. The mobile app has not, so **a bidder can still
create an account and set a weak password on mobile right now.** This is the last
open hole in the phase.

Read this before starting. The two other clients are finished and are your
reference implementation — mirror their contract exactly.

---

## 1. What you are implementing

Two plans already exist and are written to the level of detail you need. Follow
them rather than inventing a design.

| Plan | File | Scope |
|------|------|-------|
| 10.1-07 | `.planning/phases/10.1-credential-security-password-policy-legacy-password-changes/10.1-07-PLAN.md` | Data / storage / BLoC foundation. No UI. |
| 10.1-16 | `.planning/phases/10.1-credential-security-password-policy-legacy-password-changes/10.1-16-PLAN.md` | Credential surfaces, forced-change gate, tests. |

Also read these, they are binding:

- `10.1-UI-SPEC.md` — the mobile rows are prefixed `M`. Specifically
  `SEC-01 / SEC-02 - M bidder signup`, `SEC-01 / SEC-02 - M account password change`,
  `SEC-01 / SEC-02 - M recovery`, `SEC-03 - M forced gate`, `SEC-04 - M Account Security`,
  `SEC-05 - M MFA enrollment / disablement / login challenge`.
- `10.1-RESEARCH.md` — decisions D-01 through D-14. D-14 is email-only MFA; do
  not add a second factor method.
- `10.1-VALIDATION.md` — the exact `flutter test` command your plan must pass.

## 2. Requirements you are satisfying

| Requirement | Statement |
|-------------|-----------|
| **SEC-01** | One server-owned password policy on every account-creation and password-change surface: 10–128 characters, one uppercase, one lowercase, one number, one symbol, no leading/trailing whitespace, no common password. |
| **SEC-02** | Accessible per-rule requirements, confirmation + visibility controls, paste and password-manager support, inline and summary error feedback. |
| **SEC-03** | A legacy account gets a blocking, tenant-scoped forced-change gate before any operational screen. |
| **SEC-04** | A universal Account Security screen: change password, review password/MFA state, inspect recent security activity. |
| **SEC-05** | Optional email-code MFA with a server-side hashed, expiring, rate-limited challenge, enforced by the backend on later logins. |
| **SEC-06** | No plaintext password or OTP code in any response, log, or persisted value. |

## 3. The backend contract is already done. Do not change it.

Every endpoint you need already exists, is rate-limited, audited, and tenant-safe.
The mobile app is a **client only**.

| Method | Endpoint | Purpose | Throttle |
|--------|----------|---------|----------|
| `GET` | `/security/credential-status` | `mustChangePassword`, `mfaEnabled`, `mfaEmailMasked`, `passwordUpdatedAt`, `reason`, `markedAt` | — |
| `POST` | `/security/change-password` | `{ currentPassword, newPassword, confirmPassword }` | 5/min |
| `POST` | `/security/recovery/complete` | `{ newPassword, confirmPassword }` | 5/min |
| `GET` | `/security/activity` | recent own-account credential events | — |
| `POST` | `/security/mfa/enable-challenge` | `{ currentPassword }` → `challengeId` | 3/min |
| `POST` | `/security/mfa/login-challenge` | `{ email }`, **public** | 5/min |
| `POST` | `/security/mfa/verify` | `{ challengeId, code }` → `assertion` | 10/min |
| `POST` | `/security/mfa/disable` | `{ currentPassword, challengeId, code }` | 5/min |

Source of truth: `backend/src/security/security.controller.ts`,
`backend/src/profile/`, and the DTOs in `backend/src/security/dto/`.

Responses are enveloped as `{ success, data }` — unwrap `data`.

### Header you must send

`x-mfa-assertion` — the session-bound MFA assertion. Source of truth:
`MFA_ASSERTION_HEADER` in `backend/src/security/mfa-assertion.service.ts`.

The backend requires it on protected routes. A mobile build that omits it will
pass every unit test and then fail in production, so make the assertion travel
with every authenticated request from a single helper, exactly as the other two
clients do.

## 4. Reference implementations to mirror

Read these before writing Dart. They are the approved shape of the contract.

| Concern | File |
|---------|------|
| Policy rules + checklist presentation | `frontend/src/components/Auth/PasswordRequirements.tsx`, `frontend/src/components/Auth/PasswordField.tsx` |
| Client policy mirror (guidance only) | `auction-frontend/src/lib/passwordPolicy.ts` |
| Header builder + in-memory assertion lifecycle | `auction-frontend/src/lib/authHeaders.ts` |
| Credential status + MFA + password API | `auction-frontend/src/lib/credentialApi.ts` |
| Non-dismissible login challenge | `auction-frontend/src/components/Auth/MfaChallenge.tsx` |
| Blocking forced-change gate | `auction-frontend/src/components/Auth/ForcedPasswordChangeGate.tsx` |
| Account Security screen | `auction-frontend/src/components/AccountSecuritySection.tsx` |
| Dashboard equivalents | `frontend/src/lib/accountSecurity.ts`, `frontend/src/pages/AccountSecurityPage.tsx` |

`backend/src/security/password-policy.service.ts` is the only accepting
authority. The client mirror is **guidance only** and must never decide that a
password is acceptable — the server still rejects a non-compliant value.

### Known defect to replicate deliberately

The server's `normalizePasswordVariant` substitutes `1→i`, `3→e`, `4→a`, `5→s`,
`6→g`, `7→t`, `8→b` **before** the common-password set lookup. That makes the
numeric entries in its common-password list (`123456`, `12345678`, …) unreachable,
because they normalize to letter sequences that are not in the list. If you
mirror the server faithfully, your Dart version will have the same blind spot.

**Do not "fix" this on the client.** Mirror the server, and raise it separately.
`auction-frontend/src/lib/passwordPolicy.test.ts` pins the behavior with a test
named *"mirrors the server quirk where digit entries are unreachable after
substitution"* — copy that approach so the quirk stays visible.

A genuine server-side fix would need a decision in `10.1-RESEARCH.md` and a
coordinated change to the backend; it is out of scope for this handoff.

## 5. Non-negotiable behaviors

These are the parts a panel will actually check. Do not approximate them.

1. **The gate is blocking, not a warning.** No `HomeScreen` widget may be built
   while `mustChangePassword` is true, MFA is unverified, or credential status
   cannot be confirmed. Android back and iOS swipe must not bypass it. Prove it
   with a test that asserts `HomeScreen` is never constructed, not merely that a
   banner is visible.
2. **Fail closed.** If credential status cannot be read, deny access. Never
   default an unknown state to "clear".
3. **Secrets are memory-only.** Never write a password, a 6-digit code, a
   challenge id, or an assertion to `shared_preferences`, `flutter_secure_storage`
   logs, a URL, or an analytics event. The clients assert this with a
   comment-stripped source scan — the Dart equivalent is fine.
4. **Clear at the session boundary.** Sign-out and any new sign-in drop the
   held assertion and the "MFA verified" flag. An assertion must never cross
   accounts.
5. **MFA enable and disable each need two factors**: the current password *and*
   an emailed code. Neither may be completable from a single input.
6. **No false success.** A cancelled or failed disable must leave `Enabled`
   visible. A rejected code must not clear the status.
7. **Copy is exact.** The UI-SPEC strings are the contract, including
   `Password requirements`, `All password requirements met`,
   `Passwords do not match`, `Show password` / `Hide password`,
   `Update your password to continue`, `Action required: password change`,
   `Verify your sign-in`. Do not paraphrase.
8. **Semantics, not just icons.** Each policy rule must expose met / not-met
   **text** via `Semantics`, not a colored icon alone. A screen reader user must
   be able to learn which rules are unmet.
9. **No new visual language.** `AppTheme` dark surfaces and the gold CTA only. No
   new font, no new component family, no web-only primitive.

## 6. Verification you must pass

The focused suite below is the one named in `10.1-VALIDATION.md`. **None of these
four test files exist yet** — `10.1-07` creates them as part of your work, so treat
this command as a target to make pass, not a command to run first.

```powershell
cd mobile
flutter test test/core/extensions/password_policy_test.dart `
  test/features/auth/data/datasources/auth_remote_datasource_test.dart `
  test/features/auth/data/repositories/auth_repository_test.dart `
  test/features/auth/presentation/bloc/auth_bloc_test.dart
```

Existing today: `mobile/test/widget_test.dart` and
`mobile/test/auth_repository_test.dart`. The existing auth test sits at the test
root, not under `test/features/auth/...` — follow the layered layout in
`mobile/lib/features/auth/` for anything new, and decide deliberately whether the
root-level `auth_repository_test.dart` should move or be left alone.

Existing implementation to extend, not replace:

```
mobile/lib/core/extensions/extensions.dart
mobile/lib/features/auth/data/datasources/auth_remote_datasource.dart
mobile/lib/features/auth/data/models/user_model.dart
mobile/lib/features/auth/data/repositories/auth_repository.dart
mobile/lib/features/auth/domain/usecases/auth_usecase.dart
mobile/lib/features/auth/presentation/bloc/{auth_bloc,auth_event,auth_state}.dart
mobile/lib/features/auth/presentation/pages/{login_page,signup_page,kyc_verification_page}.dart
mobile/lib/main.dart
```

Plus the surface tests required by 10.1-16, and the `flutter analyze` gate.

## 7. Definition of done

- [ ] `signup_page.dart` shows the live six-rule checklist and rejects a
      non-compliant value locally while the server remains authoritative.
- [ ] `HomeScreen` cannot be reached by a forced, MFA-pending, or
      status-unavailable session.
- [ ] Account Security is reachable from the account screen for every role.
- [ ] Password change, recovery, MFA enroll, MFA disable, and the login challenge
      all work against the live endpoints.
- [ ] No secret is persisted or logged.
- [ ] Focused `flutter test` suite and `flutter analyze` are clean.
- [ ] `10.1-07-SUMMARY.md` and `10.1-16-SUMMARY.md` written.
- [ ] `SEC-01` through `SEC-06` can be marked complete for the mobile surface.

## 8. Known unrelated failures — do not chase these

`flutter analyze` may surface pre-existing findings outside the credential file
set. Record them and move on; do not expand scope. See
`.planning/phases/10.1-credential-security-password-policy-legacy-password-changes/deferred-items.md`
for the established pattern of logging out-of-scope findings instead of fixing
them.
