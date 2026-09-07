import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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

function useScrollReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .stagger-children');
    if (!elements.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useScrolled(threshold = 40) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

function AnimatedCounter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const animated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !animated.current) {
          animated.current = true;
          const duration = 2000;
          const start = performance.now();
          const step = (time: number) => {
            const elapsed = time - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            setCount(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return (
    <div ref={ref}>
      <div className="stat-number">
        {count.toLocaleString()}{suffix}
      </div>
    </div>
  );
}

export default function Home() {
  const { user, signIn, requestAuthCode, signUp, signOut, loading: authLoading, kycStatus } = useAuth();
  const { branding } = useBranding();
  const scrolled = useScrolled();
  useScrollReveal();

  const initialPawnshopId = useMemo(
    () => new URLSearchParams(window.location.search).get('pawnshopId'),
    [],
  );
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
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
  const [emailCheck, setEmailCheck] = useState<{ checking: boolean; exists: boolean; message: string }>({
    checking: false,
    exists: false,
    message: '',
  });
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkEmailAvailability = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) {
      setEmailCheck({ checking: false, exists: false, message: '' });
      return;
    }
    setEmailCheck((prev) => ({ ...prev, checking: true }));
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const res = await fetch(`${backendUrl}/auth/check-email?email=${encodeURIComponent(email)}&role=BIDDER`);
      const data = await res.json();
      setEmailCheck({ checking: false, exists: data.exists, message: data.exists ? data.message : '' });
    } catch {
      setEmailCheck({ checking: false, exists: false, message: '' });
    }
  }, []);

  useEffect(() => {
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    if (!authEmail || !authEmail.includes('@')) {
      setEmailCheck({ checking: false, exists: false, message: '' });
      return;
    }
    emailCheckTimer.current = setTimeout(() => {
      checkEmailAvailability(authEmail);
    }, 500);
    return () => {
      if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    };
  }, [authEmail, checkEmailAvailability]);

  const notifyError = (msg: string) => Swal.fire({ icon: 'error', title: 'Error', text: msg, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#F5F0E8' });
  const notifySuccess = (msg: string) => Swal.fire({ icon: 'success', title: 'Success', text: msg, confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#F5F0E8' });
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
        setNextCursor(data.nextCursor ?? null);
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

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchListings({ status: 'LIVE', limit: 12, cursor: nextCursor, pawnshopId: initialPawnshopId || undefined });
      setListings((prev) => [...prev, ...(data.items || [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, initialPawnshopId]);

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
      {/* ── NAVIGATION ── */}
      <header className={`top-bar ${scrolled ? 'scrolled' : ''}`}>
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
          <a href="#how-it-works">How It Works</a>
          <a href="#trust">Why Us</a>
        </nav>
        {user ? (
          <div className="auth-nav">
            {kycStatus === 'VERIFIED' ? (
              <span className="status-verified">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                Verified
              </span>
            ) : (
              <Link to="/profile" className="auth-nav-link" style={{ color: kycStatus === 'REJECTED' ? 'var(--red)' : 'var(--gold)' }}>
                {kycStatus === 'PENDING' ? 'KYC Pending' : kycStatus === 'REJECTED' ? 'KYC Rejected' : 'Verify ID'}
              </Link>
            )}
            <Link to="/my-bids" className="auth-nav-link" style={{ color: 'var(--text-secondary)' }}>
              My Bids
            </Link>
            <Link to="/my-winnings" className="auth-nav-link" style={{ color: 'var(--text-secondary)' }}>
              My Winnings
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

      {/* ── HERO SECTION ── */}
      <div className="hero-wrapper" id="home">
        <section className="hero">
          <div className="hero-content">
            <span className="hero-eyebrow">
              <span className="live-dot" />
              Live Auction
            </span>
            <h1 className="hero-title">
              Premium Pawn<br />
              <strong>Liquidation</strong>
            </h1>
            <p className="hero-copy">
              Bid on authenticated luxury items from verified pawnshops. Every piece
              authenticated, every auction secured, every bid synced in real time.
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
                <div className="hero-cta-row">
                  <Link to={`/listing/${featured.id}`} className="primary-button">
                    Place Bid Now
                  </Link>
                  <a href="#auctions" className="ghost-button">
                    View All
                  </a>
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
      </div>

      {/* ── STATS BAR ── */}
      <div className="stats-bar reveal">
        <div className="stat-item">
          <AnimatedCounter target={listings.length || 0} suffix="+" />
          <div className="stat-label">Live Auctions</div>
        </div>
        <div className="stat-item">
          <AnimatedCounter target={pawnshops.length || 0} suffix="+" />
          <div className="stat-label">Verified Pawnshops</div>
        </div>
        <div className="stat-item">
          <AnimatedCounter target={98} suffix="%" />
          <div className="stat-label">Satisfaction Rate</div>
        </div>
        <div className="stat-item">
          <AnimatedCounter target={24} suffix="/7" />
          <div className="stat-label">Bidding Support</div>
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="section-padding">
        <div className="reveal" style={{ textAlign: 'center' }}>
          <div className="section-eyebrow">Simple Process</div>
          <h2 className="section-title">How It Works</h2>
          <p className="section-subtitle" style={{ maxWidth: 500, margin: '0.4rem auto 0' }}>
            Three steps to secure your next treasure from verified pawnshops
          </p>
        </div>
        <div className="how-it-works stagger-children">
          <div className="how-step">
            <div className="how-step-number">01</div>
            <div className="how-step-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <h3>Create & Verify</h3>
            <p>Sign up with your email and complete quick ID verification. Our KYC process ensures a trusted marketplace for everyone.</p>
          </div>
          <div className="how-step">
            <div className="how-step-number">02</div>
            <div className="how-step-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            <h3>Browse & Bid</h3>
            <p>Explore curated auctions from authenticated pawnshops. Place real-time bids with automatic last-minute extensions.</p>
          </div>
          <div className="how-step">
            <div className="how-step-number">03</div>
            <div className="how-step-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <h3>Win & Collect</h3>
            <p>Win an auction and complete secure checkout with escrow protection. Sign your contract and collect your authenticated item.</p>
          </div>
        </div>
      </section>

      {/* ── LIVE AUCTIONS ── */}
      <section id="auctions" className="section-padding">
        <div className="section-header reveal">
          <div>
            <div className="section-eyebrow">Live Now</div>
            <h2 className="section-title">Active Auctions</h2>
            <p className="section-subtitle">{filteredListings.length} exclusive items available</p>
          </div>
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search lots, ticket numbers, or designers..."
          />
        </div>

        <div className="filters reveal" style={{ marginTop: '0.5rem' }}>
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

        <div className="filter-row reveal">
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
          <div className="auction-grid" style={{ marginTop: '2rem' }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} style={{ borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
                <div className="skeleton" style={{ height: 220 }} />
                <div style={{ padding: '1.4rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="skeleton" style={{ height: 14, width: '40%' }} />
                  <div className="skeleton" style={{ height: 20, width: '70%' }} />
                  <div className="skeleton" style={{ height: 14, width: '55%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="status-error" style={{ marginTop: '2rem' }}>{error}</p>
        ) : (
          <>
            <div className="auction-grid stagger-children" style={{ marginTop: '2rem' }}>
              {filteredListings.map((listing) => (
                <AuctionCard key={listing.id} listing={listing} now={now} onBid={() => { if (!user) setLoginOpen(true); }} />
              ))}
            </div>
            {filteredListings.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>No auctions match your filters</p>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Try adjusting your search or filter criteria</p>
              </div>
            )}
            {nextCursor && !search && pawnshopFilter === 'all' && categoryFilter === 'all' && (
              <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
                <button
                  className="ghost-button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ padding: '0.7rem 2.5rem' }}
                >
                  {loadingMore ? 'Loading...' : 'Load More Auctions'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── TRUST / WHY US ── */}
      <section id="trust" className="section-padding">
        <div className="reveal" style={{ textAlign: 'center' }}>
          <div className="section-eyebrow">Why Choose Us</div>
          <h2 className="section-title">Trusted by Thousands</h2>
          <p className="section-subtitle" style={{ maxWidth: 500, margin: '0.4rem auto 0' }}>
            Every auction backed by verification, security, and transparent processes
          </p>
        </div>
        <div className="trust-grid stagger-children">
          <div className="trust-card">
            <div className="trust-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <h4>Verified Items</h4>
            <p>Every item undergoes rigorous authentication by certified pawnshop professionals before listing.</p>
          </div>
          <div className="trust-card">
            <div className="trust-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <h4>Secure Escrow</h4>
            <p>Payments held in escrow until you receive and verify your item. Full buyer protection on every transaction.</p>
          </div>
          <div className="trust-card">
            <div className="trust-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h4>Real-Time Bidding</h4>
            <p>Live bid synchronization across all participants with automatic time extensions on last-minute bids.</p>
          </div>
          <div className="trust-card">
            <div className="trust-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <h4>Digital Contracts</h4>
            <p>Every winning bid generates a legally binding contract with digital signatures and complete audit trail.</p>
          </div>
          <div className="trust-card">
            <div className="trust-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <h4>Verified Network</h4>
            <p>Connected to a trusted network of licensed pawnshops with full compliance documentation and KYC.</p>
          </div>
          <div className="trust-card">
            <div className="trust-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <h4>Secure Payments</h4>
            <p>Integrated PayMongo payment processing with full receipt generation and transaction history.</p>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="section-padding reveal">
        <div style={{
          background: 'linear-gradient(135deg, rgba(201, 160, 92, 0.08), rgba(139, 94, 60, 0.05))',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'clamp(2.5rem, 5vw, 4rem)',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent, var(--gold), transparent)',
          }} />
          <h2 className="section-title" style={{ marginBottom: '0.5rem' }}>
            Ready to Start Bidding?
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', maxWidth: 480, margin: '0 auto 1.5rem', lineHeight: 1.7 }}>
            Join thousands of bidders who trust PawnGold for authenticated luxury auctions. Create your free account today.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {user ? (
              <a href="#auctions" className="primary-button" style={{ padding: '0.8rem 2rem', fontSize: '0.9rem' }}>
                Browse Auctions
              </a>
            ) : (
              <>
                <button className="primary-button" onClick={() => { setLoginOpen(true); setAuthTab('signup'); }} style={{ padding: '0.8rem 2rem', fontSize: '0.9rem' }}>
                  Create Free Account
                </button>
                <button className="ghost-button" onClick={() => { setLoginOpen(true); setAuthTab('login'); }} style={{ padding: '0.8rem 2rem', fontSize: '0.9rem' }}>
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer-section">
        <div className="footer">
          <div className="footer-brand">
            <div className="footer-brand-name">
              {branding?.name || 'PawnGold'} <span>Auction House</span>
            </div>
            <p>
              The Philippines' premier online auction platform for authenticated luxury items from verified pawnshops.
            </p>
          </div>
          <div className="footer-col">
            <h4>Platform</h4>
            <ul>
              <li><a href="#auctions">Live Auctions</a></li>
              <li><a href="#how-it-works">How It Works</a></li>
              <li><a href="#trust">Why PawnGold</a></li>
              <li><Link to="/terms">Terms of Service</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Account</h4>
            <ul>
              <li><Link to="/profile">My Profile</Link></li>
              <li><Link to="/my-bids">My Bids</Link></li>
              <li><Link to="/my-winnings">My Winnings</Link></li>
              <li><Link to="/kyc">ID Verification</Link></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Support</h4>
            <ul>
              <li><a href="mailto:support@pawngold.com">Contact Us</a></li>
              <li><a href="#how-it-works">Bidder Guide</a></li>
              <li><a href="#trust">Trust & Safety</a></li>
              <li><a href="#">FAQ</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} {branding?.name || 'PawnGold'}. All rights reserved.</p>
          <div className="footer-bottom-links">
            <Link to="/terms">Terms</Link>
            <a href="#">Privacy</a>
            <a href="#">Cookies</a>
          </div>
        </div>
      </footer>

      {/* ── AUTH MODAL ── */}
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
                  if (emailCheck.exists) {
                    notifyError('This email is already registered. Please use a different email or sign in.');
                    return;
                  }

                  const { isConfirmed } = await Swal.fire({
                    title: 'Confirm Registration',
                    text: 'Create your bidder account now?',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#C9A05C',
                    cancelButtonColor: '#8A8279',
                    confirmButtonText: 'Yes, Create Account',
                    cancelButtonText: 'Cancel',
                    background: '#1C1C26',
                    color: '#F5F0E8',
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
              {emailCheck.checking && (
                <p style={{ fontSize: '0.7rem', color: '#9A917F', margin: '-0.25rem 0' }}>Checking email...</p>
              )}
              {!emailCheck.checking && emailCheck.exists && (
                <p style={{ fontSize: '0.75rem', color: '#D44545', background: 'rgba(212,69,69,0.1)', border: '1px solid rgba(212,69,69,0.2)', borderRadius: '8px', padding: '0.5rem 0.75rem', margin: '-0.25rem 0' }}>
                  {emailCheck.message || 'This email is already registered. Please use a different email or sign in.'}
                </p>
              )}
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
}: {
  listing: AuctionListing;
  now: number;
  onBid: () => void;
}) {
  const countdown = formatCountdown(listing.endAt, now);
  const endingSoon = listing.endAt ? new Date(listing.endAt).getTime() - now < 1000 * 60 * 60 : false;
  const imageUrl = listing.images[0]?.url;

  return (
    <div className="auction-card">
      <div className="card-media">
        {imageUrl ? <img src={imageUrl} alt={listing.title} loading="lazy" /> : null}
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', display: 'flex', gap: '0.5rem', zIndex: 2 }}>
          <span className={`badge ${endingSoon ? 'ending' : 'live'}`}>{endingSoon ? 'Ending Soon' : 'Live'}</span>
          <span className="badge">Verified</span>
        </div>
        <div className="card-overlay">
          <Link to={`/listing/${listing.id}`} className="primary-button" style={{ width: '100%', textAlign: 'center', padding: '0.6rem', fontSize: '0.8rem' }}>
            Quick View
          </Link>
        </div>
      </div>
      <div className="card-body">
        <p className="card-meta">
          <span>{listing.pawnshop.name}</span> &middot; <span>{listing.ticket.category || 'Luxury'}</span>
        </p>
        <h3 className="card-title">{listing.title}</h3>
        <div className="bid-row">
          <div>
            <div className="status-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.2rem', fontSize: '0.65rem' }}>
              Current Bid
            </div>
            <strong>{formatCurrency(listing.currentBid || listing.startingPrice)}</strong>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.15rem' }}>{countdown.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.95rem', color: endingSoon ? 'var(--red)' : 'var(--text-secondary)' }}>
              {countdown.hours}:{countdown.minutes}:{countdown.seconds}
            </div>
          </div>
        </div>
        <div className="cta-row">
          <Link to={`/listing/${listing.id}`} className="ghost-button" style={{ flex: 1, textAlign: 'center' }}>
            View Details
          </Link>
          <button className="primary-button" onClick={onBid} style={{ flex: 1 }}>
            Place Bid
          </button>
        </div>
      </div>
    </div>
  );
}
