import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { checkTosStatus } from '../services/auctionApi';
import '../App.css';

export default function Profile() {
  const { user, session, kycStatus, signOut } = useAuth();
  const navigate = useNavigate();
  const [tosInfo, setTosInfo] = useState<{
    accepted: boolean;
    tosVersion: string | null;
    acceptedAt: string | null;
  } | null>(null);
  const [tosLoading, setTosLoading] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;

    let mounted = true;
    setTosLoading(true);
    checkTosStatus(session.access_token)
      .then((info) => {
        if (mounted) setTosInfo(info);
      })
      .catch(() => {
        if (mounted) setTosInfo(null);
      })
      .finally(() => {
        if (mounted) setTosLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (!user) {
    return (
      <div className="page">
        <p className="status-muted" style={{ textAlign: 'center', marginTop: '4rem' }}>
          Please sign in to view your profile.
        </p>
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link to="/" className="primary-button" style={{ display: 'inline-block' }}>
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  const kycBadge = () => {
    switch (kycStatus) {
      case 'VERIFIED':
        return { label: 'Verified', color: 'var(--gold)' };
      case 'PENDING':
        return { label: 'Under Review', color: 'rgba(201, 160, 92, 0.8)' };
      case 'REJECTED':
        return { label: 'Rejected', color: 'var(--red)' };
      default:
        return { label: 'Not Submitted', color: 'var(--text-muted)' };
    }
  };

  const badge = kycBadge();

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <Link to="/" className="ghost-button">
          &larr; Back to Auctions
        </Link>
      </div>

      <div className="hero-content" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <span className="hero-eyebrow">Account</span>
        <h1 className="hero-title" style={{ marginBottom: '1.5rem' }}>
          My <strong>Profile</strong>
        </h1>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.5rem',
              display: 'grid',
              gap: '1rem',
            }}
          >
            <div>
              <p className="status-muted" style={{ margin: '0 0 0.25rem', fontSize: '0.8rem' }}>
                Email
              </p>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>{user.email}</p>
            </div>

            <div>
              <p className="status-muted" style={{ margin: '0 0 0.25rem', fontSize: '0.8rem' }}>
                Name
              </p>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>
                {user.user_metadata?.fullName || 'Not provided'}
              </p>
            </div>

            <div>
              <p className="status-muted" style={{ margin: '0 0 0.25rem', fontSize: '0.8rem' }}>
                ID Verification (KYC)
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 'var(--radius)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: `${badge.color}15`,
                    color: badge.color,
                  }}
                >
                  {badge.label}
                </span>
                {kycStatus !== 'VERIFIED' && (
                  <Link to="/kyc" className="ghost-button" style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}>
                    {kycStatus === 'REJECTED' ? 'Re-submit' : 'Complete'}
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.5rem',
              display: 'grid',
              gap: '1rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Agreements</h3>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Auction Bidder Agreement</p>
                {tosLoading ? (
                  <p className="status-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.75rem' }}>
                    Checking status...
                  </p>
                ) : tosInfo?.accepted ? (
                  <p className="status-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.75rem' }}>
                    Accepted v{tosInfo.tosVersion} &middot;{' '}
                    {new Date(tosInfo.acceptedAt!).toLocaleDateString('en-PH')}
                  </p>
                ) : (
                  <p className="status-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.75rem' }}>
                    Not yet accepted
                  </p>
                )}
              </div>
              <Link
                to="/terms"
                className="ghost-button"
                style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
              >
                {tosInfo?.accepted ? 'View' : 'Review & Sign'}
              </Link>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.5rem',
              display: 'grid',
              gap: '1rem',
            }}
          >
            <Link
              to="/my-bids"
              className="ghost-button"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                fontSize: '0.9rem',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span>View My Bids</span>
              <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
            </Link>

            <Link
              to="/my-winnings"
              className="ghost-button"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                fontSize: '0.9rem',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span>View My Winnings</span>
              <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
            </Link>

            <button
              className="ghost-button"
              onClick={handleSignOut}
              style={{
                width: '100%',
                padding: '0.75rem',
                textAlign: 'center',
                color: 'var(--red)',
                border: '1px solid rgba(212, 69, 69, 0.2)',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
