import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  Gavel,
  Lock,
  MessageSquare,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  UserRoundPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import api from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

type BackendPlan = {
  tier: 'FREE' | 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
  name: string;
  description: string;
  monthlyPrice: number;
  features: Record<string, boolean>;
  limits: {
    max_branches: number | null;
    max_staff: number | null;
    max_transactions: number | null;
  };
};

const MODULE_CARDS = [
  {
    title: 'Pawn Transactions',
    description:
      'Streamlined pawn, renewal, and redemption workflows with automated calculations.',
    icon: Wallet,
  },
  {
    title: 'Inventory Management',
    description:
      'Track items, manage stock levels, and handle multi-location inventories.',
    icon: Building2,
  },
  {
    title: 'Appraisal System',
    description:
      'Built-in valuation tools with historical pricing data and market insights.',
    icon: TrendingUp,
  },
  {
    title: 'Reports & Analytics',
    description:
      'Comprehensive dashboards with real-time insights and custom reporting.',
    icon: BarChart3,
  },
  {
    title: 'Staff & Role Management',
    description:
      'Complete RBAC system with granular permissions and audit trails.',
    icon: Users,
  },
  {
    title: 'Subscription & Billing',
    description:
      'Flexible subscription management with automated billing and invoicing.',
    icon: CreditCard,
  },
  {
    title: 'Live Bidding / Auction',
    description:
      'Integrated auction platform for unclaimed items with real-time bidding.',
    icon: Gavel,
  },
  {
    title: 'Communication & Support',
    description:
      'Built-in customer messaging, notifications, and ticketing system.',
    icon: MessageSquare,
  },
];

const PLAN_ROWS = [
  {
    key: 'basic',
    title: 'Basic',
    subtitle: 'Perfect for single-location pawnshops',
    price: '$49',
    period: '/month',
    bullets: [
      'Up to 1 branch location',
      'Basic pawn transactions',
      'Inventory management',
      'Standard reporting',
      '5 staff accounts',
      'Email support',
    ],
    cta: 'Start Free Trial',
  },
  {
    key: 'professional',
    title: 'Professional',
    subtitle: 'For growing multi-branch operations',
    price: '$149',
    period: '/month',
    bullets: [
      'Up to 5 branch locations',
      'Advanced transactions & renewals',
      'Full inventory & appraisal system',
      'Advanced analytics & reports',
      'Unlimited staff accounts',
      'Live bidding & auction module',
      'Priority support',
      'Custom branding',
    ],
    cta: 'Start Free Trial',
  },
  {
    key: 'enterprise',
    title: 'Enterprise',
    subtitle: 'For large-scale operations',
    price: 'Custom',
    period: '',
    bullets: [
      'Unlimited branch locations',
      'All Professional features',
      'Dedicated account manager',
      'Custom integrations',
      'API access',
      'White-label options',
      '24/7 phone support',
      'SLA guarantee',
    ],
    cta: 'Contact Sales',
  },
];

const TESTIMONIALS = [
  {
    initials: 'MR',
    name: 'Michael Rodriguez',
    role: 'Owner, Golden Valley Pawn',
    quote:
      'PawnGold transformed how we manage our three locations. The real-time inventory sync alone has saved us countless hours.',
  },
  {
    initials: 'SC',
    name: 'Sarah Chen',
    role: 'Operations Manager, QuickCash Pawnshop',
    quote:
      'The appraisal system and automated reporting have made our business much more efficient. Customer service is excellent.',
  },
  {
    initials: 'DT',
    name: 'David Thompson',
    role: 'Founder, Premier Pawn Group',
    quote:
      'The security features and role-based access give us complete peace of mind across all our locations.',
  },
];

const FAQ_ITEMS = [
  {
    question: 'How long does onboarding take?',
    answer:
      'Most pawnshops go live within 24 to 72 hours depending on staff setup and module selection.',
  },
  {
    question: 'Can I start with one branch and expand later?',
    answer:
      'Yes. You can start with a single branch and upgrade your plan as your operations grow.',
  },
  {
    question: 'Is my data isolated from other pawnshops?',
    answer:
      'Yes. PawnGold uses strict multi-tenant isolation, role controls, and audited administrative access.',
  },
  {
    question: 'Do you support data migration from my current system?',
    answer:
      'Yes. Our onboarding team can assist with migration templates and guided import during setup.',
  },
];

const HERO_STATS = [
  { label: 'Active Pawnshops', value: '240+' },
  { label: 'Average Onboarding', value: '48 Hours' },
  { label: 'Platform Uptime', value: '99.9%' },
];

const AUCTION_URL = import.meta.env.VITE_AUCTION_URL || 'http://localhost:5174';

const HEADER_LINKS: Array<{ href: string; label: string; external?: boolean; url?: string }> = [
  { href: '#home', label: 'Home' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#security', label: 'Security' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'Contact' },
  { href: 'auction', label: 'Auction House', external: true, url: AUCTION_URL },
];

export default function LandingPage() {
  const [showModal, setShowModal] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [plansFromApi, setPlansFromApi] = useState<BackendPlan[] | null>(null);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [authStep, setAuthStep] = useState<'form' | 'otp'>('form');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpSentTo, setOtpSentTo] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [authForm, setAuthForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    document.documentElement.classList.add('landing-scroll');
    document.body.classList.add('landing-scroll');

    const nodes = document.querySelectorAll<HTMLElement>('.reveal');
    const sectionIds = HEADER_LINKS.filter((link) => !link.external).map((link) => link.href.replace('#', ''));
    const sectionNodes = sectionIds
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.14 },
    );

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target?.id) {
          setActiveSection(visible.target.id);
        }
      },
      { threshold: [0.25, 0.5, 0.75] },
    );

    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setScrollProgress(Math.min(100, Math.max(0, progress)));
    };

    nodes.forEach((node) => observer.observe(node));
    sectionNodes.forEach((node) => sectionObserver.observe(node));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      document.documentElement.classList.remove('landing-scroll');
      document.body.classList.remove('landing-scroll');
      observer.disconnect();
      sectionObserver.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const syncOwnerSessionContext = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      setOwnerUserId(null);
      return;
    }

    const ownerEmail = session.user.email ?? '';
    const ownerName =
      (session.user.user_metadata?.full_name as string | undefined) ||
      (session.user.user_metadata?.name as string | undefined) ||
      '';

    setOwnerUserId(session.user.id);
    setAuthForm((prev) => ({
      ...prev,
      email: prev.email || ownerEmail,
      fullName: prev.fullName || ownerName,
    }));
  };

  useEffect(() => {
    syncOwnerSessionContext().catch(() => {
      setOwnerUserId(null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      syncOwnerSessionContext().catch(() => {
        setOwnerUserId(null);
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .get<BackendPlan[]>('/subscriptions/plans')
      .then((rows) => {
        if (!mounted) return;
        setPlansFromApi(Array.isArray(rows) ? rows : null);
      })
      .catch(() => {
        if (!mounted) return;
        setPlansFromApi(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  const pricingCards = useMemo(() => {
    if (!plansFromApi || plansFromApi.length === 0) {
      return PLAN_ROWS;
    }

    const order = ['BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
    return plansFromApi
      .filter((row) => order.includes(row.tier))
      .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
      .map((row) => {
        const featureBullets = Object.entries(row.features || {})
          .filter(([, enabled]) => enabled)
          .map(([name]) => name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

        const limitsBullets = [
          `Branches: ${row.limits?.max_branches === null ? 'Unlimited' : row.limits?.max_branches}`,
          `Staff: ${row.limits?.max_staff === null ? 'Unlimited' : row.limits?.max_staff}`,
          `Transactions: ${row.limits?.max_transactions === null ? 'Unlimited' : row.limits?.max_transactions}`,
        ];

        const key = row.tier.toLowerCase();
        return {
          key,
          title: row.name,
          subtitle: row.description,
          price: row.monthlyPrice > 0 ? `PHP ${row.monthlyPrice.toLocaleString('en-PH')}` : 'Free',
          period: row.monthlyPrice > 0 ? '/month' : '',
          bullets: [...limitsBullets, ...featureBullets].slice(0, 10),
          cta: row.tier === 'ENTERPRISE' ? 'Contact Sales' : 'Start Free Trial',
        };
      });
  }, [plansFromApi]);

  const scrollToSection = (href: string) => {
    const targetId = href.replace('#', '');
    const target = document.getElementById(targetId);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openModal = () => {
    setAuthError(null);
    setAuthMessage(null);
    setAuthStep('form');
    setOtpCode('');
    setResendTimer(0);
    syncOwnerSessionContext().catch(() => {
      setOwnerUserId(null);
    });
    setShowModal(true);
  };

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setAuthMessage(null);

    if (authMode === 'signin') {
      if (!authForm.email || !authForm.password) {
        setAuthError('Email and password are required.');
        return;
      }
      setAuthSubmitting(true);
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (signInError) throw signInError;
        setAuthMessage('Signed in successfully.');
        await syncOwnerSessionContext();
      } catch (err: unknown) {
        setAuthError((err instanceof Error ? err.message : String(err)) || 'Sign in failed.');
      } finally {
        setAuthSubmitting(false);
      }
      return;
    }

    if (!authForm.fullName || !authForm.email || !authForm.password) {
      setAuthError('All fields are required.');
      return;
    }
    if (authForm.password.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }
    if (authForm.password !== authForm.confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const res = await fetch(`${backendUrl}/auth/request-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email, purpose: 'OWNER_REGISTRATION' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send verification code');

      setOtpSentTo(authForm.email);
      setAuthStep('otp');
      setResendTimer(60);
      setAuthMessage(`A 6-digit code was sent to ${authForm.email}.`);
    } catch (err: unknown) {
      setAuthError((err instanceof Error ? err.message : String(err)) || 'Failed to send code.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setAuthMessage(null);

    if (!otpCode || otpCode.length !== 6) {
      setAuthError('Enter the 6-digit code.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

      const verifyRes = await fetch(`${backendUrl}/auth/verify-auth-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: authForm.email,
          purpose: 'OWNER_REGISTRATION',
          auth_code: otpCode,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.message || 'Invalid or expired code');

      const verifyPayload = verifyData.data || verifyData;

      const registerRes = await fetch(`${backendUrl}/auth/register-owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authForm.email,
          password: authForm.password,
          full_name: authForm.fullName,
          verification_token: verifyPayload.verificationToken,
          purpose: 'OWNER_REGISTRATION',
        }),
      });
      const registerData = await registerRes.json();
      if (!registerRes.ok) throw new Error(registerData.message || 'Registration failed');

      const regPayload = registerData.data || registerData;

      if (regPayload.session?.access_token) {
        localStorage.setItem('auth_token', regPayload.session.access_token);
        localStorage.setItem('auth_refresh_token', regPayload.session.refresh_token);
      }

      await supabase.auth.signInWithPassword({
        email: authForm.email,
        password: authForm.password,
      });

      setAuthMessage('Account created successfully. Continue to submit your trial request.');
      await syncOwnerSessionContext();
      setAuthStep('form');
    } catch (err: unknown) {
      setAuthError((err instanceof Error ? err.message : String(err)) || 'Verification failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (resendTimer > 0) return;
    setAuthError(null);
    setAuthMessage(null);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const res = await fetch(`${backendUrl}/auth/request-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email, purpose: 'OWNER_REGISTRATION' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to resend code');
      setResendTimer(60);
      setAuthMessage(`A new 6-digit code was sent to ${authForm.email}.`);
    } catch (err: unknown) {
      setAuthError((err instanceof Error ? err.message : String(err)) || 'Failed to resend code.');
    }
  };

  const handleOwnerSignOut = async () => {
    await supabase.auth.signOut();
    setOwnerUserId(null);
    setAuthMessage('Signed out. Sign in with the owner account to continue.');
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
      <style>{`
        html { scroll-behavior: smooth; }
        html.landing-scroll,
        body.landing-scroll,
        html.landing-scroll body,
        html.landing-scroll body #root {
          height: auto !important;
          min-height: 100%;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }
        .reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.55s cubic-bezier(0.16,1,0.3,1), transform 0.55s cubic-bezier(0.16,1,0.3,1); }
        .reveal.is-visible { opacity: 1; transform: translateY(0); }
        .lp-card {
          background: linear-gradient(160deg, rgba(28,28,38,0.96) 0%, rgba(20,20,27,0.98) 100%);
          border: 1px solid rgba(201,160,92,0.13);
          box-shadow: 0 0 0 1px rgba(201,160,92,0.05) inset, 0 8px 32px rgba(0,0,0,0.3);
          transition: transform 0.25s cubic-bezier(0.16,1,0.3,1), box-shadow 0.25s ease;
        }
        .lp-card:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px rgba(201,160,92,0.08) inset, 0 16px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(201,160,92,0.15); }
      `}</style>

      {/* HEADER */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: 'rgba(10,10,15,0.88)',
          borderBottom: '1px solid rgba(201,160,92,0.08)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="h-[2px]" style={{ background: 'rgba(201,160,92,0.06)' }}>
          <div className="h-full transition-all duration-150" style={{ width: `${scrollProgress}%`, background: 'var(--gold)' }} />
        </div>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'rgba(201,160,92,0.12)', border: '1px solid rgba(201,160,92,0.2)' }}
            >
              <Shield className="h-4 w-4" style={{ color: 'var(--gold)' }} />
            </div>
            <span className="text-[18px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>PawnGold</span>
          </div>

          <nav className="hidden items-center gap-7 text-[14px] md:flex">
            {HEADER_LINKS.map((item) =>
              item.external ? (
                <a
                  key={item.label}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors duration-150 flex items-center gap-1.5"
                  style={{
                    color: 'var(--gold)',
                    fontWeight: 600,
                  }}
                >
                  {item.label}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.7 }}>
                    <path d="M1.5 8.5L8.5 1.5M8.5 1.5H3.5M8.5 1.5V6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => scrollToSection(item.href)}
                  className="transition-colors duration-150"
                  style={{
                    color: activeSection === item.href.replace('#', '') ? 'var(--gold)' : 'var(--text-secondary)',
                    fontWeight: activeSection === item.href.replace('#', '') ? 600 : 400,
                  }}
                >
                  {item.label}
                </button>
              )
            )}
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login" className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>Sign In</Link>
            <button
              onClick={openModal}
              className="rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-all active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
                color: '#0A0A0F',
                border: '1px solid rgba(201,160,92,0.45)',
                boxShadow: '0 4px 12px rgba(201,160,92,0.2)',
              }}
            >
              Start Free Trial
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* HERO — Editorial split */}
        <section id="home" className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1fr_1fr] lg:px-8">
          <div className="reveal flex flex-col justify-center">
            <div
              className="mb-5 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-[0.14em]"
              style={{ background: 'rgba(201,160,92,0.08)', border: '1px solid rgba(201,160,92,0.18)', color: 'var(--gold)' }}
            >
              <Sparkles className="h-3 w-3" />
              PAWNSHOP OPERATIONS PLATFORM
            </div>
            <h1
              className="text-[40px] font-bold leading-[1.06] tracking-tight sm:text-[52px]"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              Modernize Your Pawnshop with One Platform
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-[1.75]" style={{ color: 'var(--text-secondary)' }}>
              Secure, scalable, and built for multi-branch pawnshops. Manage transactions, inventory, and staff with enterprise-grade precision.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={openModal}
                className="inline-flex items-center gap-2 rounded-[12px] px-5 py-3 text-[14px] font-semibold transition-all active:scale-[0.97]"
                style={{
                  background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
                  color: '#0A0A0F',
                  border: '1px solid rgba(201,160,92,0.45)',
                  boxShadow: '0 4px 16px rgba(201,160,92,0.22)',
                }}
              >
                Start Free Trial <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('#features')}
                className="inline-flex items-center gap-2 rounded-[12px] px-5 py-3 text-[14px] font-semibold transition-all"
                style={{ border: '1px solid rgba(201,160,92,0.18)', color: 'var(--text-secondary)', background: 'transparent' }}
              >
                Explore Features
              </button>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {HERO_STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[14px] px-4 py-3"
                  style={{ background: 'rgba(20,20,27,0.9)', border: '1px solid rgba(201,160,92,0.1)' }}
                >
                  <p className="text-[18px] font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{stat.value}</p>
                  <p className="text-[11px] mt-0.5 uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="reveal relative mx-auto w-full max-w-[520px]">
            <div
              className="absolute -inset-6 rounded-3xl"
              style={{ background: 'radial-gradient(circle at 50% 40%, rgba(201,160,92,0.08), transparent 60%)' }}
            />
            <div
              className="relative overflow-hidden rounded-[20px]"
              style={{
                background: 'linear-gradient(160deg, #1C1C26 0%, #14141B 100%)',
                border: '1px solid rgba(201,160,92,0.15)',
                boxShadow: '0 0 0 1px rgba(201,160,92,0.06) inset, 0 24px 56px rgba(0,0,0,0.45)',
              }}
            >
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #C9A05C 0%, rgba(201,160,92,0.3) 100%)' }} />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-5">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--red)' }} />
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--amber)' }} />
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--green)' }} />
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>dashboard@pawngold:~$</p>
                </div>
                <div className="space-y-2.5">
                  {[
                    { label: 'Legally-Binding Contracts', desc: 'Auto-generated loan & auction agreements' },
                    { label: 'Audit-Ready Trail', desc: 'Immutable records for every transaction' },
                    { label: 'Role-Based Security', desc: 'Granular access for 10 staff roles' },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex flex-col px-3.5 py-2.5 rounded-[10px]"
                      style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--gold-light)' }}>{row.label}</span>
                      <span className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{row.desc}</span>
                    </div>
                  ))}
                  <div
                    className="flex items-center gap-2 mt-3 pt-3"
                    style={{ borderTop: '1px solid rgba(201,160,92,0.08)' }}
                  >
                    <div className="w-[6px] h-[6px] rounded-full" style={{ background: 'var(--green)', boxShadow: '0 0 5px rgba(61,168,108,0.7)' }} />
                    <span className="text-[10px]" style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>all systems nominal</span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="absolute -right-3 -top-4 rounded-[12px] px-4 py-2.5 shadow-lg"
              style={{ background: 'rgba(20,20,27,0.98)', border: '1px solid rgba(201,160,92,0.15)' }}
            >
              <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Status</p>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--green)' }}>Operational</p>
            </div>
          </div>
        </section>

        {/* PILLARS */}
        <section style={{ background: 'rgba(13,13,20,0.8)', borderTop: '1px solid rgba(201,160,92,0.06)', borderBottom: '1px solid rgba(201,160,92,0.06)' }} className="py-12">
          <div className="mx-auto grid max-w-6xl gap-5 px-6 md:grid-cols-4 lg:px-8">
            {[
              { title: 'Secure Multi-Tenant', desc: 'Complete data isolation between pawnshops', icon: Shield },
              { title: 'Data Privacy First', desc: 'Enterprise-grade encryption and compliance', icon: Lock },
              { title: 'Role-Based Access', desc: 'Granular permissions for every team member', icon: UserRoundPlus },
              { title: 'Real-Time Processing', desc: 'Lightning-fast transaction updates across branches', icon: Sparkles },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="reveal lp-card rounded-[16px] p-5">
                  <div
                    className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px]"
                    style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.15)' }}
                  >
                    <Icon className="h-5 w-5" style={{ color: 'var(--gold)' }} />
                  </div>
                  <h3 className="text-[15px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
          <div className="reveal mb-10">
            <h2 className="text-[32px] font-bold leading-tight tracking-tight sm:text-[40px]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              Everything for a modern pawnshop
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Powerful modules built specifically for the pawnshop industry.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {MODULE_CARDS.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="reveal lp-card rounded-[16px] p-5">
                  <div
                    className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-[12px]"
                    style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.15)' }}
                  >
                    <Icon className="h-4 w-4" style={{ color: 'var(--gold)' }} />
                  </div>
                  <h3 className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* ONBOARDING STEPS */}
        <section id="onboarding" style={{ background: 'rgba(13,13,20,0.8)', borderTop: '1px solid rgba(201,160,92,0.06)', borderBottom: '1px solid rgba(201,160,92,0.06)' }} className="py-16">
          <div className="mx-auto max-w-6xl px-6 lg:px-8">
            <div className="reveal mb-12">
              <h2 className="text-[32px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Get started in minutes</h2>
              <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>Simple onboarding designed for busy pawnshop owners</p>
            </div>
            <div className="relative">
              <div className="absolute left-0 right-0 top-7 h-px hidden md:block" style={{ background: 'rgba(201,160,92,0.1)' }} />
              <div className="grid gap-8 md:grid-cols-4">
                {[
                  { title: 'Register your pawnshop', desc: 'Create your account with basic business info', icon: UserRoundPlus },
                  { title: 'Verify your business', desc: 'Quick verification for security and compliance', icon: CheckCircle2 },
                  { title: 'Configure modules', desc: 'Set up your team, permissions, and features', icon: Settings },
                  { title: 'Start operations', desc: 'Go live and manage digitally from day one', icon: Rocket },
                ].map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <article key={step.title} className="reveal relative text-center">
                      <div
                        className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[16px]"
                        style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.18)' }}
                      >
                        <Icon className="h-6 w-6" style={{ color: 'var(--gold)' }} />
                        <span
                          className="absolute -bottom-2.5 flex h-6 w-6 items-center justify-center rounded-[8px] text-[11px] font-bold"
                          style={{ background: 'var(--gold)', color: '#0A0A0F' }}
                        >
                          {i + 1}
                        </span>
                      </div>
                      <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{step.title}</h3>
                      <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{step.desc}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
          <div className="reveal mb-10">
            <h2 className="text-[32px] font-bold tracking-tight sm:text-[40px]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              Simple, transparent pricing
            </h2>
            <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>Start with a 15-day free trial. No credit card required.</p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {pricingCards.map((plan) => (
              <article
                key={plan.key}
                className="reveal lp-card relative rounded-[20px] p-6"
                style={plan.key === 'professional' ? { border: '1px solid rgba(201,160,92,0.35)', boxShadow: '0 0 0 1px rgba(201,160,92,0.12) inset, 0 16px 48px rgba(201,160,92,0.1)' } : {}}
              >
                {plan.key === 'professional' && (
                  <div
                    className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-1 text-[11px] font-semibold"
                    style={{ background: 'var(--gold)', color: '#0A0A0F' }}
                  >
                    Most Popular
                  </div>
                )}
                <h3 className="text-[18px] font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{plan.title}</h3>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{plan.subtitle}</p>
                <p className="mt-5 text-[40px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: plan.key === 'professional' ? 'var(--gold)' : 'var(--text-primary)' }}>
                  {plan.price}
                  {plan.period && <span className="ml-1 text-[18px] font-normal" style={{ color: 'var(--text-secondary)' }}>{plan.period}</span>}
                </p>
                <ul className="mt-5 space-y-2.5">
                  {plan.bullets.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--green)' }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={openModal}
                  className="mt-7 w-full rounded-[12px] px-4 py-3 text-[13px] font-semibold transition-all active:scale-[0.97]"
                  style={plan.key === 'professional' ? {
                    background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
                    color: '#0A0A0F',
                    border: '1px solid rgba(201,160,92,0.45)',
                    boxShadow: '0 4px 14px rgba(201,160,92,0.22)',
                  } : {
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {plan.cta}
                </button>
              </article>
            ))}
          </div>
          <p className="mt-6 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            All plans include a <span className="font-semibold" style={{ color: 'var(--gold)' }}>15-day free trial</span> with full access to features
          </p>
        </section>

        {/* SECURITY */}
        <section id="security" style={{ background: 'rgba(13,13,20,0.8)', borderTop: '1px solid rgba(201,160,92,0.06)', borderBottom: '1px solid rgba(201,160,92,0.06)' }} className="py-16">
          <div className="mx-auto max-w-6xl px-6 lg:px-8">
            <div className="reveal mb-10">
              <h2 className="text-[32px] font-bold tracking-tight sm:text-[40px]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Enterprise-grade security</h2>
              <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>Built with compliance and data privacy in mind.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              {[
                { title: 'End-to-End Encryption', desc: 'AES-256 encryption for all data in transit and at rest', icon: Lock },
                { title: 'Tenant Isolation', desc: 'Complete data separation between every pawnshop account', icon: Shield },
                { title: 'Admin Audit Logs', desc: 'Comprehensive audit trails for all administrative actions', icon: Users },
                { title: '99.9% Uptime SLA', desc: 'Enterprise-grade servers with regular automated backups', icon: Building2 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="reveal lp-card rounded-[16px] p-5">
                    <div
                      className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-[12px]"
                      style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.15)' }}
                    >
                      <Icon className="h-4 w-4" style={{ color: 'var(--gold)' }} />
                    </div>
                    <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
                    <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
                  </article>
                );
              })}
            </div>
            <div
              className="reveal mt-5 rounded-[16px] p-5 flex flex-wrap items-center justify-between gap-4"
              style={{ background: 'rgba(201,160,92,0.05)', border: '1px solid rgba(201,160,92,0.15)' }}
            >
              <div>
                <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>GDPR & Privacy Compliant</h3>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Strict data protection with full transparency.</p>
              </div>
              <div className="flex gap-2">
                {['ISO 27001', 'SOC 2 Type II', 'GDPR'].map((badge) => (
                  <span
                    key={badge}
                    className="rounded-[8px] px-3 py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(201,160,92,0.1)', color: 'var(--gold)', border: '1px solid rgba(201,160,92,0.2)' }}
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
          <div className="reveal mb-10">
            <h2 className="text-[32px] font-bold tracking-tight sm:text-[40px]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Trusted nationwide</h2>
            <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>What pawnshop owners say about PawnGold.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {TESTIMONIALS.map((item) => (
              <article key={item.name} className="reveal lp-card rounded-[20px] p-5">
                <div className="mb-4 flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="h-3.5 w-3.5 fill-current" style={{ color: 'var(--gold)' }} />
                  ))}
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>"{item.quote}"</p>
                <div className="mt-5 flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold flex-shrink-0"
                    style={{ background: 'rgba(201,160,92,0.15)', border: '1px solid rgba(201,160,92,0.25)', color: 'var(--gold)' }}
                  >
                    {item.initials}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{item.role}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" style={{ background: 'rgba(13,13,20,0.8)', borderTop: '1px solid rgba(201,160,92,0.06)', borderBottom: '1px solid rgba(201,160,92,0.06)' }} className="py-16">
          <div className="mx-auto max-w-3xl px-6 lg:px-8">
            <div className="reveal mb-10">
              <h2 className="text-[32px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Frequently asked</h2>
              <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>Everything you need before starting your free trial.</p>
            </div>
            <div className="space-y-3">
              {FAQ_ITEMS.map((item, index) => {
                const isOpen = openFaqIndex === index;
                return (
                  <article key={item.question} className="reveal lp-card rounded-[16px] p-5">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 text-left"
                      onClick={() => setOpenFaqIndex((prev) => (prev === index ? null : index))}
                    >
                      <span className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.question}</span>
                      <span
                        className="text-[20px] leading-none flex-shrink-0 transition-transform duration-200"
                        style={{ color: 'var(--gold)', transform: isOpen ? 'rotate(45deg)' : 'none' }}
                      >
                        +
                      </span>
                    </button>
                    {isOpen && <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.answer}</p>}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="contact" className="py-20">
          <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
            <div
              className="reveal rounded-[28px] p-12"
              style={{
                background: 'linear-gradient(160deg, rgba(28,28,38,0.98) 0%, rgba(20,20,27,1) 100%)',
                border: '1px solid rgba(201,160,92,0.2)',
                boxShadow: '0 0 0 1px rgba(201,160,92,0.07) inset, 0 24px 64px rgba(0,0,0,0.4)',
              }}
            >
              <h2 className="text-[32px] font-bold tracking-tight sm:text-[44px]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                Ready to modernize your pawnshop?
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Join pawnshop owners who have transformed their operations with PawnGold. Start free today — no credit card required.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={openModal}
                  className="inline-flex items-center gap-2 rounded-[12px] px-6 py-3 text-[14px] font-semibold transition-all active:scale-[0.97]"
                  style={{
                    background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
                    color: '#0A0A0F',
                    border: '1px solid rgba(201,160,92,0.45)',
                    boxShadow: '0 4px 16px rgba(201,160,92,0.25)',
                  }}
                >
                  Start Free Trial <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-6 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {['15-day free trial', 'No credit card required', 'Cancel anytime'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--green)' }} />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer style={{ background: 'rgba(10,10,15,0.99)', borderTop: '1px solid rgba(201,160,92,0.08)' }} className="py-12">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
          <div className="reveal">
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-[10px]"
                style={{ background: 'rgba(201,160,92,0.12)', border: '1px solid rgba(201,160,92,0.2)' }}
              >
                <Shield className="h-4 w-4" style={{ color: 'var(--gold)' }} />
              </div>
              <span className="text-[17px] font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>PawnGold</span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              The modern integrated platform for pawnshop operations.
            </p>
          </div>

          {[
            { label: 'Product', items: ['Features', 'Pricing', 'Security', 'Integrations', 'API'] },
            { label: 'Company', items: ['About Us', 'Blog', 'Careers', 'Press Kit', 'Contact'] },
            { label: 'Legal', items: ['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'GDPR', 'Compliance'] },
          ].map((col) => (
            <div key={col.label} className="reveal">
              <p className="text-[13px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{col.label}</p>
              <ul className="space-y-2">
                {col.items.map((item) => (
                  <li key={item} className="text-[13px] cursor-pointer" style={{ color: 'var(--text-secondary)' }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-6xl border-t px-6 pt-6 text-[12px] lg:px-8" style={{ borderColor: 'rgba(201,160,92,0.08)', color: 'var(--text-dim)' }}>
          <p>© 2026 PawnGold. All rights reserved.</p>
        </div>
      </footer>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(10,10,15,0.88)', backdropFilter: 'blur(16px)' }}>
          <div
            className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-[24px] p-6 shadow-2xl"
            style={{
              background: 'linear-gradient(160deg, rgba(28,28,38,0.98) 0%, rgba(14,14,21,0.99) 100%)',
              border: '1px solid rgba(201,160,92,0.2)',
              boxShadow: '0 0 0 1px rgba(201,160,92,0.07) inset, 0 32px 80px rgba(0,0,0,0.6)',
            }}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-[20px] font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Start Your Free Trial</h3>
              <button
                onClick={() => setShowModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5 rounded-[16px] p-5" style={{ background: 'rgba(201,160,92,0.06)', border: '1px solid rgba(201,160,92,0.22)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                    Start your free trial
                  </p>
                  <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    Full access to PawnGold for free. No credit card required.
                  </p>
                </div>
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
                  style={{ background: 'rgba(61,168,108,0.12)', color: 'var(--green)', border: '1px solid rgba(61,168,108,0.25)' }}
                >
                  <Sparkles className="h-3 w-3" /> Free
                </span>
              </div>

              <div className="mt-4 grid gap-1.5">
                {[
                  'Full access to all modules',
                  'Unlimited pawn tickets, customers & staff',
                  'Digital contracts, receipts & audit trail',
                  'Multi-branch management',
                  'Auction house integration',
                ].map((feature) => (
                  <div key={feature} className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--green)' }} />
                    {feature}
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-[10px] px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Trial Duration</p>
                  <p className="mt-0.5 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>15 days</p>
                </div>
                <div className="rounded-[10px] px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Automatic Renewal</p>
                  <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                    Converts to your chosen plan after the trial. Cancel anytime.
                  </p>
                </div>
              </div>
            </div>

            {!ownerUserId && authStep === 'form' && (
              <div className="mb-5 rounded-[16px] p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Owner account required</p>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Register or sign in as the owner to track your trial status across devices.
                </p>

                <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3">
                  {authMode === 'signup' && (
                    <input
                      value={authForm.fullName}
                      onChange={(e) => setAuthForm((prev) => ({ ...prev, fullName: e.target.value }))}
                      placeholder="Owner Full Name"
                      className="w-full rounded-[12px] px-3.5 py-2.5 text-[13px] outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--text-primary)' }}
                      required
                    />
                  )}
                  <input
                    value={authForm.email}
                    onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
                    type="email"
                    placeholder="Owner Email"
                    className="w-full rounded-[12px] px-3.5 py-2.5 text-[13px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--text-primary)' }}
                    required
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      value={authForm.password}
                      onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
                      type="password"
                      placeholder="Password"
                      className="rounded-[12px] px-3.5 py-2.5 text-[13px] outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--text-primary)' }}
                      required
                    />
                    {authMode === 'signup' && (
                      <input
                        value={authForm.confirmPassword}
                        onChange={(e) => setAuthForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                        type="password"
                        placeholder="Confirm Password"
                        className="rounded-[12px] px-3.5 py-2.5 text-[13px] outline-none"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--text-primary)' }}
                        required
                      />
                    )}
                  </div>

                  {authMessage && (
                    <p className="rounded-[10px] px-3 py-2 text-[12px]" style={{ background: 'rgba(61,168,108,0.1)', color: 'var(--green)', border: '1px solid rgba(61,168,108,0.2)' }}>{authMessage}</p>
                  )}
                  {authError && (
                    <p className="rounded-[10px] px-3 py-2 text-[12px]" style={{ background: 'rgba(212,69,69,0.1)', color: 'var(--red)', border: '1px solid rgba(212,69,69,0.2)' }}>{authError}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={authSubmitting}
                      className="rounded-[12px] px-4 py-2.5 text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)', color: '#0A0A0F', border: '1px solid rgba(201,160,92,0.4)' }}
                    >
                      {authSubmitting ? 'Please wait...' : authMode === 'signup' ? 'Create Owner Account' : 'Sign In as Owner'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAuthError(null); setAuthMessage(null); setAuthMode((prev) => (prev === 'signup' ? 'signin' : 'signup')); }}
                      className="rounded-[12px] px-4 py-2.5 text-[13px] font-medium transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
                    >
                      {authMode === 'signup' ? 'Already have an account?' : 'Need an account?'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {!ownerUserId && authStep === 'otp' && (
              <div className="mb-5 rounded-[16px] p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Verify your email</p>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Enter the 6-digit code sent to <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{otpSentTo}</span>
                </p>

                <form onSubmit={handleVerifyOtp} className="mt-4 space-y-3">
                  <input
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="w-full rounded-[12px] px-3.5 py-3 text-[20px] text-center tracking-[0.4em] font-mono outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(201,160,92,0.15)', color: 'var(--text-primary)' }}
                    autoFocus
                    required
                  />

                  <p className="text-center text-[12px] pt-1" style={{ color: 'var(--text-secondary)' }}>
                    {resendTimer > 0 ? (
                      <span>Resend code in <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{resendTimer}s</span></span>
                    ) : (
                      <button type="button" onClick={resendCode} className="font-semibold underline transition-colors" style={{ color: '#C9A05C' }}>
                        Didn't receive code? Resend
                      </button>
                    )}
                  </p>

                  {authMessage && (
                    <p className="rounded-[10px] px-3 py-2 text-[12px]" style={{ background: 'rgba(61,168,108,0.1)', color: 'var(--green)', border: '1px solid rgba(61,168,108,0.2)' }}>{authMessage}</p>
                  )}
                  {authError && (
                    <p className="rounded-[10px] px-3 py-2 text-[12px]" style={{ background: 'rgba(212,69,69,0.1)', color: 'var(--red)', border: '1px solid rgba(212,69,69,0.2)' }}>{authError}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={authSubmitting || otpCode.length !== 6}
                      className="rounded-[12px] px-4 py-2.5 text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)', color: '#0A0A0F', border: '1px solid rgba(201,160,92,0.4)' }}
                    >
                      {authSubmitting ? 'Verifying...' : 'Verify & Create Account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAuthStep('form'); setAuthError(null); setAuthMessage(null); setOtpCode(''); setResendTimer(0); }}
                      className="rounded-[12px] px-4 py-2.5 text-[13px] font-medium transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
                    >
                      Back
                    </button>
                  </div>
                </form>
              </div>
            )}

            {ownerUserId && (
              <div className="mb-5 rounded-[16px] p-4" style={{ background: 'rgba(201,160,92,0.05)', border: '1px solid rgba(201,160,92,0.2)' }}>
                <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Owner account verified</p>
                <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>Continue to Pending Access to submit your trial request.</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); window.location.assign('/?onboarding=1'); }}
                    className="rounded-[12px] px-4 py-2.5 text-[13px] font-semibold transition-all active:scale-[0.97]"
                    style={{ background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)', color: '#0A0A0F', border: '1px solid rgba(201,160,92,0.4)' }}
                  >
                    Continue to Pending Access
                  </button>
                  <button
                    type="button"
                    onClick={handleOwnerSignOut}
                    className="rounded-[12px] px-4 py-2.5 text-[13px] font-medium transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
