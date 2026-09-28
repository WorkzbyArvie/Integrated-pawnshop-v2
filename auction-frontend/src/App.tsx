import { Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MfaChallenge } from './components/Auth/MfaChallenge';
import { ForcedPasswordChangeGate } from './components/Auth/ForcedPasswordChangeGate';
import Home from './pages/Home';
import ListingDetail from './pages/ListingDetail';
import KycVerification from './pages/KycVerification';
import Terms from './pages/Terms';
import MyBids from './pages/MyBids';
import MyWinnings from './pages/MyWinnings';
import Profile from './pages/Profile';
import LegalInfo from './pages/LegalInfo';

export const CREDENTIAL_PREFLIGHT_COPY = {
  checking: 'Checking account security',
  unavailable:
    "We couldn't confirm your account security status. Try again before continuing.",
  retry: 'Try again',
  signOut: 'Sign out',
} as const;

/**
 * Credential preflight order, in one place (D-05):
 *
 *   session loading → credential status unavailable (fail closed) → MFA
 *   challenge → forced password change → auction routes.
 *
 * Nothing from `<Routes>` is mounted until the server-owned credential state
 * clears, so a bidder shell, listing, bid, or profile can never render behind an
 * unresolved gate. MFA precedes the forced gate because proving the second
 * factor is what establishes the session in the first place.
 */
function CredentialPreflight({ children }: { children: React.ReactNode }) {
  const {
    loading,
    session,
    user,
    credentialState,
    credentialStatus,
    mfaRequired,
    markMfaVerified,
    refreshCredentialStatus,
    signOut,
  } = useAuth();

  if (loading) {
    return (
      <div
        role="status"
        className="flex min-h-[100dvh] items-center justify-center p-6 text-center"
        style={{ background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}
      >
        {CREDENTIAL_PREFLIGHT_COPY.checking}
      </div>
    );
  }

  // Unauthenticated visitors are not credential-gated.
  if (!session?.access_token) {
    return <>{children}</>;
  }

  const accessToken = session.access_token;
  const userId = user?.id ?? null;

  // Fail closed: an unconfirmable status must not reveal auction content.
  if (credentialState === 'unavailable') {
    return (
      <div
        role="alert"
        className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 p-6 text-center"
        style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
      >
        <p className="max-w-[420px] text-[16px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
          {CREDENTIAL_PREFLIGHT_COPY.unavailable}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void refreshCredentialStatus()}
            className="h-11 px-4 text-[14px] font-semibold"
            style={{ background: 'var(--gold)', color: '#0A0A0F', borderRadius: 'var(--radius)' }}
          >
            {CREDENTIAL_PREFLIGHT_COPY.retry}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-11 px-4 text-[14px] font-medium"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 'var(--radius)',
              color: 'var(--text-secondary)',
            }}
          >
            {CREDENTIAL_PREFLIGHT_COPY.signOut}
          </button>
        </div>
      </div>
    );
  }

  if (credentialState === 'loading') {
    return (
      <div
        role="status"
        className="flex min-h-[100dvh] items-center justify-center p-6 text-center"
        style={{ background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}
      >
        {CREDENTIAL_PREFLIGHT_COPY.checking}
      </div>
    );
  }

  if (mfaRequired && user?.email) {
    return (
      <MfaChallenge
        email={user.email}
        accessToken={accessToken}
        userId={userId}
        maskedEmail={credentialStatus?.mfaEmailMasked ?? null}
        onVerified={markMfaVerified}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (credentialStatus?.mustChangePassword) {
    return (
      <ForcedPasswordChangeGate
        accessToken={accessToken}
        userId={userId}
        onChanged={refreshCredentialStatus}
        onSignOut={() => void signOut()}
      />
    );
  }

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <CredentialPreflight>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/listing/:id" element={<ListingDetail />} />
          <Route path="/kyc" element={<KycVerification />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<LegalInfo />} />
          <Route path="/cookies" element={<LegalInfo />} />
          <Route path="/refunds" element={<LegalInfo />} />
          <Route path="/my-bids" element={<MyBids />} />
          <Route path="/my-winnings" element={<MyWinnings />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </CredentialPreflight>
    </AuthProvider>
  );
}

export default App;
