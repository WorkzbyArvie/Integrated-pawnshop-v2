import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchMyBids, type MyBidItem } from '../services/auctionApi';
import '../App.css';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value || 0);

function getStatusLabel(status: string): { label: string; color: string } {
  switch (status.toUpperCase()) {
    case 'LIVE':
      return { label: 'Live', color: 'var(--gold)' };
    case 'ENDED':
    case 'SOLD':
      return { label: 'Ended', color: 'var(--text-muted)' };
    case 'CANCELLED':
      return { label: 'Cancelled', color: 'var(--red)' };
    default:
      return { label: status, color: 'var(--text-muted)' };
  }
}

export default function MyBids() {
  const { user, session } = useAuth();
  const [bids, setBids] = useState<MyBidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchMyBids(session.access_token)
      .then((data) => {
        if (!mounted) return;
        setBids(data);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load your bids');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  if (!user) {
    return (
      <div className="page">
        <p className="status-muted" style={{ textAlign: 'center', marginTop: '4rem' }}>
          Please sign in to view your bid history.
        </p>
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link to="/" className="primary-button" style={{ display: 'inline-block' }}>
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <Link to="/" className="ghost-button">
          &larr; Back to Auctions
        </Link>
        <Link to="/profile" className="ghost-button" style={{ padding: '0.4rem 0.9rem', fontSize: '0.75rem' }}>
          Profile
        </Link>
      </div>

      <div className="hero-content" style={{ maxWidth: '900px', margin: '0 auto' }}>
        <span className="hero-eyebrow">Bidding Activity</span>
        <h1 className="hero-title" style={{ marginBottom: '0.5rem' }}>
          My <strong>Bids</strong>
        </h1>
        <p className="status-muted" style={{ marginBottom: '2rem' }}>
          {bids.length > 0
            ? `${bids.length} item${bids.length === 1 ? '' : 's'} you've bid on`
            : 'You have not placed any bids yet.'}
        </p>

        {loading ? (
          <p className="status-muted">Loading your bids...</p>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <p className="status-error">{error}</p>
          </div>
        ) : bids.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <p className="status-muted" style={{ marginBottom: '1rem' }}>
              You haven't placed any bids yet. Start exploring live auctions!
            </p>
            <Link to="/" className="primary-button" style={{ display: 'inline-block' }}>
              Browse Auctions
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {bids.map((item) => {
              const status = getStatusLabel(item.listingStatus);
              const isWinning = item.listingStatus.toUpperCase() === 'LIVE' && item.myMaxBid >= item.currentBid;
              const wasOutbid = item.listingStatus.toUpperCase() === 'LIVE' && item.myMaxBid < item.currentBid;

              return (
                <Link
                  key={item.listingId}
                  to={`/listing/${item.listingId}`}
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius)',
                    padding: '1rem',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'border-color 0.2s',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: 'var(--radius)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.listingTitle}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.2rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        ?
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <strong style={{ fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.listingTitle}
                      </strong>
                      <span
                        className="badge"
                        style={{
                          background: `${status.color}15`,
                          color: status.color,
                          fontSize: '0.65rem',
                          padding: '0.15rem 0.5rem',
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="status-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      {item.pawnshopName}
                    </p>
                    <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.3rem', fontSize: '0.85rem' }}>
                      <div>
                        <span className="status-muted">Your max: </span>
                        <strong>{formatCurrency(item.myMaxBid)}</strong>
                      </div>
                      <div>
                        <span className="status-muted">Current: </span>
                        <strong>{formatCurrency(item.currentBid)}</strong>
                      </div>
                      {isWinning && (
                        <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Winning</span>
                      )}
                      {wasOutbid && (
                        <span style={{ color: 'var(--red)', fontWeight: 600 }}>Outbid</span>
                      )}
                      <div className="status-muted" style={{ fontSize: '0.75rem' }}>
                        {item.myBidCount} bid{item.myBidCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
