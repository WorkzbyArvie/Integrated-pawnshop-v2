import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import type { AuctionListing } from '../types';
import { fetchListing, checkTosStatus, acceptBidderTos, placeBid } from '../services/auctionApi';
import { useAuth } from '../context/AuthContext';
import '../App.css';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value || 0);

const parseListingDetails = (text?: string | null) => {
  const source = (text || '').trim();
  if (!source) {
    return { mainDescription: '', condition: '', specifications: '', provenance: '', disclosures: '' };
  }

  const compact = source.replace(/\s+/g, ' ').trim();
  const fields: Record<string, string> = {
    condition: '',
    specifications: '',
    provenance: '',
    disclosures: '',
  };
  const metadataPattern = /(Condition|Specifications|Provenance|Disclosures)\s*:\s*(.*?)(?=\s+(?:Condition|Specifications|Provenance|Disclosures)\s*:|$)/gi;

  compact.replace(metadataPattern, (_full, rawLabel: string, rawValue: string) => {
    const key = rawLabel.toLowerCase();
    const value = String(rawValue || '').trim();
    if (value) {
      if (key === 'condition') fields.condition = value;
      if (key === 'specifications') fields.specifications = value;
      if (key === 'provenance') fields.provenance = value;
      if (key === 'disclosures') fields.disclosures = value;
    }
    return _full;
  });

  const mainDescription = compact
    .replace(/Auction Transparency Details/gi, '')
    .replace(metadataPattern, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    mainDescription,
    condition: fields.condition,
    specifications: fields.specifications,
    provenance: fields.provenance,
    disclosures: fields.disclosures,
  };
};

export default function ListingDetail() {
  const { user, session, kycStatus } = useAuth();
  const params = useParams();
  const listingId = Number(params.id);
  const [listing, setListing] = useState<AuctionListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidding, setBidding] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [tosLoading, setTosLoading] = useState(true);
  const [acceptingTos, setAcceptingTos] = useState(false);
  const [tosVersion, setTosVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!listingId) {
      setError('Invalid listing');
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchListing(listingId)
      .then((data) => {
        if (!mounted) return;
        setListing(data);
        setActiveImageIndex(0);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load listing');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [listingId]);

  useEffect(() => {
    if (!session?.access_token) {
      setTosLoading(false);
      return;
    }

    let mounted = true;
    setTosLoading(true);
    checkTosStatus(session.access_token)
      .then((status) => {
        if (mounted) {
          setTosAccepted(status.accepted);
          setTosVersion(status.tosVersion);
          setTosLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setTosAccepted(false);
          setTosLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  if (loading) {
    return (
      <div className="page">
        <p className="status-muted">Loading auction details...</p>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="page">
        <p className="status-error">{error || 'Listing not found'}</p>
        <Link to="/" className="ghost-button">
          Back to auctions
        </Link>
      </div>
    );
  }

  const sortedImages = [...(listing.images || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const selectedImage = sortedImages[activeImageIndex] || sortedImages[0] || null;
  const detailsText = listing.description || listing.ticket.description;
  const parsedDetails = parseListingDetails(detailsText);
  const hasSpecDetails = Boolean(
    parsedDetails.condition || parsedDetails.specifications || parsedDetails.provenance || parsedDetails.disclosures,
  );
  const minBid = (listing.currentBid || listing.startingPrice) + (listing.minBidIncrement || 100);

  return (
    <div className="page">
      <Link to="/" className="ghost-button" style={{ width: 'fit-content' }}>
        Back to auctions
      </Link>
      <div className="hero">
        <div className="hero-content">
          <span className="hero-eyebrow">{listing.pawnshop.name}</span>
          <h1 className="hero-title">
            {listing.title} <strong>#{listing.ticket.ticketNumber}</strong>
          </h1>
          <div className="hero-card">
            <span className="badge">Live Bid</span>
            <h3>Current Bid</h3>
            <div className="price">{formatCurrency(listing.currentBid || listing.startingPrice)}</div>

            {user && session ? (
              kycStatus !== 'VERIFIED' ? (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div style={{
                    background: kycStatus === 'PENDING' ? 'rgba(201, 160, 92, 0.06)' : kycStatus === 'REJECTED' ? 'rgba(212, 69, 69, 0.06)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${kycStatus === 'PENDING' ? 'rgba(201, 160, 92, 0.2)' : kycStatus === 'REJECTED' ? 'rgba(212, 69, 69, 0.2)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '1rem',
                    textAlign: 'center',
                  }}>
                    <p className={kycStatus === 'PENDING' ? 'status-muted' : 'status-error'} style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                      {kycStatus === 'PENDING'
                        ? 'Your ID verification is under review. You can bid once approved.'
                        : kycStatus === 'REJECTED'
                          ? 'Your ID verification was rejected. Please re-submit.'
                          : 'You must verify your identity before placing bids.'}
                    </p>
                    <Link to="/profile" className="primary-button" style={{ display: 'inline-block' }}>
                      {kycStatus === 'NOT_SUBMITTED' ? 'Verify Identity' : kycStatus === 'REJECTED' ? 'Re-submit' : 'View Status'}
                    </Link>
                  </div>
                  <p className="status-muted" style={{ margin: 0 }}>
                    Signed in as {user.email}
                  </p>
                </div>
              ) : tosLoading ? (
                <p className="status-muted" style={{ textAlign: 'center' }}>
                  Checking terms acceptance...
                </p>
              ) : !tosAccepted ? (
                <div className="tos-panel">
                  <h4>Auction Bidder Agreement</h4>
                  <p>
                    By placing a bid you agree to the Auction Bidder Agreement. This includes
                    binding terms for item authenticity, payment obligations, shipping policies,
                    and dispute resolution. Your bid is a legally binding commitment to purchase
                    the item if you are the winning bidder.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                    <Link
                      to={`/terms?listingId=${listing.id}`}
                      className="ghost-button"
                      style={{
                        textAlign: 'center',
                        fontSize: '0.8rem',
                        color: 'var(--gold)',
                        border: '1px solid rgba(201, 160, 92, 0.2)',
                      }}
                    >
                      View Full Agreement
                    </Link>
                    <button
                      className="primary-button"
                      disabled={acceptingTos}
                      onClick={async () => {
                        if (!session?.access_token) return;
                        setAcceptingTos(true);
                        try {
                          await acceptBidderTos(listing.id, session.access_token);
                          setTosAccepted(true);
                        } catch {
                          Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to accept terms. Please try again.', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
                        } finally {
                          setAcceptingTos(false);
                        }
                      }}
                      style={{ width: '100%' }}
                    >
                      {acceptingTos ? 'Accepting...' : 'I Agree to the Terms'}
                    </button>
                  </div>
                  <p className="status-muted" style={{ margin: '0.5rem 0 0' }}>
                    Signed in as {user.email}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p className="status-verified" style={{ margin: 0 }}>
                      Terms accepted
                    </p>
                    <Link to={`/terms?listingId=${listing.id}`} className="ghost-button" style={{ padding: '0.3rem 0.7rem', fontSize: '0.7rem' }}>
                      v{tosVersion || '?'} &middot; View
                    </Link>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder={`Min ${formatCurrency(minBid)}`}
                      value={bidAmount}
                      min={minBid}
                      step={1}
                      onKeyDown={(e) => {
                        if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
                          e.preventDefault();
                        }
                      }}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith('-')) return;
                        setBidAmount(value);
                      }}
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius)',
                        padding: '0.75rem 1rem',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-body)',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div className="cta-row">
                    <button
                      className="primary-button"
                      disabled={bidding}
                      onClick={async () => {
                        if (!session?.access_token) {
                          Swal.fire({ icon: 'error', title: 'Session Expired', text: 'Your session expired. Please log in again.', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
                          return;
                        }
                        if (String(listing.status || '').toUpperCase() !== 'LIVE') {
                          Swal.fire({ icon: 'error', title: 'Not Available', text: 'This listing is not live for bidding.', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
                          return;
                        }
                        const amount = Number(bidAmount);
                        if (!amount || amount <= 0 || amount < minBid) {
                          Swal.fire({ icon: 'warning', title: 'Invalid Amount', text: `Minimum bid is ${formatCurrency(minBid)}`, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
                          return;
                        }
                        const { isConfirmed } = await Swal.fire({
                          title: 'Confirm Bid',
                          text: `Place a bid of ${formatCurrency(amount)}?`,
                          icon: 'question',
                          showCancelButton: true,
                          confirmButtonColor: '#C9A05C',
                          cancelButtonColor: '#6B655C',
                          confirmButtonText: 'Yes, Place Bid',
                          cancelButtonText: 'Cancel',
                          background: '#1C1C26',
                          color: '#EAE2D6',
                        });
                        if (!isConfirmed) return;
                        setBidding(true);
                        try {
                          const data = await placeBid(listing.id, amount, session.access_token);
                          Swal.fire({ icon: 'success', title: 'Bid Placed!', text: `New bid: ${formatCurrency(data.currentBid)}`, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
                          setBidAmount('');
                          fetchListing(listingId).then(setListing).catch(() => {});
                        } catch (err: unknown) {
                          const message = err instanceof Error ? err.message : 'Unable to place bid right now. Please try again.';
                          Swal.fire({ icon: 'error', title: 'Bid Failed', text: message.toLowerCase().includes('valid amount') ? 'Put Valid Amount' : message.toLowerCase().includes('internal server') ? 'Unable to place bid right now. Please try again.' : message, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
                        } finally {
                          setBidding(false);
                        }
                      }}
                      style={{ flex: 1 }}
                    >
                      {bidding ? 'Placing Bid...' : 'Place Bid'}
                    </button>
                  </div>
                  <p className="status-muted" style={{ margin: 0 }}>
                    Signed in as {user.email}
                  </p>
                </div>
              )
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div className="cta-row">
                  <Link to="/" className="primary-button">
                    Login to Bid
                  </Link>
                </div>
                <p className="status-muted" style={{ margin: 0 }}>
                  You must be logged in to place bids.
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="hero-media-column">
          <div className="hero-media">
            <span className="badge">Certified Authentic</span>
            {selectedImage?.url ? (
              <>
                <img
                  src={selectedImage.url}
                  alt={`${listing.title} image ${activeImageIndex + 1}`}
                  className="detail-hero-image"
                />
                {sortedImages.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="slider-nav slider-nav-prev"
                      onClick={() =>
                        setActiveImageIndex((prev) =>
                          prev === 0 ? sortedImages.length - 1 : prev - 1,
                        )
                      }
                      aria-label="Previous photo"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="slider-nav slider-nav-next"
                      onClick={() =>
                        setActiveImageIndex((prev) =>
                          prev === sortedImages.length - 1 ? 0 : prev + 1,
                        )
                      }
                      aria-label="Next photo"
                    >
                      ›
                    </button>
                  </>
                ) : null}
                {sortedImages.length > 1 ? (
                  <div className="detail-thumbs" role="tablist" aria-label="Listing photos">
                    {sortedImages.map((image, index) => (
                      <button
                        key={image.id || `${image.url}-${index}`}
                        type="button"
                        className={`detail-thumb ${index === activeImageIndex ? 'active' : ''}`}
                        onClick={() => setActiveImageIndex(index)}
                        aria-label={`View photo ${index + 1}`}
                      >
                        <img src={image.url} alt={`Thumbnail ${index + 1}`} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="detail-image-copy">
            <article className="media-description-card" aria-label="Item description">
              <h3 className="media-description-title">Item Description</h3>
              <p className="media-description-text">
                {parsedDetails.mainDescription || 'No description provided.'}
              </p>
              {hasSpecDetails ? (
                <dl className="media-spec-grid">
                  {parsedDetails.condition ? (
                    <div className="media-spec-item">
                      <dt>Condition</dt>
                      <dd>{parsedDetails.condition}</dd>
                    </div>
                  ) : null}
                  {parsedDetails.specifications ? (
                    <div className="media-spec-item">
                      <dt>Specifications</dt>
                      <dd>{parsedDetails.specifications}</dd>
                    </div>
                  ) : null}
                  {parsedDetails.provenance ? (
                    <div className="media-spec-item">
                      <dt>Provenance</dt>
                      <dd>{parsedDetails.provenance}</dd>
                    </div>
                  ) : null}
                  {parsedDetails.disclosures ? (
                    <div className="media-spec-item">
                      <dt>Disclosures</dt>
                      <dd>{parsedDetails.disclosures}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </article>
          </div>
        </div>
      </div>
      <section className="footer">
        <div>
          <strong>Listing Facts</strong>
          <p>Category: {listing.ticket.category || listing.category?.name || 'General'}</p>
          <p>Pawnshop: {listing.pawnshop.name}</p>
          <p>Ticket: {listing.ticket.ticketNumber}</p>
        </div>
        <div>
          <strong>Bid Activity</strong>
          <p>{listing.bidCount} bids recorded</p>
        </div>
      </section>
    </div>
  );
}
