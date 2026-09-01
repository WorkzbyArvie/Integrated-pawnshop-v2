import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useAuth } from '../context/AuthContext';
import { checkTosStatus } from '../services/auctionApi';
import '../App.css';

export default function Profile() {
  const { user, session, kycStatus, refreshKycStatus, signOut } = useAuth();
  const navigate = useNavigate();
  const [tosInfo, setTosInfo] = useState<{
    accepted: boolean;
    tosVersion: string | null;
    acceptedAt: string | null;
  } | null>(null);
  const [tosLoading, setTosLoading] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;
    refreshKycStatus();

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
    const { isConfirmed } = await Swal.fire({
      title: 'Sign Out?',
      text: 'You will be returned to the home page.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Sign Out',
      cancelButtonText: 'Cancel',
      background: '#1C1C26',
      color: '#F5F0E8',
    });
    if (!isConfirmed) return;
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

            <div style={{
              background: kycStatus === 'VERIFIED' ? 'rgba(74,222,128,0.06)' : kycStatus === 'PENDING' ? 'rgba(201,160,92,0.06)' : kycStatus === 'REJECTED' ? 'rgba(239,68,68,0.06)' : 'rgba(201,160,92,0.04)',
              border: `1px solid ${kycStatus === 'VERIFIED' ? 'rgba(74,222,128,0.2)' : kycStatus === 'PENDING' ? 'rgba(201,160,92,0.2)' : kycStatus === 'REJECTED' ? 'rgba(239,68,68,0.2)' : 'rgba(201,160,92,0.1)'}`,
              borderRadius: '16px',
              padding: '1.25rem',
              display: 'grid',
              gap: '0.75rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="status-muted" style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Identity Verification
                </p>
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
              </div>
              {kycStatus === 'VERIFIED' ? (
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#4ade80' }}>
                  You are verified. You can place bids on all auctions.
                </p>
              ) : kycStatus === 'PENDING' ? (
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#f1d27a' }}>
                  Your verification is under review. You'll be able to bid once approved.
                </p>
              ) : kycStatus === 'REJECTED' ? (
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#ff8a7c' }}>
                  Your verification was rejected. Please re-submit with valid documents.
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Verify your identity to place bids on auctions.
                </p>
              )}
              {kycStatus !== 'VERIFIED' && (
                <Link
                  to="/kyc"
                  className="primary-button"
                  style={{ textAlign: 'center', display: 'block', padding: '0.65rem', fontSize: '0.85rem' }}
                >
                  {kycStatus === 'REJECTED' ? 'Re-submit Verification' : kycStatus === 'PENDING' ? 'View Status' : 'Verify Identity'}
                </Link>
              )}
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
