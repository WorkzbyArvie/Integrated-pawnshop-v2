import { useEffect, useMemo, useState } from 'react';
import { useBranding } from '../context/BrandingContext';
import { Link } from 'react-router-dom';
import Swal from 'sweetalert2';
import '../App.css';
import type { AuctionListing } from '../types';
import { fetchListings } from '../services/auctionApi';
import { useAuth } from '../context/AuthContext';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatCountdown = (endAt: string | null | undefined, now: number) => {
  if (!endAt) return { label: 'No end date', hours: '--', minutes: '--', seconds: '--' };
  const diff = new Date(endAt).getTime() - now;
  if (diff <= 0) return { label: 'Ended', hours: '00', minutes: '00', seconds: '00' };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return {
    label: 'Ends in',
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  };
};

export default function Home() {
  const { user, signIn, requestAuthCode, signUp, signOut, loading: authLoading, kycStatus } = useAuth();
  const { branding } = useBranding();
  const initialPawnshopId = useMemo(
    () => new URLSearchParams(window.location.search).get('pawnshopId'),
    [],
  );
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pawnshopFilter, setPawnshopFilter] = useState<string>(initialPawnshopId || 'all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [loginOpen, setLoginOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const notifyError = (msg: string) => Swal.fire({ icon: 'error', title: 'Error', text: msg, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
  const notifySuccess = (msg: string) => Swal.fire({ icon: 'success', title: 'Success', text: msg, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
  const [now, setNow] = useState(Date.now());
  const [featuredImageIndex, setFeaturedImageIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchListings({ status: 'LIVE', limit: 12, pawnshopId: initialPawnshopId || undefined })
      .then((data) => {
        if (!mounted) return;
        setListings(data.items || []);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load listings');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const pawnshops = useMemo(() => {
    const map = new Map<string, string>();
    listings.forEach((listing) => map.set(listing.pawnshop.id, listing.pawnshop.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [listings]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    listings.forEach((listing) => {
      const label = listing.ticket.category || listing.category?.name || 'Other';
      map.set(label, label);
    });
    return Array.from(map.values());
  }, [listings]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      const matchesSearch =
        !search ||
        listing.title.toLowerCase().includes(search.toLowerCase()) ||
        listing.ticket.ticketNumber.toLowerCase().includes(search.toLowerCase());
      const matchesPawnshop = pawnshopFilter === 'all' || listing.pawnshop.id === pawnshopFilter;
      const categoryLabel = listing.ticket.category || listing.category?.name || 'Other';
      const matchesCategory = categoryFilter === 'all' || categoryFilter === categoryLabel;
      return matchesSearch && matchesPawnshop && matchesCategory;
    });
  }, [listings, search, pawnshopFilter, categoryFilter]);

  const featured = filteredListings[0];
  const featuredImages = useMemo(
    () => (featured?.images ? [...featured.images].sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [featured],
  );
  const featuredCountdown = featured ? formatCountdown(featured.endAt, now) : null;
  const featuredImageUrl = featuredImages[featuredImageIndex]?.url || featuredImages[0]?.url || null;

  useEffect(() => {
    setFeaturedImageIndex(0);
  }, [featured?.id]);

  useEffect(() => {
    if (featuredImageIndex >= featuredImages.length) {
      setFeaturedImageIndex(0);
    }
  }, [featuredImageIndex, featuredImages.length]);

  useEffect(() => {
    if (branding) {
      const root = document.documentElement;
      if (branding.primaryColor) root.style.setProperty('--gold', branding.primaryColor);
      if (branding.secondaryColor) root.style.setProperty('--gold-dark', branding.secondaryColor);
      if (branding.accentColor) root.style.setProperty('--leather', branding.accentColor);
    }
  }, [branding]);

  return (
    <div className="page">
      <header className="top-bar">
        <div className="brand">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt="Brand Logo" className="brand-badge" style={{ objectFit: 'cover' }} />
          ) : (
            <div className="brand-badge">PG</div>
          )}
          {branding?.name || 'PawnGold'} <span>Auction House</span>
        </div>
        <nav className="nav">
          <a href="#home">Home</a>
          <a href="#auctions">Auctions</a>
          <a href="#how">Guide</a>
        </nav>
        {user ? (
          <div className="auth-nav">
            {kycStatus === 'VERIFIED' ? (
              <span className="status-verified">Verified</span>
            ) : (
              <Link to="/profile" className="auth-nav-link" style={{ color: kycStatus === 'REJECTED' ? 'var(--red)' : 'var(--gold)' }}>
                {kycStatus === 'PENDING' ? 'KYC Pending' : kycStatus === 'REJECTED' ? 'KYC Rejected' : 'Verify ID'}
              </Link>
            )}
            <Link to="/my-bids" className="auth-nav-link" style={{ color: 'var(--text-secondary)' }}>
              My Bids
            </Link>
            <Link to="/profile" className="auth-nav-link" style={{ color: 'var(--text-secondary)' }}>
              {user.user_metadata?.fullName || user.email}
            </Link>
            <button className="ghost-button" onClick={() => signOut()} style={{ padding: '0.4rem 0.9rem', fontSize: '0.75rem' }}>
              Logout
            </button>
          </div>
        ) : (
          <button className="primary-button" onClick={() => { setLoginOpen(true); setAuthTab('login'); }}>
            Sign In
          </button>
        )}
      </header>

      <section id="home" className="hero">
        <div className="hero-content">
          <span className="hero-eyebrow">Featured Auction</span>
          <h1 className="hero-title">
            Global Pawn <strong>Liquidation</strong>
          </h1>
          <p className="hero-copy">
            Bid on authenticated luxury items from the world's most prestigious pawnshops. Every
            piece verified, every auction secured, every bid synced in real time.
          </p>
          {featured && featuredCountdown ? (
            <div className="hero-card">
              <span className="badge">Featured Item</span>
              <h3>{featured.title}</h3>
              <div className="price">{formatCurrency(featured.currentBid || featured.startingPrice)}</div>
              <div className="countdown">
                <div>
                  <span>{featuredCountdown.hours}</span>
                  Hours
                </div>
                <div>
                  <span>{featuredCountdown.minutes}</span>
                  Minutes
                </div>
                <div>
                  <span>{featuredCountdown.seconds}</span>
                  Seconds
                </div>
              </div>
              <div className="cta-row">
                <Link to={`/listing/${featured.id}`} className="primary-button">
                  View Auction
                </Link>
              </div>
            </div>
          ) : (
            <div className="hero-card">
              <h3>{loading ? 'Loading featured auction...' : 'No live auctions yet'}</h3>
              <p className="status-muted" style={{ margin: 0 }}>
                {loading ? 'Syncing live inventory from pawnshops.' : 'Check back soon — new items are published regularly.'}
              </p>
            </div>
          )}
        </div>
        <div className="hero-media">
          {featuredImageUrl ? <img src={featuredImageUrl} alt={featured?.title || 'Featured auction item'} className="detail-hero-image" /> : null}
          {featuredImages.length > 1 ? (
            <>
              <button
                type="button"
                className="slider-nav slider-nav-prev"
                aria-label="Show previous featured image"
                onClick={() => setFeaturedImageIndex((current) => (current - 1 + featuredImages.length) % featuredImages.length)}
              >
                ‹
              </button>
              <button
                type="button"
                className="slider-nav slider-nav-next"
                aria-label="Show next featured image"
                onClick={() => setFeaturedImageIndex((current) => (current + 1) % featuredImages.length)}
              >
                ›
              </button>
              <div className="hero-media-dots" aria-label="Featured image selectors">
                {featuredImages.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    className={`hero-media-dot ${featuredImageIndex === index ? 'active' : ''}`}
                    aria-label={`Show featured image ${index + 1}`}
                    onClick={() => setFeaturedImageIndex(index)}
                  />
                ))}
              </div>
            </>
          ) : null}
          <span className="badge">Certified Authentic</span>
        </div>
      </section>

      <section id="auctions">
        <div className="section-header">
          <div>
            <h2 className="section-title">Live Auctions</h2>
            <p className="section-subtitle">{filteredListings.length} exclusive items available</p>
          </div>
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search lots, ticket numbers, or designers"
          />
        </div>

        <div className="filters" style={{ marginTop: '1.5rem' }}>
          <button
            className={`filter-pill ${pawnshopFilter === 'all' ? 'active' : ''}`}
            onClick={() => setPawnshopFilter('all')}
          >
            All Pawnshops
          </button>
          {pawnshops.map((shop) => (
            <button
              key={shop.id}
              className={`filter-pill ${pawnshopFilter === shop.id ? 'active' : ''}`}
              onClick={() => setPawnshopFilter(shop.id)}
            >
              {shop.name}
            </button>
          ))}
        </div>

        <div className="filters" style={{ marginTop: '0.8rem' }}>
          <button
            className={`filter-pill ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All Categories
          </button>
          {categories.map((category) => (
            <button
              key={category}
              className={`filter-pill ${categoryFilter === category ? 'active' : ''}`}
              onClick={() => setCategoryFilter(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="status-muted" style={{ marginTop: '2rem' }}>Loading auctions...</p>
        ) : error ? (
          <p className="status-error" style={{ marginTop: '2rem' }}>{error}</p>
        ) : (
          <div className="auction-grid" style={{ marginTop: '2rem' }}>
            {filteredListings.map((listing, index) => (
              <AuctionCard key={listing.id} listing={listing} now={now} index={index} onBid={() => { if (!user) setLoginOpen(true); }} />
            ))}
          </div>
        )}
      </section>

      <section id="how" className="footer">
        <div>
          <strong>How to Bid</strong>
          <p>1. Create an account with verified ID.</p>
          <p>2. Place bids in real time. We auto-extend on last-minute bids.</p>
          <p>3. Secure checkout with escrow protection.</p>
        </div>
        <div>
          <strong>Powered by PawnGold</strong>
          <p>Live inventory synced from verified pawnshops across the network.</p>
        </div>
      </section>

      {loginOpen && !user && (
        <div className="modal-overlay" onClick={() => setLoginOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>
                {authTab === 'login' ? 'Welcome Back' : 'Create Account'}
              </h3>
              <button className="ghost-button" onClick={() => setLoginOpen(false)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}>
                Close
              </button>
            </div>
            <p className="status-muted" style={{ margin: 0 }}>
              {authTab === 'login'
                ? 'Login to place bids on exclusive items.'
                : 'Sign up to start bidding on luxury items.'}
            </p>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className={authTab === 'login' ? 'primary-button' : 'ghost-button'}
                style={{ flex: 1, padding: '0.5rem', textAlign: 'center' }}
                onClick={() => { setAuthTab('login'); }}
              >
                Login
              </button>
              <button
                className={authTab === 'signup' ? 'primary-button' : 'ghost-button'}
                style={{ flex: 1, padding: '0.5rem', textAlign: 'center' }}
                onClick={() => { setAuthTab('signup'); }}
              >
                Sign Up
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();

                if (authTab === 'signup') {
                  if (!authCode.trim()) {
                    notifyError('Enter your verification code before creating an account.');
                    return;
                  }

                  const { isConfirmed } = await Swal.fire({
                    title: 'Confirm Registration',
                    text: 'Create your bidder account now?',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#C9A05C',
                    cancelButtonColor: '#6B655C',
                    confirmButtonText: 'Yes, Create Account',
                    cancelButtonText: 'Cancel',
                    background: '#1C1C26',
                    color: '#EAE2D6',
                  });
                  if (!isConfirmed) return;
                }

                setAuthSubmitting(true);

                let result: { error?: string };
                if (authTab === 'login') {
                  result = await signIn(authEmail, authPassword);
                } else {
                  result = await signUp(authEmail, authPassword, authName, authCode);
                }

                setAuthSubmitting(false);

                if (result.error) {
                  notifyError(result.error);
                } else {
                  setLoginOpen(false);
                  setAuthEmail('');
                  setAuthPassword('');
                  setAuthName('');
                  setAuthCode('');
                  if (authTab === 'signup') {
                    notifySuccess('Account created! Browse auctions and verify your identity in Profile to start bidding.');
                  } else {
                    notifySuccess('Welcome back! Start browsing live auctions.');
                  }
                }
              }}
              style={{ display: 'grid', gap: '0.75rem' }}
            >
              {authTab === 'signup' && (
                <input
                  placeholder="Full name"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  required
                />
              )}
              <input
                placeholder="Email address"
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
              <input
                placeholder="Password"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                minLength={8}
              />
              {authTab === 'signup' && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      placeholder="Authentication code"
                      value={authCode}
                      onChange={(e) => setAuthCode(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={async () => {
                        if (!authEmail) {
                          notifyError('Enter your email before requesting a verification code.');
                          return;
                        }
                        const response = await requestAuthCode(authEmail, 'BIDDER_REGISTRATION');
                        if (response.error) {
                          notifyError(response.error);
                          return;
                        }
                        notifySuccess(
                          response.message ||
                            'Verification code sent. Check your email and continue signup.',
                        );
                      }}
                    >
                      Request Code
                    </button>
                  </div>
                </div>
              )}

              <button
                className="primary-button"
                type="submit"
                disabled={authSubmitting || authLoading}
                style={{ width: '100%', opacity: authSubmitting ? 0.7 : 1 }}
              >
                {authSubmitting ? 'Please wait...' : 'Continue'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AuctionCard({
  listing,
  now,
  onBid,
  index = 0,
}: {
  listing: AuctionListing;
  now: number;
  onBid: () => void;
  index?: number;
}) {
  const countdown = formatCountdown(listing.endAt, now);
  const endingSoon = listing.endAt ? new Date(listing.endAt).getTime() - now < 1000 * 60 * 60 : false;
  const imageUrl = listing.images[0]?.url;

  return (
    <div
      className="auction-card"
      style={{ animationDelay: `${0.1 + index * 0.06}s` }}
    >
      <div className="card-media">
        {imageUrl ? <img src={imageUrl} alt={listing.title} /> : null}
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', display: 'flex', gap: '0.5rem' }}>
          <span className={`badge ${endingSoon ? 'ending' : 'live'}`}>{endingSoon ? 'Ending Soon' : 'Live'}</span>
          <span className="badge">Verified</span>
        </div>
      </div>
      <div className="card-body">
        <p className="card-meta">
          <span>{listing.pawnshop.name}</span> • <span>{listing.ticket.category || 'Luxury'}</span>
        </p>
        <h3 className="card-title">{listing.title}</h3>
        <div className="bid-row">
          <div>
            <div className="status-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.2rem' }}>
              Current Bid
            </div>
            <strong>{formatCurrency(listing.currentBid || listing.startingPrice)}</strong>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div>{countdown.label}</div>
            <div>
              {countdown.hours}h {countdown.minutes}m
            </div>
          </div>
        </div>
        <div className="cta-row">
          <Link to={`/listing/${listing.id}`} className="ghost-button">
            View Details
          </Link>
          <button className="ghost-button" onClick={onBid}>
            Place Bid
          </button>
        </div>
      </div>
    </div>
  );
}
