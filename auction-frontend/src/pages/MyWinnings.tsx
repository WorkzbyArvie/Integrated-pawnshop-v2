import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchMyWinnings, createPaymentCheckout, simulatePaymentWebhook, type MyWinningItem } from '../services/auctionApi';
import '../App.css';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value || 0);

function getStatusLabel(status: string): { label: string; color: string } {
  switch (status.toUpperCase()) {
    case 'PENDING_COMPLIANCE':
      return { label: 'Awaiting Payment', color: 'var(--gold)' };
    case 'COMPLIED':
      return { label: 'Paid', color: '#4ade80' };
    case 'READY_FOR_RELEASE':
      return { label: 'For Release', color: '#60a5fa' };
    case 'RELEASED':
      return { label: 'Released', color: 'var(--text-muted)' };
    default:
      return { label: status, color: 'var(--text-muted)' };
  }
}

export default function MyWinnings() {
  const { user, session } = useAuth();
  const [winnings, setWinnings] = useState<MyWinningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const loadWinnings = () => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchMyWinnings(session.access_token)
      .then((data) => {
        if (!mounted) return;
        setWinnings(data);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load your winnings');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  };

  useEffect(() => {
    const cleanup = loadWinnings();
    return cleanup;
  }, [session?.access_token]);

  const handlePay = async (complianceId: string) => {
    if (!session?.access_token) return;
    setPayingId(complianceId);
    try {
      const result = await createPaymentCheckout(complianceId, session.access_token);
      window.open(result.checkoutUrl, '_blank');
    } catch (err: any) {
      setError(err.message || 'Payment failed');
    } finally {
      setPayingId(null);
    }
  };

  const handleSimulatePayment = async (complianceId: string) => {
    if (!session?.access_token) return;
    setPayingId(complianceId);
    try {
      await simulatePaymentWebhook(complianceId, session.access_token);
      loadWinnings();
    } catch (err: any) {
      setError(err.message || 'Simulation failed');
    } finally {
      setPayingId(null);
    }
  };

  if (!user) {
    return (
      <div className="page">
        <p className="status-muted" style={{ textAlign: 'center', marginTop: '4rem' }}>
          Please sign in to view your winnings.
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
        <span className="hero-eyebrow">Your Winnings</span>
        <h1 className="hero-title" style={{ marginBottom: '0.5rem' }}>
          My <strong>Winnings</strong>
        </h1>
        <p className="status-muted" style={{ marginBottom: '2rem' }}>
          {winnings.length > 0
            ? `${winnings.length} item${winnings.length === 1 ? '' : 's'} won`
            : 'No winnings yet.'}
        </p>

        {error && (
          <div style={{ textAlign: 'center', padding: '1rem', marginBottom: '1rem' }}>
            <p className="status-error">{error}</p>
          </div>
        )}

        {loading ? (
          <p className="status-muted">Loading your winnings...</p>
        ) : winnings.length === 0 ? (
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
              You haven't won any auctions yet. Keep bidding!
            </p>
            <Link to="/" className="primary-button" style={{ display: 'inline-block' }}>
              Browse Auctions
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {winnings.map((item) => {
              const status = getStatusLabel(item.status);
              const needsPayment = item.status.toUpperCase() === 'PENDING_COMPLIANCE';

              return (
                <div
                  key={item.id}
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
                      <strong style={{ fontSize: '0.9rem' }}>
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
                        <span className="status-muted">Winning bid: </span>
                        <strong>{formatCurrency(item.winningBid)}</strong>
                      </div>
                      {item.compliedAt && (
                        <div className="status-muted" style={{ fontSize: '0.75rem' }}>
                          Paid: {new Date(item.compliedAt).toLocaleDateString('en-PH')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {needsPayment && (
                      <button
                        className="primary-button"
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                        onClick={() => handlePay(item.id)}
                        disabled={payingId === item.id}
                      >
                        {payingId === item.id ? 'Processing...' : 'Pay Now'}
                      </button>
                    )}
                    {process.env.NODE_ENV === 'development' && needsPayment && (
                      <button
                        className="ghost-button"
                        style={{ padding: '0.4rem 0.7rem', fontSize: '0.75rem' }}
                        onClick={() => handleSimulatePayment(item.id)}
                        disabled={payingId === item.id}
                      >
                        Simulate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
