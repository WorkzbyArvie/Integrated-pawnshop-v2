import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useAuth } from '../context/AuthContext';
import {
  fetchMyWinnings,
  createPaymentCheckout,
  simulatePaymentWebhook,
  signContract as apiSignContract,
  fetchTosTemplate,
  type MyWinningItem,
  type TosTemplate,
  type TosClause,
} from '../services/auctionApi';
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

function CountdownTimer({ deadline }: { deadline: string }) {
  const calcRemaining = useCallback(() => {
    const diff = new Date(deadline).getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
      expired: false,
    };
  }, [deadline]);

  const [remaining, setRemaining] = useState(calcRemaining);

  useEffect(() => {
    const interval = setInterval(() => setRemaining(calcRemaining()), 1000);
    return () => clearInterval(interval);
  }, [calcRemaining]);

  if (remaining.expired) {
    return <span style={{ color: '#ef4444', fontWeight: 600 }}>Expired</span>;
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <span style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: '0.85rem' }}>
      {remaining.days}d {pad(remaining.hours)}h {pad(remaining.minutes)}m {pad(remaining.seconds)}s
    </span>
  );
}

function renderTemplateContent(content: string): string {
  return content
    .replace(/\{\{agreementNumber\}\}/g, 'AGREEMENT-XXXXX')
    .replace(/\{\{generatedDate\}\}/g, new Date().toLocaleDateString('en-PH'))
    .replace(/\{\{pawnshopLegalName\}\}/g, 'PawnGold')
    .replace(/\{\{bidderName\}\}/g, '[Your Full Name]')
    .replace(/\{\{bidderId\}\}/g, '[Your Account ID]')
    .replace(/\{\{complianceHours\}\}/g, '48')
    .replace(/\{\{(\w+)\}\}/g, '[$1]');
}

export default function MyWinnings() {
  const { user, session } = useAuth();
  const [winnings, setWinnings] = useState<MyWinningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [contractModal, setContractModal] = useState<{ item: MyWinningItem; template: TosTemplate | null; clauses: TosClause[]; signedName: string } | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const needsBanner = winnings.some(
    (w) => w.status.toUpperCase() === 'PENDING_COMPLIANCE' && !w.contractSignedAt,
  );

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
      })
      .catch((err: Error) => {
        if (!mounted) return;
        Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to load your winnings', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
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

  const handleOpenContract = async (item: MyWinningItem) => {
    if (!session?.access_token) return;
    setContractLoading(true);
    try {
      const data = await fetchTosTemplate(session.access_token);
      setContractModal({ item, template: data.template, clauses: data.clauses, signedName: '' });
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to load contract', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
    } finally {
      setContractLoading(false);
    }
  };

  const handleSignContract = async () => {
    if (!session?.access_token || !contractModal) return;
    if (!contractModal.signedName.trim()) {
      Swal.fire({ icon: 'warning', title: 'Name Required', text: 'Please enter your full name to sign.', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
      return;
    }
    setSigningId(contractModal.item.id);
    try {
      await apiSignContract(contractModal.item.id, contractModal.signedName.trim(), session.access_token);
      setContractModal(null);
      loadWinnings();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Signing Failed', text: err.message || 'Failed to sign contract', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
    } finally {
      setSigningId(null);
    }
  };

  const handlePay = async (complianceId: string) => {
    if (!session?.access_token) return;
    setPayingId(complianceId);
    try {
      const result = await createPaymentCheckout(complianceId, session.access_token);
      window.open(result.checkoutUrl, '_blank');
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Payment Failed', text: err.message || 'Payment failed', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
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
      Swal.fire({ icon: 'error', title: 'Simulation Failed', text: err.message || 'Simulation failed', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
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

        {!bannerDismissed && needsBanner && (
          <div
            style={{
              background: 'rgba(251, 191, 36, 0.08)',
              border: '1px solid rgba(251, 191, 36, 0.2)',
              borderRadius: 'var(--radius-lg)',
              padding: '1rem 1.5rem',
              marginBottom: '1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              You have items to pay for! Complete payment before the deadline to avoid losing your winnings.
            </p>
            <button
              onClick={() => setBannerDismissed(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: '0.25rem',
                lineHeight: 1,
              }}
            >
              &times;
            </button>
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
              const needsContract = needsPayment && !item.contractSignedAt;

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
                      {needsPayment && item.complianceDeadline && (
                        <div>
                          <span className="status-muted">Deadline: </span>
                          <CountdownTimer deadline={item.complianceDeadline} />
                        </div>
                      )}
                      {item.contractSignedAt && (
                        <div className="status-muted" style={{ fontSize: '0.75rem' }}>
                          Signed: {new Date(item.contractSignedAt).toLocaleDateString('en-PH')}
                        </div>
                      )}
                      {item.compliedAt && (
                        <div className="status-muted" style={{ fontSize: '0.75rem' }}>
                          Paid: {new Date(item.compliedAt).toLocaleDateString('en-PH')}
                        </div>
                      )}
                      {item.status.toUpperCase() === 'RELEASED' && (
                        <div style={{ fontSize: '0.75rem', color: '#4ade80' }}>
                          Item Released
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {needsContract && (
                      <button
                        className="primary-button"
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                        onClick={() => handleOpenContract(item)}
                        disabled={contractLoading && signingId === item.id}
                      >
                        Review & Sign Contract
                      </button>
                    )}
                    {needsPayment && !needsContract && (
                      <button
                        className="primary-button"
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                        onClick={() => handlePay(item.id)}
                        disabled={payingId === item.id}
                      >
                        {payingId === item.id ? 'Processing...' : 'Pay Now'}
                      </button>
                    )}
                    {process.env.NODE_ENV === 'development' && needsPayment && item.contractSignedAt && (
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

      {contractModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          }}
          onClick={() => setContractModal(null)}
        >
          <div
            style={{
              background: '#14141B', borderRadius: '1.5rem', width: '90%', maxWidth: '700px',
              maxHeight: '85vh', overflowY: 'auto', padding: '2rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Won Auction Contract</h2>
              <button
                onClick={() => setContractModal(null)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '1.3rem', padding: '0.25rem', lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.5rem',
                maxHeight: '40vh',
                overflowY: 'auto',
                fontFamily: 'var(--font-body)',
                lineHeight: '1.7',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                marginBottom: '1rem',
              }}
            >
              {contractModal.template?.content
                ? renderTemplateContent(contractModal.template.content)
                : 'No contract content available.'}
            </div>

            {contractModal.clauses.length > 0 && (
              <div style={{ marginBottom: '1rem', display: 'grid', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Key Clauses</h3>
                {contractModal.clauses.map((clause) => (
                  <div
                    key={clause.id}
                    style={{
                      background: clause.isMandatory ? 'rgba(201, 160, 92, 0.04)' : 'transparent',
                      border: `1px solid ${clause.isMandatory ? 'rgba(201, 160, 92, 0.15)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius)',
                      padding: '0.75rem',
                    }}
                  >
                    <strong style={{ fontSize: '0.85rem' }}>{clause.name}</strong>
                    <p className="status-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                      {clause.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.25rem',
                display: 'grid',
                gap: '1rem',
              }}
            >
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Type your full name to sign electronically
                </label>
                <input
                  type="text"
                  value={contractModal.signedName}
                  onChange={(e) => {
                    setContractModal({ ...contractModal, signedName: e.target.value });
                  }}
                  placeholder={user?.user_metadata?.fullName || user?.email || 'Full Name'}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius)',
                    padding: '0.75rem 1rem',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    outline: 'none',
                    fontSize: '1rem',
                  }}
                />
              </div>

              <p className="status-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                By signing you agree to the terms of the won auction contract. Your typed name serves as
                your electronic signature and is legally binding.
              </p>

              <button
                className="primary-button"
                disabled={signingId === contractModal.item.id || !contractModal.signedName.trim()}
                onClick={handleSignContract}
                style={{ width: '100%', opacity: signingId === contractModal.item.id || !contractModal.signedName.trim() ? 0.7 : 1 }}
              >
                {signingId === contractModal.item.id ? 'Signing...' : 'Sign & Continue to Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
