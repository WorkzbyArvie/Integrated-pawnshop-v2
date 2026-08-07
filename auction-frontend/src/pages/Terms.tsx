import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  fetchTosTemplate,
  acceptBidderTos,
  type TosTemplate,
  type TosClause,
} from '../services/auctionApi';
import { renderAgreementTemplate } from '../lib/agreementTemplate';
import '../App.css';

function renderTemplateContent(
  content: string,
  bidderName: string | undefined,
  bidderAddress: string | undefined,
): string {
  return renderAgreementTemplate(content, {
    bidderName,
    bidderAddress,
  });
}

export default function Terms() {
  const { user, session, kycProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const listingIdParam = searchParams.get('listingId');
  const [template, setTemplate] = useState<TosTemplate | null>(null);
  const [clauses, setClauses] = useState<TosClause[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedName, setSignedName] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchTosTemplate(session.access_token)
      .then((data) => {
        if (!mounted) return;
        setTemplate(data.template);
        setClauses(data.clauses);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load terms');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  const handleAccept = async () => {
    if (!session?.access_token) return;
    if (!signedName.trim()) {
      setError('Please enter your full name to sign.');
      return;
    }

    setAccepting(true);
    setError(null);
    try {
      const listingId = listingIdParam ? Number(listingIdParam) : 0;
      await acceptBidderTos(listingId, session.access_token, signedName.trim());
      setAccepted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept terms');
    } finally {
      setAccepting(false);
    }
  };

  if (!user) {
    return (
      <div className="page">
        <p className="status-muted" style={{ textAlign: 'center', marginTop: '4rem' }}>
          Please sign in to view the Auction Bidder Agreement.
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
      </div>

      <div className="hero-content" style={{ maxWidth: '800px', margin: '0 auto' }}>
        <span className="hero-eyebrow">Legal Agreement</span>
        <h1 className="hero-title" style={{ marginBottom: '0.5rem' }}>
          Auction Bidder <strong>Agreement</strong>
        </h1>
        {template && (
          <p className="status-muted" style={{ marginBottom: '2rem' }}>
            Version {template.version} &middot; Last updated{' '}
            {new Date(template.createdAt || Date.now()).toLocaleDateString('en-PH')}
          </p>
        )}

        {loading ? (
          <p className="status-muted">Loading terms of service...</p>
        ) : (
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {error && (
              <p className="status-error" style={{ margin: 0 }}>
                {error}
              </p>
            )}

            {accepted ? (
              <div
                style={{
                  background: 'rgba(201, 160, 92, 0.06)',
                  border: '1px solid rgba(201, 160, 92, 0.2)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '2rem',
                  textAlign: 'center',
                }}
              >
                <p className="status-verified" style={{ justifyContent: 'center', fontSize: '1.1rem' }}>
                  Agreement Accepted
                </p>
                <p className="status-muted">Signed as: {signedName}</p>
                <div style={{ marginTop: '1rem' }}>
                  <Link to="/" className="primary-button" style={{ display: 'inline-block' }}>
                    Browse Auctions
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '2rem',
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    fontFamily: 'var(--font-body)',
                    lineHeight: '1.7',
                    fontSize: '0.9rem',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {template?.content
                    ? renderTemplateContent(
                        template.content,
                        user.user_metadata?.fullName || user.email,
                        kycProfile?.address,
                      )
                    : 'No agreement content available.'}
                </div>

                {clauses.length > 0 && (
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Key Clauses</h3>
                    {clauses.map((clause) => (
                      <div
                        key={clause.id}
                        style={{
                          background: clause.isMandatory
                            ? 'rgba(201, 160, 92, 0.04)'
                            : 'transparent',
                          border: `1px solid ${
                            clause.isMandatory
                              ? 'rgba(201, 160, 92, 0.15)'
                              : 'var(--border-subtle)'
                          }`,
                          borderRadius: 'var(--radius)',
                          padding: '1rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem',
                          }}
                        >
                          <strong style={{ fontSize: '0.9rem' }}>{clause.name}</strong>
                          {clause.isMandatory && (
                            <span
                              className="badge"
                              style={{ background: 'rgba(201, 160, 92, 0.15)', color: 'var(--gold)' }}
                            >
                              Required
                            </span>
                          )}
                        </div>
                        <p className="status-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
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
                    padding: '1.5rem',
                    display: 'grid',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        marginBottom: '0.5rem',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Type your full name to sign electronically
                    </label>
                    <input
                      type="text"
                      value={signedName}
                      onChange={(e) => {
                        setSignedName(e.target.value);
                        setError(null);
                      }}
                      placeholder={user.user_metadata?.fullName || user.email || 'Full Name'}
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
                    By clicking &quot;I Agree&quot; you acknowledge that you have read, understood,
                    and agree to be bound by the Auction Bidder Agreement. Your typed name serves as
                    your electronic signature and is legally binding.
                  </p>

                  <button
                    className="primary-button"
                    disabled={accepting || !signedName.trim()}
                    onClick={handleAccept}
                    style={{ width: '100%', opacity: accepting || !signedName.trim() ? 0.7 : 1 }}
                  >
                    {accepting ? 'Accepting...' : 'I Agree to the Terms'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
