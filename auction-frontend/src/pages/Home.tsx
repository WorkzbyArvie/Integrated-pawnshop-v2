import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useBranding } from '../context/BrandingContext';
import { Link } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  ArrowRight,
  SealCheck,
  CaretLeft,
  CaretRight,
  CreditCard,
  FileText,
  Fingerprint,
  Gavel,
  IdentificationBadge,
  LockKey,
  MagnifyingGlass,
  Package,
  Pulse,
  WifiSlash,
} from '@phosphor-icons/react';
import '../App.css';
import '../home.css';
import type { AuctionListing } from '../types';
import { fetchListings } from '../services/auctionApi';
import { useAuth } from '../context/AuthContext';
import { getBackendUrl } from '../lib/backendUrl';

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

function useReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.home-reveal'));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      elements.forEach((el) => el.classList.add('visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sentinel = document.getElementById('home-scroll-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  return scrolled;
}

function StatNumber({ target, suffix = '' }: { target: number; suffix?: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const finalText = `${target.toLocaleString()}${suffix}`;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      el.textContent = finalText;
      return;
    }
    const duration = 1600;
    const start = performance.now();
    let raf = 0;
    const step = (time: number) => {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = `${Math.floor(eased * target).toLocaleString()}${suffix}`;
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        el.textContent = finalText;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, suffix]);
  return (
    <span ref={spanRef} className="home-stat-number" aria-label={`${target}${suffix}`}>
      {`${target.toLocaleString()}${suffix}`}
    </span>
  );
}

const HOW_STEPS = [
  {
    title: 'Create & verify',
    icon: <IdentificationBadge size={22} weight="regular" />,
    body: 'Open a bidder account and pass ID verification so every participant is a real person.',
  },
  {
    title: 'Browse & bid',
    icon: <Gavel size={22} weight="regular" />,
    body: 'Explore verified lots and place real-time bids with automatic extensions near the close.',
  },
  {
    title: 'Win & collect',
    icon: <Package size={22} weight="regular" />,
    body: 'Pay through escrow, sign your digital contract, and collect your authenticated item.',
  },
];

const TRUST_CELLS = [
  {
    title: 'Verified items',
    icon: <SealCheck size={20} weight="regular" />,
    body: 'Every lot is appraised and authenticated by licensed pawnshops before it goes live.',
    tone: 'image' as const,
  },
  {
    title: 'Secure escrow',
    icon: <LockKey size={20} weight="regular" />,
    body: 'Payments are held in escrow until you receive and verify your item.',
    tone: 'tint' as const,
  },
  {
    title: 'Real-time bidding',
    icon: <Pulse size={20} weight="regular" />,
    body: 'Bids sync across the room with automatic extensions on last-minute offers.',
    tone: 'plain' as const,
  },
  {
    title: 'Digital contracts',
    icon: <FileText size={20} weight="regular" />,
    body: 'Every winning bid generates a signed contract and a receipt you can download.',
    tone: 'plain' as const,
  },
  {
    title: 'KYC bidders',
    icon: <Fingerprint size={20} weight="regular" />,
    body: 'ID verification keeps phantom bidders out of every auction.',
    tone: 'tint' as const,
  },
  {
    title: 'Secure payments',
    icon: <CreditCard size={20} weight="regular" />,
    body: 'PayMongo checkout with full receipts and transaction history.',
    tone: 'image' as const,
  },
];

export default function Home() {
  const { user, signIn, requestAuthCode, signUp, signOut, loading: authLoading, kycStatus } = useAuth();
  const { branding } = useBranding();
  const scrolled = useScrolled();
  useReveal();

  const initialPawnshopId = useMemo(
    () => new URLSearchParams(window.location.search).get('pawnshopId') ?? undefined,
    [],
  );
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [emailCheck, setEmailCheck] = useState<{ checking: boolean; exists: boolean; message: string }>({
    checking: false,
    exists: false,
    message: '',
  });
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openLogin = (tab: 'login' | 'signup') => {
    setLoginOpen(true);
    setAuthTab(tab);
  };

  const checkEmailAvailability = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) {
      setEmailCheck({ checking: false, exists: false, message: '' });
      return;
    }
    setEmailCheck((prev) => ({ ...prev, checking: true }));
    try {
      const res = await fetch(`${getBackendUrl()}/auth/check-email?email=${encodeURIComponent(email)}&role=BIDDER`);
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
    setError(null);
    fetchListings({ status: 'LIVE', limit: 12, pawnshopId: initialPawnshopId })
      .then((data) => {
        if (!mounted) return;
        setListings(data.items || []);
        setNextCursor(data.nextCursor ?? null);
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
  }, [initialPawnshopId, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchListings({ status: 'LIVE', limit: 12, cursor: nextCursor, pawnshopId: initialPawnshopId });
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

  const bentoMedia = useMemo(() => {
    const urls = listings
      .slice(1, 4)
      .map((listing) => listing.images[0]?.url)
      .filter((url): url is string => Boolean(url));
    return { first: urls[0] ?? null, second: urls[1] ?? null };
  }, [listings]);

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
      <div id="home-scroll-sentinel" className="home-sentinel" aria-hidden="true" />

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
          <button className="primary-button" onClick={() => openLogin('login')}>
            Sign In
          </button>
        )}
      </header>

      {/* ── HERO ── */}
      <section className="home-hero" id="home">
        <div className="home-hero-inner">
          <div className="home-reveal">
            <span className="home-eyebrow">
              <span className="eyebrow-dot" />
              Live auctions
            </span>
            <h1 className="home-headline">
              Authenticated lots.
              <strong>Live bidding.</strong>
            </h1>
            <p className="home-subtext">
              Winning bids on verified items from licensed pawnshops, with escrow
              payments and a digital contract on every win.
            </p>
            <div className="home-hero-actions">
              <a href="#auctions" className="primary-button">
                Browse live auctions
              </a>
              <a href="#how-it-works" className="ghost-button">
                How bidding works
              </a>
            </div>
          </div>

          <div className="home-feature home-reveal" aria-live="polite">
            {loading ? (
              <div className="home-feature-skeleton">
                <div className="skeleton" style={{ height: 18, width: '40%' }} />
                <div className="skeleton" style={{ height: 26, width: '70%' }} />
                <div className="skeleton" style={{ height: 20, width: '50%' }} />
              </div>
            ) : error || !featured ? (
              <div className="home-feature-empty" data-tone={error ? 'error' : 'plain'}>
                <WifiSlash size={34} className="empty-icon" />
                <h3>{error ? 'Live catalog unavailable' : 'No live lots right now'}</h3>
                <p>
                  {error
                    ? 'We could not reach the auction service. Try again in a moment.'
                    : 'New lots are published regularly. Check back soon.'}
                </p>
                {error ? (
                  <button className="ghost-button" onClick={() => setReloadKey((key) => key + 1)}>
                    Retry
                  </button>
                ) : null}
              </div>
            ) : featured && featuredImageUrl && featuredCountdown ? (
              <>
                <img
                  src={featuredImageUrl}
                  alt={featured.title}
                  className="home-feature-media"
                  fetchPriority="high"
                />
                <div className="home-feature-status">
                  <span className="badge live">Live</span>
                </div>
                {featuredImages.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="slider-nav slider-nav-prev"
                      aria-label="Show previous featured image"
                      onClick={() => setFeaturedImageIndex((current) => (current - 1 + featuredImages.length) % featuredImages.length)}
                    >
                      <CaretLeft size={18} weight="bold" />
                    </button>
                    <button
                      type="button"
                      className="slider-nav slider-nav-next"
                      aria-label="Show next featured image"
                      onClick={() => setFeaturedImageIndex((current) => (current + 1) % featuredImages.length)}
                    >
                      <CaretRight size={18} weight="bold" />
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
                <div className="home-feature-caption">
                  <h2 className="home-feature-title">{featured.title}</h2>
                  <div className="home-feature-bid">
                    <span className="home-feature-price">
                      {formatCurrency(featured.currentBid || featured.startingPrice)}
                    </span>
                    <div className="home-feature-count" aria-label={featuredCountdown.label}>
                      <div className="home-feature-count-unit">
                        <b>{featuredCountdown.hours}</b>
                        <span>Hours</span>
                      </div>
                      <div className="home-feature-count-unit">
                        <b>{featuredCountdown.minutes}</b>
                        <span>Min</span>
                      </div>
                      <div className="home-feature-count-unit">
                        <b>{featuredCountdown.seconds}</b>
                        <span>Sec</span>
                      </div>
                    </div>
                  </div>
                  <div className="home-feature-actions">
                    <Link to={`/listing/${featured.id}`} className="home-feature-link">
                      View this lot
                      <ArrowRight size={16} weight="bold" />
                    </Link>
                  </div>
                </div>
              </>
            ) : (
              <div className="home-feature-empty">
                <MagnifyingGlass size={34} className="empty-icon" />
                <h3>No live lots right now</h3>
                <p>New lots are published regularly. Check back soon.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── STATS (real data only) ── */}
      <div className="home-stats home-reveal">
        <div className="home-stat">
          <StatNumber target={listings.length} suffix="+" />
          <span className="home-stat-label">Live auctions</span>
        </div>
        <div className="home-stat">
          <StatNumber target={pawnshops.length} />
          <span className="home-stat-label">Verified pawnshops</span>
        </div>
        <div className="home-stat">
          <StatNumber target={categories.length} />
          <span className="home-stat-label">Categories</span>
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="home-how">
        <div className="home-how-head home-reveal">
          <h2 className="home-how-title">From verification to your doorstep.</h2>
          <p className="home-how-copy">
            A straight path from your first bid to a collected item, with proof at every step.
          </p>
        </div>
        <div className="home-how-steps">
          {HOW_STEPS.map((step) => (
            <div className="home-how-step home-reveal" key={step.title}>
              <div className="home-how-step-icon" aria-hidden="true">
                {step.icon}
              </div>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── LIVE AUCTIONS ── */}
      <section id="auctions" className="home-catalog">
        <div className="home-reveal">
          <h2 className="home-catalog-title">Active Auctions</h2>
          <p className="home-catalog-sub">
            {loading ? 'Loading live lots...' : error ? 'Some live lots are unavailable right now.' : `${filteredListings.length} lots live now`}
          </p>
        </div>

        <div className="home-catalog-toolbar home-reveal">
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search lots, ticket numbers, or designers..."
            aria-label="Search live lots"
          />
        </div>

        <div className="home-catalog-filters home-reveal">
          <div className="filters">
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
          <div className="filter-row">
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
          <div className="home-catalog-error">
            <WifiSlash size={34} className="empty-icon" />
            <h3>Live catalog unavailable</h3>
            <p>We could not reach the auction service. Your bids and history are not affected.</p>
            <button className="ghost-button" style={{ marginTop: '1.2rem' }} onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {filteredListings.length === 0 ? (
              <div className="home-catalog-empty">
                <MagnifyingGlass size={34} className="empty-icon" />
                <h3>No auctions match your filters</h3>
                <p>Try adjusting your search or filter criteria.</p>
              </div>
            ) : (
              <div className="auction-grid" style={{ marginTop: '2rem' }}>
                {filteredListings.map((listing) => (
                  <AuctionCard key={listing.id} listing={listing} now={now} onBid={() => { if (!user) openLogin('login'); }} />
                ))}
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

      {/* ── WHY BIDDERS TRUST US ── */}
      <section id="trust" className="home-guarantees">
        <div className="home-reveal">
          <h2 className="home-catalog-title">Built for trust.</h2>
          <p className="home-catalog-sub">
            Every auction runs on checks, contracts, and receipts you can trace.
          </p>
        </div>
        <div className="home-bento" style={{ marginTop: '2rem' }}>
          {TRUST_CELLS.map((cell, index) => {
            const mediaUrl = index === 0 ? bentoMedia.first : index === 5 ? bentoMedia.second : null;
            return (
              <div
                key={cell.title}
                className={`bento-cell home-reveal ${index === 0 || index === 5 ? 'span2' : ''}`}
                data-tone={cell.tone === 'image' && !mediaUrl ? 'tint' : cell.tone}
              >
                {mediaUrl ? (
                  <>
                    <img src={mediaUrl} alt="" loading="lazy" className="bento-media" />
                    <div className="bento-scrim" />
                  </>
                ) : null}
                <div className="bento-icon" aria-hidden="true">
                  {cell.icon}
                </div>
                <h3>{cell.title}</h3>
                <p>{cell.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="home-cta home-reveal">
        <div className="home-cta-inner">
          <h2 className="home-cta-title">Ready to place a bid?</h2>
          <p className="home-cta-copy">Create a free bidder account and take part in your first live auction.</p>
          <div className="home-cta-actions">
            {user ? (
              <a href="#auctions" className="primary-button">
                Browse live auctions
              </a>
            ) : (
              <button className="primary-button" onClick={() => openLogin('signup')}>
                Create free account
              </button>
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
              An online auction platform for authenticated items from paired pawnshop partners.
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
            <Link to="/privacy">Privacy</Link>
            <Link to="/cookies">Cookies</Link>
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
                onClick={() => { setAuthTab('login'); setAcceptedTerms(false); }}
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
                  if (!acceptedTerms) {
                    notifyError('You must agree to the Terms of Service and Privacy Policy to create an account.');
                    return;
                  }
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
                  aria-label="Full name"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  required
                />
              )}
              <input
                placeholder="Email address"
                aria-label="Email address"
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
                aria-label="Password"
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
                      aria-label="Authentication code"
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

              {authTab === 'signup' && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    fontSize: '0.75rem',
                    color: '#B8B0A4',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    style={{ marginTop: '0.15rem', accentColor: '#C9A05C' }}
                    required
                  />
                  <span>
                    I have read and agree to the{' '}
                    <Link to="/terms" style={{ color: '#C9A05C', textDecoration: 'underline' }}>Terms of Service</Link>{' '}
                    and{' '}
                    <Link to="/privacy" style={{ color: '#C9A05C', textDecoration: 'underline' }}>Privacy Policy</Link>.
                  </span>
                </label>
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
        {imageUrl ? (
          <Link to={`/listing/${listing.id}`} aria-label={listing.title}>
            <img src={imageUrl} alt={listing.title} loading="lazy" />
          </Link>
        ) : null}
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 2 }}>
          <span className={`badge ${endingSoon ? 'ending' : 'live'}`}>{endingSoon ? 'Ending Soon' : 'Live'}</span>
        </div>
      </div>
      <div className="card-body">
        <div className="home-card-meta">
          <span className="home-card-meta">{listing.pawnshop.name}</span>
          <span className="home-card-category">{listing.ticket.category || listing.category?.name || 'Luxury'}</span>
        </div>
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