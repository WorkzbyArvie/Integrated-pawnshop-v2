import { useState, useEffect, useCallback, useMemo, createContext, useContext, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  LayoutDashboard, 
  BadgePercent, 
  Undo2, 
  Users, 
  Warehouse, 
  BrainCircuit,
  Gavel, 
  ShieldCheck,
  Globe,
  GitBranch,
  Settings2,
  Wallet,
  Users2,
  LogOut,
  Loader2,
  ListChecks,
  ListOrdered,
  BookOpen,
  Clock,
  Receipt,
  FileCheck2,
  History,
  CreditCard,
  ClipboardList,
  LogIn,
  LogOut as LogOutIcon,
  BarChart3,
  Shield,
} from 'lucide-react';

// Import Libs
import { supabase } from './lib/supabaseClient';
import api from './lib/apiClient';

// --- AUTH IMPORT (eager — small, shown immediately) ---
import Login from './components/Auth/Login'; 
import ResetPassword from './components/Auth/ResetPassword';

// --- Eager imports (small, always visible) ---
import { PendingAccessDashboard } from './components/PendingAccessDashboard';
import { NotificationCenter } from './components/NotificationCenter';

// --- Lazy imports (heavy page components, code-split) ---
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const CrmTable = lazy(() => import('./components/CrmTable').then(m => ({ default: m.CrmTable })));
const InventoryVault = lazy(() => import('./components/InventoryVault').then(m => ({ default: m.InventoryVault })));
const DecisionSupport = lazy(() => import('./components/DecisionSupport').then(m => ({ default: m.DecisionSupport })));
const Redemption = lazy(() => import('./components/Redemption').then(m => ({ default: m.Redemption })));
const AuctionQueue = lazy(() => import('./components/AuctionQueue').then(m => ({ default: m.AuctionQueue })));
const AuctionMarketplace = lazy(() => import('./components/AuctionMarketplace').then(m => ({ default: m.AuctionMarketplace })));
const AuctionSettlements = lazy(() => import('./components/AuctionSettlements').then(m => ({ default: m.AuctionSettlements })));
const SuperAdminDashboard = lazy(() => import('./pages/admin/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard })));
const SystemSettings = lazy(() => import('./pages/admin/SystemSettings').then(m => ({ default: m.SystemSettings })));
const StaffMatrix = lazy(() => import('./components/StaffMatrix').then(m => ({ default: m.StaffMatrix })));
const FinanceTreasury = lazy(() => import('./components/FinanceTreasury').then(m => ({ default: m.FinanceTreasury })));
const LoanManagement = lazy(() => import('./pages/loans/LoanManagement').then(m => ({ default: m.LoanManagement })));
const ApprovalQueue = lazy(() => import('./components/ApprovalQueue').then(m => ({ default: m.ApprovalQueue })));
const QueueManagement = lazy(() => import('./components/QueueManagement').then(m => ({ default: m.QueueManagement })));
const FinanceLedger = lazy(() => import('./components/FinanceLedger').then(m => ({ default: m.FinanceLedger })));
const AttendanceTracker = lazy(() => import('./components/AttendanceTracker').then(m => ({ default: m.AttendanceTracker })));
const PayrollManagement = lazy(() => import('./components/PayrollManagement').then(m => ({ default: m.PayrollManagement })));
const SubscriptionManager = lazy(() => import('./components/SubscriptionManager').then(m => ({ default: m.SubscriptionManager })));
const MultiBranchManagement = lazy(() => import('./components/MultiBranchManagement').then(m => ({ default: m.MultiBranchManagement })));
const SupportChat = lazy(() => import('./components/SupportChat').then(m => ({ default: m.SupportChat })));
const AuditHistory = lazy(() => import('./components/AuditHistory').then(m => ({ default: m.AuditHistory })));
const OwnerComplianceDashboard = lazy(() => import('./pages/admin/OwnerComplianceDashboard'));
const BidderKycReview = lazy(() => import('./components/BidderKycReview'));
const TransactionHistory = lazy(() => import('./pages/loans/TransactionHistory').then(m => ({ default: m.TransactionHistory })));
const LandingPage = lazy(() => import('./pages/LandingPage'));

// Standardized Roles
export type Role =
  | 'SUPER_ADMIN'
  | 'OWNER'
  | 'ADMIN'
  | 'MANAGER'
  | 'STAFF'
  | 'HR'
  | 'CASHIER_TELLER'
  | 'APPRAISER'
  | 'INVENTORY_CUSTODIAN'
  | 'AUDITOR';

type BranchOption = {
  id: number;
  name: string;
  location?: string | null;
};

type BranchListResponse = {
  branches?: BranchOption[];
};

type OwnerRegistrationRequest = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
};


interface ToastContextType {
  showToast: (msg: string, type: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);

type SidebarBranding = {
  pawnshopId: string | null;
  pawnshopName: string | null;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  customBrandingEnabled: boolean;
};

const DEFAULT_SIDEBAR_BRANDING: SidebarBranding = {
  pawnshopId: null,
  pawnshopName: null,
  displayName: 'PawnGold',
  logoUrl: null,
  primaryColor: '#D4AF37',
  secondaryColor: '#141416',
  customBrandingEnabled: false,
};

const TAB_TO_PATH: Record<string, string> = {
  'platform-control': '/platform-control',
  'platform-analytics': '/platform-analytics',
  'system-settings': '/system-settings',
  'trial-requests': '/trial-requests',
  'platform-compliance': '/platform-compliance',
  'bidder-kyc': '/bidder-kyc',
  'pending-access': '/pending-access',
  'frozen-access': '/frozen-access',
  'branch-system-settings': '/branch-system-settings',
  'multi-branches': '/multi-branches',
  'dashboard': '/dashboard',
  'sales': '/sales',
  'pending-approval': '/pending-approval',
  'approval-queue': '/approval-queue',
  'audit-history': '/audit-history',
  'crm': '/crm',
  'inventory': '/inventory',
  'redemption': '/redemption',
  'finance': '/finance',
  'hr': '/hr',
  'auction-queue': '/auction-queue',
  'auction-settlements': '/auction-settlements',
  'auction-live': '/auction-live',
  'decision': '/decision',
  'loan-history': '/loan-history',
  'queue-mgmt': '/queue-mgmt',
  'finance-ledger': '/finance-ledger',
  'attendance': '/attendance',
  'payroll': '/payroll',
  'compliance': '/compliance',
  'subscription': '/subscription',
  'support-chat': '/support-chat',
};

const PATH_TO_TAB = Object.entries(TAB_TO_PATH).reduce<Record<string, string>>((acc, [tab, path]) => {
  acc[path] = tab;
  return acc;
}, {});

const resolveTabFromPath = (rawPath: string): string | null => {
  const normalized = rawPath.replace(/\/+$/, '') || '/';
  return PATH_TO_TAB[normalized] || null;
};

const STATIC_NAV_ITEMS = [
    // PLATFORM-level (Super Admin only)
    { id: 'platform-control', label: 'Platform Control', icon: Globe, roles: ['Super Admin'], type: 'PLATFORM' },
    { id: 'platform-analytics', label: 'Platform Analytics', icon: BarChart3, roles: ['Super Admin'], type: 'PLATFORM' },
    { id: 'system-settings', label: 'System Control', icon: Settings2, roles: ['Super Admin'], type: 'PLATFORM' },
    { id: 'trial-requests', label: 'Trial Requests', icon: ClipboardList, roles: ['Super Admin'], type: 'PLATFORM' },
    { id: 'platform-compliance', label: 'Compliance', icon: Shield, roles: ['Super Admin'], type: 'PLATFORM' },
    { id: 'support-chat', label: 'Support Hub', icon: Users2, roles: ['Super Admin'], type: 'PLATFORM' },

    // Owner onboarding limited mode
    { id: 'pending-access', label: 'Pending Access', icon: Clock, roles: ['Owner'], type: 'OPERATIONAL' },
    { id: 'frozen-access', label: 'Subscription Required', icon: ShieldCheck, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'HR', 'Cashier/Teller', 'Appraiser', 'Inventory Custodian', 'Auditor', 'Approver'], type: 'OPERATIONAL' },

    // OPERATIONAL-level (Branch roles)
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'HR', 'Cashier/Teller', 'Appraiser', 'Inventory Custodian', 'Auditor', 'Approver'], type: 'OPERATIONAL' },

    // BRANCH-level System Control (Pawnshop settings)
    { id: 'branch-system-settings', label: 'System Control', icon: Settings2, roles: ['Owner', 'Admin'], type: 'OPERATIONAL' },
    { id: 'multi-branches', label: 'Multi-Branch', icon: GitBranch, roles: ['Owner'], type: 'OPERATIONAL' },
    { id: 'sales', label: 'New Appraisal', icon: BadgePercent, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'Cashier/Teller', 'Appraiser'], type: 'OPERATIONAL' },
    { id: 'approval-queue', label: 'Approval Queue', icon: ListChecks, roles: ['Owner', 'Admin', 'Manager', 'Approver'], type: 'OPERATIONAL' },
    { id: 'audit-history', label: 'Audit History', icon: History, roles: ['Owner', 'Admin'], type: 'OPERATIONAL' },
    { id: 'crm', label: 'Customers', icon: Users2, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'Cashier/Teller', 'Appraiser'], type: 'OPERATIONAL', feature: 'crm_enabled' },
    { id: 'inventory', label: 'Inventory & Vault', icon: Warehouse, roles: ['Owner', 'Admin', 'Manager', 'Inventory Custodian'], type: 'OPERATIONAL', feature: 'vault_enabled' },
    { id: 'redemption', label: 'Redemption', icon: Undo2, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'Cashier/Teller'], type: 'OPERATIONAL' },
    { id: 'finance', label: 'Finance & Treasury', icon: Wallet, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL', feature: 'finance_enabled' },
    { id: 'hr', label: 'Staff Matrix', icon: Users, roles: ['Owner', 'Admin', 'HR'], type: 'OPERATIONAL', feature: 'hr_enabled' },
    { id: 'auction-queue', label: 'Auction Queue', icon: Gavel, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL', feature: 'auction_enabled' },
    { id: 'auction-settlements', label: 'Auction Settlements', icon: Gavel, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL', feature: 'auction_enabled' },
    { id: 'bidder-kyc', label: 'Bidder KYC Review', icon: Shield, roles: ['Super Admin'], type: 'PLATFORM' },
    { id: 'auction-live', label: 'Live Auctions', icon: Gavel, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL', feature: 'auction_enabled' },
    { id: 'decision', label: 'Decision Support', icon: BrainCircuit, roles: ['Owner', 'Admin', 'Manager'], type: 'OPERATIONAL', feature: 'decision_enabled' },
    { id: 'loan-history', label: 'Transaction History', icon: History, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'Cashier/Teller', 'Appraiser', 'Auditor', 'Approver'], type: 'OPERATIONAL' },
    { id: 'queue-mgmt', label: 'Queue Management', icon: ListOrdered, roles: ['Owner', 'Admin', 'Manager', 'Staff', 'Cashier/Teller'], type: 'OPERATIONAL' },
    { id: 'finance-ledger', label: 'Finance Ledger', icon: BookOpen, roles: ['Owner', 'Admin', 'Manager', 'Auditor'], type: 'OPERATIONAL', feature: 'finance_enabled' },
    { id: 'attendance', label: 'Attendance', icon: Clock, roles: ['Owner', 'Admin', 'Manager', 'HR'], type: 'OPERATIONAL' },
    { id: 'payroll', label: 'Payroll', icon: Receipt, roles: ['Owner', 'Admin', 'HR'], type: 'OPERATIONAL' },
    { id: 'compliance', label: 'Compliance', icon: FileCheck2, roles: ['Owner', 'Admin', 'Manager', 'HR', 'Auditor'], type: 'OPERATIONAL' },
    { id: 'subscription', label: 'Subscription', icon: CreditCard, roles: ['Owner'], type: 'OPERATIONAL' },
];

const FREE_ALLOWED_NAV_IDS = new Set([
    'branch-system-settings',
    'multi-branches',
    'dashboard',
    'sales',
    'approval-queue',
    'audit-history',
    'loan-history',
    'redemption',
    'queue-mgmt',
    'attendance',
    'subscription',
    'support-chat',
]);

const TRIAL_RESTRICTED_OWNER_NAV_IDS = new Set([
    'branch-system-settings',
    'multi-branches',
    'auction-queue',
    'auction-settlements',
    'auction-live',
    'decision',
]);

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);

  const hasRecoveryIntent =
    searchParams.get('type') === 'recovery' ||
    hashParams.get('type') === 'recovery' ||
    Boolean(searchParams.get('token_hash')) ||
    Boolean(hashParams.get('token_hash')) ||
    Boolean(searchParams.get('code')) ||
    Boolean(hashParams.get('code')) ||
    Boolean(searchParams.get('access_token')) ||
    Boolean(hashParams.get('access_token')) ||
    Boolean(searchParams.get('error_code')) ||
    Boolean(hashParams.get('error_code'));

  const isResetPasswordRoute = normalizedPath === '/reset-password' || hasRecoveryIntent;
  const isLoginRoute = normalizedPath === '/login';
  const hasOnboardingIntent =
    searchParams.get('onboarding') === '1' ||
    hashParams.get('onboarding') === '1';
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(() =>
    resolveTabFromPath(window.location.pathname) ||
    localStorage.getItem('active_tab') ||
    'dashboard'
  );

  useEffect(() => {
    localStorage.setItem('active_tab', activeTab);
  }, [activeTab]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>(() => localStorage.getItem('user_role') || 'Staff');
  const [subscriptionTier, setSubscriptionTier] = useState<'FREE' | 'TRIAL' | 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE'>('FREE');
  const [subscriptionTierLoaded, setSubscriptionTierLoaded] = useState<boolean>(false);
  const [hasApprovedSupportAccess, setHasApprovedSupportAccess] = useState<boolean>(false);
  const [supportAccessChecked, setSupportAccessChecked] = useState<boolean>(false);
  const [subscriptionAccessFrozen, setSubscriptionAccessFrozen] = useState<boolean>(false);
  const [subscriptionAccessChecked, setSubscriptionAccessChecked] = useState<boolean>(false);
  const [subscriptionRefreshKey, setSubscriptionRefreshKey] = useState(0);
  const [sidebarBranding, setSidebarBranding] = useState<SidebarBranding>(DEFAULT_SIDEBAR_BRANDING);
  const [brandLogoFailed, setBrandLogoFailed] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState('');
  
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [ownerBranches, setOwnerBranches] = useState<BranchOption[]>([]);
  const [ownerRegistrationStatus, setOwnerRegistrationStatus] = useState<string>('NONE');
  const [ownerRegistrationChecked, setOwnerRegistrationChecked] = useState(false);
  const [activeOperationalBranchName, setActiveOperationalBranchName] = useState<string | null>(null);
  const [activeOperationalBranchId, setActiveOperationalBranchId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_branch_id');
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const [isImpersonating, setIsImpersonating] = useState<boolean>(() => {
    return localStorage.getItem('app_perspective') === 'SHOP';
  });

  // In live branch view, only owners can impersonate/select operational branch snapshots.
  const effectiveUserRole = userRole;

  const selectedOwnerBranch =
    activeOperationalBranchId != null
      ? ownerBranches.find((branch) => branch.id === activeOperationalBranchId) || null
      : null;

  const branchName =
    userRole === 'Owner'
      ? `Working Branch: ${selectedOwnerBranch?.name || `${sidebarBranding.displayName || 'Main'} (Main)`}`
      : activeOperationalBranchName
        ? `Branch: ${activeOperationalBranchName}`
        : currentBranchId
          ? `Pawnshop: ${sidebarBranding.displayName || sidebarBranding.pawnshopName || 'Main'}`
        : 'Platform Overview';

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    void Swal.fire({
      toast: true,
      position: 'top',
      icon: type,
      title: msg,
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true,
    });
  }, []);

  // Helper to normalize roles from DB to match our types
  const normalizeRole = (role: string | null): string => {
    if (!role) return 'Staff';
    const cleaned = role.toString().toUpperCase().replace(/[_\s]/g, '');
    switch (cleaned) {
      case 'SUPERADMIN':
      case 'SUPER':
      case 'SUPER_ADMIN':
        return 'Super Admin';
      case 'BRANCHADMIN':
      case 'BRANCH_ADMIN':
        return 'Admin';
      case 'ADMIN':
        return 'Admin';
      case 'MANAGER':
        return 'Manager';
      case 'OWNER':
        return 'Owner';
      case 'HR':
      case 'HUMANRESOURCES':
      case 'HUMAN_RESOURCES':
        return 'HR';
      case 'STAFF':
      default:
        // If the string contains HR anywhere, treat as HR
        if (cleaned.includes('HR')) return 'HR';
        return role.split(/[_\s]+/).map((w: string) => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  };

  const resolveDisplayRole = (
    role: string | null,
    staffType?: string | null,
  ): string => {
    const normalizedRole = normalizeRole(role);
    const normalizedStaffType = String(staffType || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    if (normalizedRole === 'Staff') {
      if (normalizedStaffType === 'CASHIER_TELLER') return 'Cashier/Teller';
      if (normalizedStaffType === 'APPRAISER') return 'Appraiser';
      if (normalizedStaffType === 'INVENTORY_CUSTODIAN') return 'Inventory Custodian';
      if (normalizedStaffType === 'AUDITOR') return 'Auditor';
    }

    return normalizedRole;
  };

  const resolveFallbackRoleAndBranch = (session: any) => {
    const metaRole =
      session?.user?.user_metadata?.role ||
      session?.user?.app_metadata?.role ||
      null;
    const resolvedRole = normalizeRole(metaRole);

    const metaBranch =
      session?.user?.user_metadata?.pawnshop_id ||
      session?.user?.app_metadata?.pawnshop_id ||
      null;

    return { resolvedRole, resolvedBranch: resolvedRole === 'Super Admin' ? null : metaBranch };
  };

  useEffect(() => {
    if (!session) return;

    const ownerPendingLimited = userRole === 'Owner' && ownerRegistrationStatus !== 'APPROVED';
    const subscriptionLocked = subscriptionAccessChecked && subscriptionAccessFrozen;
    if (ownerPendingLimited || subscriptionLocked) return;

    const routeTab = resolveTabFromPath(location.pathname);
    if (!routeTab || routeTab === activeTab) return;
    if (routeTab === 'pending-access' || routeTab === 'frozen-access') return;
    setActiveTab(routeTab);
  }, [session, location.pathname, activeTab, userRole, ownerRegistrationStatus, subscriptionAccessChecked, subscriptionAccessFrozen]);

  const handleSidebarNavigation = useCallback((tabId: string) => {
    setActiveTab(tabId);
    const nextPath = TAB_TO_PATH[tabId];
    if (nextPath) {
      navigate(nextPath, { replace: false });
    }
  }, [navigate]);

  useEffect(() => {
    if (!session) return;
    if ((normalizedPath || '/') !== '/subscription') return;

    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const paymentResultRaw =
      query.get('payment') ||
      query.get('status') ||
      hash.get('payment') ||
      hash.get('status') ||
      '';
    const paymentResult = String(paymentResultRaw).trim().toLowerCase();

    if (!paymentResult) return;

    setActiveTab('subscription');

    const handlePaymentCallback = async () => {
      const successHints = new Set(['success', 'paid', 'succeeded']);
      const failureHints = new Set(['failed', 'cancelled', 'canceled', 'error']);

      try {
        const [paymentLinkStatus, currentSubscription] = await Promise.all([
          api.get<any>('/subscriptions/payment-link-status').catch(() => null),
          api.get<any>('/subscriptions/current').catch(() => null),
        ]);

        const backendPaymentStatus = String(paymentLinkStatus?.status || '').trim().toLowerCase();
        const subStatus = String(currentSubscription?.status || '').trim().toUpperCase();
        const subTier = String(currentSubscription?.tier || '').trim().toUpperCase();
        const hasPaidSubscription =
          subTier !== '' &&
          subTier !== 'FREE' &&
          ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(subStatus);

        if (backendPaymentStatus === 'paid' || hasPaidSubscription || successHints.has(paymentResult)) {
          showToast('Payment completed. Your subscription status is refreshing.', 'success');
        } else if (failureHints.has(paymentResult) || backendPaymentStatus === 'failed') {
          showToast('Payment was not completed. Please retry from Subscription.', 'error');
        } else {
          showToast('Payment status is being verified. Please refresh in a moment.', 'success');
        }
      } catch {
        if (successHints.has(paymentResult)) {
          showToast('Payment completed. Your subscription status is refreshing.', 'success');
        } else if (failureHints.has(paymentResult)) {
          showToast('Payment was not completed. Please retry from Subscription.', 'error');
        }
      } finally {
        // Clean callback params after handling to avoid repeat toasts on reload.
        navigate('/subscription', { replace: true });
      }
    };

    void handlePaymentCallback();
  }, [session, normalizedPath, location.search, location.hash, navigate, showToast]);

  useEffect(() => {
    const fetchUserData = async (userId: string, email?: string | null) => {
      try {
        const { data: profileById, error } = await supabase
          .from('profiles')
          .select('role, staff_type, pawnshop_id, branch_id')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          console.error('fetchUserData error', error);
          throw error;
        }

        if (profileById) {
          return profileById;
        }

        // Some historical accounts can have profile rows linked by email but not auth UUID.
        if (email) {
          const { data: profileByEmail, error: emailError } = await supabase
            .from('profiles')
            .select('role, staff_type, pawnshop_id, branch_id')
            .eq('email', email)
            .limit(1)
            .maybeSingle();

          if (emailError) {
            console.error('fetchUserData email fallback error', emailError);
            throw emailError;
          }

          if (profileByEmail) {
            console.warn('fetchUserData: resolved profile by email fallback');
            return profileByEmail;
          }
        }

        return null;
      } catch (err) {
        console.error('fetchUserData unexpected error', err);
        throw err;
      }
    };

    const initializeAuth = async () => {
      console.debug('initializeAuth: start');
      setLoading(true);

      // Try to get existing session from Supabase. If present, restore it immediately
      // so the UI treats the user as logged in while profile fetching runs in background.
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        console.debug('initializeAuth: got session', currentSession);

        if (currentSession) {
          // Immediately restore session so reloads don't force a re-login flow.
          setSession(currentSession);
          // Mark user as online
          supabase.from('profiles').update({ is_online: true, last_seen_at: new Date().toISOString() }).eq('id', currentSession.user.id).then();
          // Fire-and-forget profile fetch: populate role/branch when available,
          // but do NOT block or throw if profile is missing — keep user logged in.
          (async () => {
            try {
              const profile = await fetchUserData(currentSession.user.id, currentSession.user.email);
              console.debug('initializeAuth (bg): profile', profile);
              if (profile) {
                const finalRole = resolveDisplayRole(profile.role, profile.staff_type);
                let finalBranchId: string | null = finalRole === 'Super Admin' ? null : (profile.pawnshop_id || null);
                setUserRole(finalRole);
                setCurrentBranchId(finalBranchId);
                localStorage.setItem('user_role', finalRole);
                if (finalBranchId) localStorage.setItem('active_pawnshop_id', finalBranchId);
                if (profile?.branch_id) {
                  localStorage.setItem('active_branch_id', String(profile.branch_id));
                  const parsedBranchId = Number(profile.branch_id);
                  if (Number.isInteger(parsedBranchId) && parsedBranchId > 0) {
                    setActiveOperationalBranchId(parsedBranchId);
                  }
                }
                if (finalRole === 'Super Admin') setActiveTab('platform-control');
              } else {
                const { resolvedRole, resolvedBranch } = resolveFallbackRoleAndBranch(currentSession);
                console.warn('initializeAuth (bg): profile not found — using fallback role/branch', { resolvedRole, resolvedBranch });
                setUserRole(resolvedRole);
                setCurrentBranchId(resolvedBranch);
                localStorage.setItem('user_role', resolvedRole);
                if (resolvedBranch) localStorage.setItem('active_pawnshop_id', resolvedBranch);
                if (resolvedRole === 'Super Admin') setActiveTab('platform-control');
              }
            } catch (bgErr) {
              console.error('initializeAuth (bg) profile fetch error:', bgErr);
              const { resolvedRole, resolvedBranch } = resolveFallbackRoleAndBranch(currentSession);
              setUserRole(resolvedRole);
              setCurrentBranchId(resolvedBranch);
              localStorage.setItem('user_role', resolvedRole);
              if (resolvedBranch) localStorage.setItem('active_pawnshop_id', resolvedBranch);
              if (resolvedRole === 'Super Admin') setActiveTab('platform-control');
            }
          })();

          // Done: we can stop showing the loading spinner now — session restored.
          setLoading(false);
          return;
        }

        console.debug('initializeAuth: no session found, showing Login');
      } catch (err: unknown) {
        console.error('initializeAuth error:', err, { stack: err instanceof Error ? err.stack : undefined });
        showToast('Session initialization error. See console.', 'error');
      } finally {
        // Ensure loading is false if no session restored above
        setLoading(false);
        console.debug('initializeAuth: finished, loading set to false');
      }
    };

    // Global handlers to reveal otherwise-silent async errors
    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      console.error('UnhandledPromiseRejection:', ev.reason);
    };
    const onError = (event: ErrorEvent) => {
      console.error('Window error:', event.message, event.error || event);
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'app_perspective') {
        setIsImpersonating(e.newValue === 'SHOP');
      }
    };
    window.addEventListener('storage', onStorage);

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (_event === 'TOKEN_REFRESHED') return;
      console.debug('onAuthStateChange event, session:', _event, newSession);
      setSession(newSession);
      if (newSession) {
        supabase.from('profiles').update({ is_online: true, last_seen_at: new Date().toISOString() }).eq('id', newSession.user.id).then();
        (async () => {
          try {
            const profile = await fetchUserData(newSession.user.id, newSession.user.email);
            console.debug('onAuthStateChange profile', profile);
            if (profile) {
              const role = resolveDisplayRole(profile.role, profile.staff_type);
              setUserRole(role);
              localStorage.setItem('user_role', role);
              const finalBranchId = role === 'Super Admin' ? null : (profile.pawnshop_id || null);
              setCurrentBranchId(finalBranchId);
              if (finalBranchId) localStorage.setItem('active_pawnshop_id', finalBranchId);
              else localStorage.removeItem('active_pawnshop_id');
              if (profile?.branch_id) {
                localStorage.setItem('active_branch_id', String(profile.branch_id));
                const parsedBranchId = Number(profile.branch_id);
                if (Number.isInteger(parsedBranchId) && parsedBranchId > 0) {
                  setActiveOperationalBranchId(parsedBranchId);
                }
              }
            } else {
              const { resolvedRole, resolvedBranch } = resolveFallbackRoleAndBranch(newSession);
              console.warn('onAuthStateChange: profile missing — using fallback role/branch', { resolvedRole, resolvedBranch });
              setUserRole(resolvedRole);
              setCurrentBranchId(resolvedBranch);
              localStorage.setItem('user_role', resolvedRole);
              if (resolvedBranch) localStorage.setItem('active_pawnshop_id', resolvedBranch);
            }
          } catch (err) {
            console.error('onAuthStateChange profile fetch error:', err);
            const { resolvedRole, resolvedBranch } = resolveFallbackRoleAndBranch(newSession);
            setUserRole(resolvedRole);
            setCurrentBranchId(resolvedBranch);
            localStorage.setItem('user_role', resolvedRole);
            if (resolvedBranch) localStorage.setItem('active_pawnshop_id', resolvedBranch);
          }
        })();
      } else if (_event === 'SIGNED_OUT') {
        localStorage.clear();
        setUserRole('Staff');
        setCurrentBranchId(null);
        setOwnerBranches([]);
        setActiveOperationalBranchId(null);
        setActiveTab('dashboard');
      }
    });

    // Set offline on tab close / navigate away
    const markOffline = () => {
      const userId = supabase.auth.getSession().then(({ data }) => data?.session?.user?.id);
      userId.then((id) => {
        if (id) {
          supabase.from('profiles').update({ is_online: false, last_seen_at: new Date().toISOString() }).eq('id', id).then();
        }
      });
    };
    window.addEventListener('beforeunload', markOffline);

    // Heartbeat: update last_seen_at every 5 minutes
    const heartbeat = setInterval(async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user?.id) {
        await supabase.from('profiles').update({ is_online: true, last_seen_at: new Date().toISOString() }).eq('id', s.user.id);
      }
    }, 5 * 60 * 1000);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', markOffline);
      clearInterval(heartbeat);
    };
  }, [isImpersonating]);

  useEffect(() => {
    // Super Admin no longer has impersonation mode.
    if (userRole === 'Super Admin' && isImpersonating) {
      localStorage.removeItem('app_perspective');
      localStorage.removeItem('branch_dashboard_stats');
      setIsImpersonating(false);
    }
  }, [userRole, isImpersonating]);

  useEffect(() => {
    const syncOwnerBranches = async () => {
      if (!session?.user?.id || userRole !== 'Owner' || !currentBranchId) {
        setOwnerBranches([]);
        return;
      }

      try {
        const response = await api.get<BranchListResponse>('/tenant-governance/branches', {
          pawnshopId: currentBranchId,
        });

        const branches = Array.isArray(response?.branches) ? response.branches : [];
        setOwnerBranches(branches);

        if (branches.length === 0) {
          setActiveOperationalBranchId(null);
          localStorage.removeItem('active_branch_id');
          return;
        }

        const stored = localStorage.getItem('active_branch_id');
        const parsedStored = stored ? Number(stored) : NaN;
        const hasStored = Number.isInteger(parsedStored) && branches.some((b) => b.id === parsedStored);
        const nextBranchId = hasStored ? parsedStored : null;

        setActiveOperationalBranchId(nextBranchId);
        if (nextBranchId != null) {
          localStorage.setItem('active_branch_id', String(nextBranchId));
        } else {
          localStorage.removeItem('active_branch_id');
        }
      } catch (error) {
        console.error('Failed to load owner branches for selector:', error);
      }
    };

    syncOwnerBranches();
  }, [session?.user?.id, userRole, currentBranchId]);

  useEffect(() => {
    const syncOwnerOnboardingState = async () => {
      if (!session?.user?.id || userRole !== 'Owner') {
        setOwnerRegistrationStatus('NONE');
        return;
      }

      const maybeShowTrialApprovedToast = () => {
        if (subscriptionTier !== 'TRIAL') {
          return;
        }
        const approvalToastKey = `owner_trial_approved_notice_seen_${session.user.id}`;
        if (!localStorage.getItem(approvalToastKey)) {
          showToast('YOUR FREE TRIAL APPLICATION HAS BEEN APPROVED', 'success');
          localStorage.setItem(approvalToastKey, '1');
        }
      };

      if (ownerRegistrationStatus === 'APPROVED') {
        if (subscriptionTier !== 'FREE') {
          maybeShowTrialApprovedToast();
        }
        return;
      }

      // If owner already has a non-free subscription context, treat account as approved.
      if (subscriptionTier !== 'FREE') {
        setOwnerRegistrationStatus('APPROVED');
        maybeShowTrialApprovedToast();
        return;
      }

      const clearOwnerOperationalContext = () => {
        setCurrentBranchId(null);
        setOwnerBranches([]);
        setActiveOperationalBranchId(null);
        localStorage.removeItem('active_pawnshop_id');
        localStorage.removeItem('active_branch_id');
      };

      const preserveExistingOwnerAccess = () => {
        const existingPawnshopId = currentBranchId || localStorage.getItem('active_pawnshop_id');
        if (!existingPawnshopId) return false;

        setOwnerRegistrationStatus('APPROVED');
        setCurrentBranchId(existingPawnshopId);
        localStorage.setItem('active_pawnshop_id', existingPawnshopId);
        return true;
      };

      setOwnerRegistrationStatus('LOADING');
      setOwnerRegistrationChecked(false);

      try {
        const rows = await api.get<OwnerRegistrationRequest[]>(
          '/tenant-governance/client-registrations/me',
        );

        const latest = Array.isArray(rows) ? rows[0] : null;
        if (!latest) {
          // Legacy owners may not have registration rows but are already linked to a pawnshop.
          const { data: profileById } = await supabase
            .from('profiles')
            .select('pawnshop_id')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profileById?.pawnshop_id) {
            setOwnerRegistrationStatus('APPROVED');
            setCurrentBranchId(profileById.pawnshop_id);
            localStorage.setItem('active_pawnshop_id', profileById.pawnshop_id);
            return;
          }

          if (preserveExistingOwnerAccess()) {
            return;
          }

          setOwnerRegistrationStatus('NONE');
          clearOwnerOperationalContext();
          return;
        }

        const normalizedStatus = String(latest.status || 'PENDING').toUpperCase();
        setOwnerRegistrationStatus(normalizedStatus);

        if (normalizedStatus === 'APPROVED') {
          maybeShowTrialApprovedToast();

          const { data: profileById } = await supabase
            .from('profiles')
            .select('pawnshop_id')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profileById?.pawnshop_id) {
            setCurrentBranchId(profileById.pawnshop_id);
            localStorage.setItem('active_pawnshop_id', profileById.pawnshop_id);
          } else {
            clearOwnerOperationalContext();
          }
        } else {
          // Keep non-approved owners in pending-access workspace only.
          clearOwnerOperationalContext();
        }
      } catch {
        if (preserveExistingOwnerAccess()) {
          return;
        }

        setOwnerRegistrationStatus('NONE');
        clearOwnerOperationalContext();
      } finally {
        setOwnerRegistrationChecked(true);
      }
    };

    syncOwnerOnboardingState();
  }, [session?.user?.id, userRole, currentBranchId, showToast, subscriptionTier]);

  useEffect(() => {
    const loadActiveOperationalBranchName = async () => {
      // Owner branch names come from the owner branch list selector.
      if (userRole === 'Owner') {
        setActiveOperationalBranchName(null);
        return;
      }

      // Super Admin (without impersonation) should retain platform branding.
      if (userRole === 'Super Admin' && !isImpersonating) {
        setActiveOperationalBranchName(null);
        return;
      }

      if (!session?.user?.id || activeOperationalBranchId == null) {
        setActiveOperationalBranchName(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('branch')
          .select('name')
          .eq('id', activeOperationalBranchId)
          .maybeSingle();

        if (error) throw error;
        setActiveOperationalBranchName(data?.name || null);
      } catch {
        setActiveOperationalBranchName(null);
      }
    };

    loadActiveOperationalBranchName();
  }, [session?.user?.id, userRole, isImpersonating, activeOperationalBranchId]);

  const [systemConfig, setSystemConfig] = useState({ 
    crm_enabled: true, 
    vault_enabled: true, 
    finance_enabled: true, 
    hr_enabled: true, 
    auction_enabled: true, 
    decision_enabled: true,
    alerts_enabled: true,
  });

  // Global overrides set by Super Admin — if a key is false, the feature is OFF for all branches
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadSystemConfig = async () => {
      try {
        // Branch users read their branch row; super admin falls back to first row.
        const query = supabase.from('pawnshops').select('settings').limit(1);
        const { data, error } = currentBranchId
          ? await query.eq('id', currentBranchId).maybeSingle()
          : await query.maybeSingle();

        if (error) {
          console.error('Failed to load system config:', error);
          return;
        }

        if (data?.settings) {
          const { global_overrides, ...localSettings } = data.settings;
          if (global_overrides) {
            setGlobalOverrides(global_overrides);
          }
          setSystemConfig((prev) => ({ ...prev, ...localSettings }));
        }
      } catch (err) {
        console.error('Unexpected error while loading system config:', err);
      }
    };

    if (session) {
      loadSystemConfig();
    }
  }, [session, currentBranchId]);

  useEffect(() => {
    const loadSubscription = async () => {
      // Only OWNER can read subscription/billing endpoints. Non-owner roles should not
      // be downgraded to FREE navigation when endpoint access is intentionally forbidden.
      if (!session || userRole === 'Super Admin' || userRole !== 'Owner') {
        setSubscriptionTier('FREE');
        setSubscriptionTierLoaded(true);
        return;
      }

      // Skip subscription fetch for pending owners (no pawnshop assigned yet)
      if (ownerRegistrationStatus !== 'APPROVED') {
        setSubscriptionTier('FREE');
        setSubscriptionTierLoaded(true);
        return;
      }

      try {
        setSubscriptionTierLoaded(false);
        const sub = await api.get('/subscriptions/current');
        const subStatus = String((sub as any)?.status || '').toUpperCase();
        const tier = (sub as any)?.tier;
        if (subStatus === 'TRIAL') {
          setSubscriptionTier('TRIAL');
          return;
        }
        if (tier === 'BASIC' || tier === 'PROFESSIONAL' || tier === 'ENTERPRISE') {
          setSubscriptionTier(tier);
          return;
        }
        setSubscriptionTier('FREE');
      } catch {
        // Fail-safe: treat as FREE when subscription service is unavailable.
        setSubscriptionTier('FREE');
      } finally {
        setSubscriptionTierLoaded(true);
      }
    };

    loadSubscription();
  }, [session, userRole, currentBranchId, ownerRegistrationStatus, subscriptionRefreshKey]);

  useEffect(() => {
    const loadSubscriptionAccessStatus = async () => {
      if (!session || userRole === 'Super Admin') {
        setSubscriptionAccessFrozen(false);
        setSubscriptionAccessChecked(true);
        return;
      }

      if (userRole === 'Owner' && ownerRegistrationStatus !== 'APPROVED') {
        if (ownerRegistrationStatus === 'LOADING' || !ownerRegistrationChecked) return;
        setSubscriptionAccessFrozen(false);
        setSubscriptionAccessChecked(true);
        return;
      }

      if (!currentBranchId) return;

      try {
        setSubscriptionAccessChecked(false);
        const status = await api.get<{
          frozen?: boolean;
          canOperate?: boolean;
        }>('/subscriptions/access-status');

        const isFrozen = Boolean(status?.frozen) || status?.canOperate === false;
        setSubscriptionAccessFrozen(isFrozen);
      } catch {
        // Do not hard-lock users if status cannot be resolved.
        setSubscriptionAccessFrozen(false);
      } finally {
        setSubscriptionAccessChecked(true);
      }
    };

    loadSubscriptionAccessStatus();
  }, [session, userRole, currentBranchId, ownerRegistrationStatus, subscriptionRefreshKey]);

  useEffect(() => {
    const checkSupportAccess = async () => {
      if (!session || userRole !== 'Super Admin' || !isImpersonating) {
        setHasApprovedSupportAccess(true);
        setSupportAccessChecked(true);
        return;
      }

      const impersonationPawnshopId =
        localStorage.getItem('active_pawnshop_id') || currentBranchId;

      if (!impersonationPawnshopId) {
        setHasApprovedSupportAccess(false);
        setSupportAccessChecked(true);
        return;
      }

      try {
        setSupportAccessChecked(false);
        const status = await api.get<{ hasApprovedAccess: boolean }>(
          '/tenant-governance/support-access/status',
          { pawnshopId: impersonationPawnshopId },
        );
        setHasApprovedSupportAccess(Boolean(status?.hasApprovedAccess));
      } catch {
        setHasApprovedSupportAccess(false);
      } finally {
        setSupportAccessChecked(true);
      }
    };

    checkSupportAccess();
  }, [session, userRole, isImpersonating, currentBranchId]);

  useEffect(() => {
    const loadSidebarBranding = async () => {
      if (!session) {
        setSidebarBranding(DEFAULT_SIDEBAR_BRANDING);
        setBrandLogoFailed(false);
        return;
      }

      if (userRole === 'Super Admin' && !isImpersonating) {
        setSidebarBranding(DEFAULT_SIDEBAR_BRANDING);
        setBrandLogoFailed(false);
        return;
      }

      try {
        const query = userRole === 'Super Admin' && isImpersonating && currentBranchId
          ? { pawnshopId: currentBranchId }
          : undefined;

        const response = await api.get<any>('/tenant-governance/branding', query);
        const branding = response?.branding || response || {};

        const resolved: SidebarBranding = {
          pawnshopId: branding.pawnshopId || currentBranchId || null,
          pawnshopName: branding.pawnshopName || null,
          displayName: branding.displayName || branding.pawnshopName || 'PawnGold',
          logoUrl: branding.logoUrl || null,
          primaryColor: branding.primaryColor || DEFAULT_SIDEBAR_BRANDING.primaryColor,
          secondaryColor: branding.secondaryColor || DEFAULT_SIDEBAR_BRANDING.secondaryColor,
          customBrandingEnabled: Boolean(branding.customBrandingEnabled),
        };

        setSidebarBranding(resolved);
        setBrandLogoFailed(false);
      } catch {
        // Fallback to pawnshop name when branding endpoint is unavailable.
        if (currentBranchId && userRole !== 'Super Admin') {
          try {
            const { data } = await supabase
              .from('pawnshops')
              .select('name')
              .eq('id', currentBranchId)
              .maybeSingle();

            setSidebarBranding({
              ...DEFAULT_SIDEBAR_BRANDING,
              pawnshopId: currentBranchId,
              pawnshopName: data?.name || null,
              displayName: data?.name || 'PawnGold',
            });
            setBrandLogoFailed(false);
            return;
          } catch {
            // Ignore fallback errors and keep static defaults.
          }
        }

        setSidebarBranding(DEFAULT_SIDEBAR_BRANDING);
        setBrandLogoFailed(false);
      }
    };

    loadSidebarBranding();
  }, [session, userRole, isImpersonating, currentBranchId]);

  const lockImpersonationPanels =
    userRole === 'Super Admin' && isImpersonating && (!supportAccessChecked || !hasApprovedSupportAccess);

  const ownerHasApprovedAccess =
    userRole !== 'Owner'
      ? true
      : ownerRegistrationStatus === 'APPROVED';

  const isPendingLimitedMode =
    userRole === 'Owner' && !ownerHasApprovedAccess;

  const isSubscriptionFrozen =
    userRole !== 'Super Admin' &&
    subscriptionAccessChecked &&
    subscriptionAccessFrozen;

  const shouldShowOperationalBranchAsBrand =
    userRole !== 'Super Admin' && userRole !== 'Owner' && Boolean(activeOperationalBranchName);

  const sidebarBrandName =
    (shouldShowOperationalBranchAsBrand ? activeOperationalBranchName : null) ||
    sidebarBranding.displayName ||
    (userRole === 'Super Admin' && !isImpersonating
      ? 'PawnGold'
      : sidebarBranding.pawnshopName || 'PawnGold');

  const isEnabled = (featureKey: string) => {
    if (userRole === 'Super Admin' && !isImpersonating) return true;
    // Global override: if Super Admin turned it off, it's off for all branches
    if (globalOverrides[featureKey] === false) return false;
    // Subscription-gated: paid tiers that include auction access get the module even
    // if the local toggle was left off from an earlier trial setup.
    if (
      featureKey === 'auction_enabled' &&
      effectiveUserRole === 'Owner' &&
      (subscriptionTier === 'PROFESSIONAL' || subscriptionTier === 'ENTERPRISE')
    ) {
      return true;
    }
    return (systemConfig as any)[featureKey];
  };

  const handleSignOut = async () => {
    const userId = session?.user?.id;
    if (userId) {
      await supabase.from('profiles').update({ is_online: false, last_seen_at: new Date().toISOString() }).eq('id', userId);
    }
    await supabase.auth.signOut();
    localStorage.clear();
    window.location.href = "/";
  };

  const handleExitLiveAnalytics = () => {
    localStorage.removeItem('app_perspective');
    localStorage.removeItem('branch_dashboard_stats');

    if (userRole === 'Super Admin') {
      localStorage.removeItem('active_pawnshop_id');
      localStorage.setItem('user_role', 'Super Admin');
      setIsImpersonating(false);
      setCurrentBranchId(null);
      setActiveTab('platform-control');
      window.location.assign('/');
      return;
    }

    // Owner exit should return to main pawnshop context, not keep the last live branch filter.
    localStorage.removeItem('active_branch_id');
    setActiveOperationalBranchId(null);
    setIsImpersonating(false);
    setActiveTab('dashboard');
  };

  const handleOwnerEnterLiveDashboard = (branchId: number) => {
    if (!Number.isInteger(branchId) || branchId <= 0) return;
    setActiveOperationalBranchId(branchId);
    localStorage.setItem('active_branch_id', String(branchId));
    localStorage.setItem('app_perspective', 'SHOP');
    setIsImpersonating(true);
    setActiveTab('dashboard');
  };



  // ── Self-service clock-in/out ──
  const [clockStatus, setClockStatus] = useState<'not_clocked' | 'clocked_in' | 'clocked_out' | 'loading'>('loading');
  const [clockLoading, setClockLoading] = useState(false);
  const [clockInTime, setClockInTime] = useState<string | null>(null);

  const checkClockStatus = useCallback(async () => {
    if (!session?.user?.id || userRole === 'Super Admin' || userRole === 'Owner') return;
    if (!currentBranchId) return;
    try {
      const staffList = await api.get('/attendance/staff-list');
      if (Array.isArray(staffList)) {
        const me = staffList.find((s: any) => s.id === session.user.id);
        if (me) {
          if (me.clockOut) {
            setClockStatus('clocked_out');
            setClockInTime(me.clockIn);
          } else if (me.clockIn) {
            setClockStatus('clocked_in');
            setClockInTime(me.clockIn);
          } else {
            setClockStatus('not_clocked');
            setClockInTime(null);
          }
        } else {
          setClockStatus('not_clocked');
        }
      }
    } catch {
      setClockStatus('not_clocked');
    }
  }, [session?.user?.id, userRole, currentBranchId]);

  useEffect(() => {
    if (session?.user?.id && userRole !== 'Super Admin' && userRole !== 'Owner') {
      checkClockStatus();
    }
  }, [session?.user?.id, userRole, currentBranchId, checkClockStatus]);

  const handleClockIn = async () => {
    if (!session?.user?.id) return;
    setClockLoading(true);
    try {
      await api.post('/attendance/clock-in', { staffId: session.user.id });
      showToast('Clocked in successfully!', 'success');
      await checkClockStatus();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setClockLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!session?.user?.id) return;
    setClockLoading(true);
    try {
      await api.post('/attendance/clock-out', { staffId: session.user.id });
      showToast('Clocked out successfully!', 'success');
      await checkClockStatus();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setClockLoading(false);
    }
  };

  // --- NAVIGATION CONFIG ---
  const filteredNavItems = useMemo(() =>
    STATIC_NAV_ITEMS.filter(item => {
    if (isSubscriptionFrozen) {
      if (effectiveUserRole === 'Owner') {
        return item.id === 'subscription' || item.id === 'frozen-access';
      }
      return item.id === 'frozen-access';
    }

    if (isPendingLimitedMode && ownerRegistrationChecked) {
      return item.id === 'pending-access';
    }

    if (item.id === 'pending-access') {
      return false;
    }

    if (item.id === 'frozen-access') {
      return false;
    }

    if (userRole === 'Super Admin') {
      return item.type === 'PLATFORM';
    }
    // HR always sees Staff Matrix and Payroll
    if (effectiveUserRole === 'HR' && (item.id === 'hr' || item.id === 'payroll')) {
      return true;
    }
    const roleMatch = item.roles?.includes(effectiveUserRole);
    const featureEnabled = item.feature
      ? (item.id === 'hr' && (isImpersonating || effectiveUserRole === 'Admin') ? true : isEnabled(item.feature))
      : true;

    const trialAllowed = effectiveUserRole === 'Owner' && subscriptionTier === 'TRIAL'
      ? !TRIAL_RESTRICTED_OWNER_NAV_IDS.has(item.id)
      : true;

    const subscriptionAllowed = effectiveUserRole === 'Owner'
      ? (subscriptionTier !== 'FREE' || FREE_ALLOWED_NAV_IDS.has(item.id))
      : true;
    return item.type === 'OPERATIONAL' && roleMatch && featureEnabled && subscriptionAllowed && trialAllowed;
    }),
    [isSubscriptionFrozen, effectiveUserRole, isPendingLimitedMode, ownerRegistrationChecked,
     userRole, isImpersonating, subscriptionTier, globalOverrides, systemConfig]
  );

  const getSidebarCategory = (item: { id: string; type: string }) => {
    if (item.id === 'pending-access' || item.id === 'frozen-access' || item.id === 'subscription' || item.id === 'compliance') {
      return 'Access';
    }
    if (item.type === 'PLATFORM') {
      return 'Platform';
    }
    if (
      item.id === 'branch-system-settings' ||
      item.id === 'multi-branches' ||
      item.id === 'system-settings' ||
      item.id === 'trial-requests'
    ) {
      return 'System';
    }
    if (item.id === 'finance' || item.id === 'finance-ledger' || item.id === 'payroll') {
      return 'Finance';
    }
    if (item.id === 'hr' || item.id === 'attendance') {
      return 'People';
    }
    if (item.id === 'auction-queue' || item.id === 'auction-settlements' || item.id === 'auction-live') {
      return 'Auctions';
    }
    if (item.id === 'support-chat') {
      return 'Support';
    }
    return 'Operations';
  };

  const sidebarQuery = sidebarFilter.trim().toLowerCase();
  const sidebarVisibleNavItems = filteredNavItems.filter((item) =>
    item.label.toLowerCase().includes(sidebarQuery)
  );
  const sidebarCategoryOrder = ['Platform', 'Access', 'System', 'Operations', 'Auctions', 'Finance', 'People', 'Support'];
  const sidebarSections = sidebarCategoryOrder
    .map((category) => ({
      category,
      items: sidebarVisibleNavItems.filter((item) => getSidebarCategory(item) === category),
    }))
    .filter((section) => section.items.length > 0);

  useEffect(() => {
    if (loading || !session) return;
    if (userRole === 'Super Admin') return;
    if (lockImpersonationPanels) {
      setActiveTab('dashboard');
      return;
    }
    const canAccessActiveTab = filteredNavItems.some((item) => item.id === activeTab);
    if (!canAccessActiveTab) {
      const fallbackId = filteredNavItems[0]?.id || 'dashboard';
      setActiveTab(fallbackId);
      const fallbackPath = TAB_TO_PATH[fallbackId];
      if (fallbackPath && normalizedPath !== fallbackPath) {
        navigate(fallbackPath, { replace: true });
      }
    }
  }, [activeTab, filteredNavItems, userRole, isImpersonating, lockImpersonationPanels, loading, session, normalizedPath, navigate]);

  useEffect(() => {
    if (!session?.user?.id || userRole !== 'Owner' || isSubscriptionFrozen) {
      return;
    }

    if (hasOnboardingIntent || (isPendingLimitedMode && ownerRegistrationChecked)) {
      setActiveTab('pending-access');
    }
  }, [session?.user?.id, userRole, hasOnboardingIntent, isPendingLimitedMode, ownerRegistrationChecked, isSubscriptionFrozen]);

  useEffect(() => {
    if (!session || userRole === 'Super Admin' || !isSubscriptionFrozen) {
      return;
    }

    if (effectiveUserRole === 'Owner') {
      setActiveTab('subscription');
      return;
    }

    setActiveTab('frozen-access');
  }, [session, userRole, effectiveUserRole, isSubscriptionFrozen]);

  const isSubscriptionReady = !session || userRole === 'Super Admin' || (subscriptionAccessChecked && subscriptionTierLoaded);

  if (loading || !isSubscriptionReady) {
    return (
      <div className="h-screen w-screen bg-[#0A0A0F] flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-[#C9A05C]/10 border border-[#C9A05C]/20 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-[#C9A05C]" />
          </div>
          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#C9A05C] animate-pulse" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-[#F5F0E8] text-sm font-medium" style={{ fontFamily: "'DM Sans', sans-serif" }}>Loading your vault</p>
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#C9A05C] animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-[#C9A05C]/70 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-[#C9A05C]/40 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!loading && isPendingLimitedMode && ownerRegistrationChecked) {
    return (
      <PendingAccessDashboard
        ownerEmail={session?.user?.email ?? null}
        ownerName={
          (session?.user?.user_metadata?.full_name as string | undefined) ||
          (session?.user?.user_metadata?.name as string | undefined) ||
          null
        }
        registrationStatus={ownerRegistrationStatus}
      />
    );
  }

  if (isResetPasswordRoute) return <ResetPassword />;
  if (!session) {
    if (isLoginRoute) return <Login />;
    return <LandingPage />;
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      <div className="flex h-screen w-screen bg-[#0A0A0F] overflow-hidden relative text-left">

        {!lockImpersonationPanels && (
        <aside
          className="w-72 text-[#F5F0E8] p-6 hidden lg:flex flex-col border-r border-[rgba(201,160,92,0.08)] h-full shrink-0"
          style={{ backgroundColor: sidebarBranding.secondaryColor || '#0A0A0F' }}
        >
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div
                className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shadow-lg"
                style={{
                  backgroundColor:
                    sidebarBranding.logoUrl && !brandLogoFailed
                      ? '#FFFFFF'
                      : sidebarBranding.primaryColor || '#C9A05C',
                }}
              >
                {sidebarBranding.logoUrl && !brandLogoFailed ? (
                  <img
                    src={sidebarBranding.logoUrl}
                    alt={sidebarBrandName}
                    className="w-full h-full object-cover"
                    onError={() => setBrandLogoFailed(true)}
                  />
                ) : (
                  <ShieldCheck className="w-6 h-6 text-[#0A0A0F]" />
                )}
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight leading-none" style={{ fontFamily: "'Syne', sans-serif" }}>{sidebarBrandName}</h1>
                <p
                  className="text-[9px] font-semibold uppercase tracking-[0.18em] mt-1.5"
                  style={{ color: sidebarBranding.primaryColor || '#C9A05C' }}
                >
                  {isImpersonating ? 'LIVE BRANCH' : userRole}
                </p>
              </div>
            </div>
            {session?.user?.id && <NotificationCenter userId={session.user.id} />}
          </div>

          <div className="mb-4">
            <input
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.target.value)}
              placeholder="Search navigation..."
              className="w-full rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.1)] px-4 py-2.5 text-sm font-medium text-[#F5F0E8] placeholder:text-[#8A8279] focus:outline-none focus:ring-2 focus:ring-[#C9A05C]/40 focus:border-[#C9A05C]/30 transition-all"
            />
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto pr-1 custom-scrollbar">
            {sidebarSections.length === 0 && (
              <p className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[#8A8279]">
                No matching actions
              </p>
            )}

            {sidebarSections.map((section) => (
              <div key={section.category} className="space-y-1">
                <p className="px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#8A8279]">
                  {section.category}
                </p>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSidebarNavigation(item.id)}
                      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? 'bg-[#C9A05C]/10 text-[#E5C88C] border border-[rgba(201,160,92,0.15)]'
                          : 'text-[#8A8279] hover:text-[#F5F0E8] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-[#C9A05C]' : ''}`} />
                        <span>{item.label}</span>
                      </div>
                      {isActive && <div className="w-1 h-1 rounded-full bg-[#C9A05C]" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="mt-auto pt-5 border-t border-[rgba(201,160,92,0.08)] space-y-3">
            <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium text-[#8A8279] hover:bg-[#D44545]/10 hover:text-[#D44545] transition-all">
              <LogOut className="w-[18px] h-[18px]" /> Sign Out
            </button>
            <p className="text-[10px] text-[#6B655C] font-medium pl-3.5">{branchName}</p>
          </div>
        </aside>
        )}

        <main className="flex-1 h-full overflow-y-auto bg-[#0A0A0F] relative">
          {isImpersonating && (
            <div className="sticky top-0 z-[50] w-full bg-[rgba(10,10,15,0.85)] backdrop-blur-xl px-8 py-4 flex justify-between items-center border-b border-[rgba(212,69,69,0.2)]">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#D44545] animate-pulse" />
                  <p className="text-[10px] font-semibold text-[#F5F0E8] uppercase tracking-widest" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                    Impersonating: <span className="text-[#D44545]">{branchName}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {supportAccessChecked && lockImpersonationPanels && (
                    <p className="text-[10px] font-semibold text-[#D4A84B] uppercase tracking-widest bg-[#D4A84B]/10 border border-[#D4A84B]/20 px-3 py-2 rounded-lg">
                      Support access not approved
                    </p>
                  )}
                  <button
                    onClick={handleExitLiveAnalytics}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D44545]/10 border border-[#D44545]/20 text-[#D44545] text-[10px] font-semibold uppercase tracking-widest hover:bg-[#D44545] hover:text-white transition-all"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Exit
                  </button>
                </div>
            </div>
          )}

          <div className="p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            {userRole !== 'Super Admin' && userRole !== 'Owner' && !isPendingLimitedMode && !isSubscriptionFrozen && clockStatus !== 'loading' && (
              <div className={`mb-5 rounded-xl border px-5 py-3.5 flex items-center justify-between transition-all ${
                clockStatus === 'not_clocked'
                  ? 'bg-[#D4A84B]/8 border-[#D4A84B]/20'
                  : clockStatus === 'clocked_in'
                  ? 'bg-[#3DA86C]/8 border-[#3DA86C]/20'
                  : 'bg-[#1C1C26] border-[rgba(201,160,92,0.1)]'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    clockStatus === 'not_clocked' ? 'bg-[#D4A84B]/15' : clockStatus === 'clocked_in' ? 'bg-[#3DA86C]/15' : 'bg-[#1C1C26]'
                  }`}>
                    <Clock className={`w-4 h-4 ${
                      clockStatus === 'not_clocked' ? 'text-[#D4A84B]' : clockStatus === 'clocked_in' ? 'text-[#3DA86C]' : 'text-[#8A8279]'
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-[#F5F0E8]">
                      {clockStatus === 'not_clocked' && "Not clocked in yet"}
                      {clockStatus === 'clocked_in' && `Active since ${clockInTime ? new Date(clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}`}
                      {clockStatus === 'clocked_out' && 'Clocked out for today'}
                    </p>
                    <p className="text-xs text-[#8A8279]">
                      {clockStatus === 'not_clocked' && 'Click to start your shift'}
                      {clockStatus === 'clocked_in' && 'Clock out when done'}
                      {clockStatus === 'clocked_out' && 'See you tomorrow'}
                    </p>
                  </div>
                </div>
                {clockStatus === 'not_clocked' && (
                  <button
                    onClick={handleClockIn}
                    disabled={clockLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-[#3DA86C] text-[#0A0A0F] rounded-lg font-medium text-xs uppercase tracking-wider hover:bg-[#3DA86C]/90 transition-all disabled:opacity-50"
                  >
                    {clockLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                    Clock In
                  </button>
                )}
                {clockStatus === 'clocked_in' && (
                  <button
                    onClick={handleClockOut}
                    disabled={clockLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-[#D44545] text-white rounded-lg font-medium text-xs uppercase tracking-wider hover:bg-[#D44545]/90 transition-all disabled:opacity-50"
                  >
                    {clockLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOutIcon className="w-3.5 h-3.5" />}
                    Clock Out
                  </button>
                )}
              </div>
            )}
            {activeTab === 'pending-access' && isPendingLimitedMode && (
              <PendingAccessDashboard
                ownerEmail={session?.user?.email ?? null}
                ownerName={
                  (session?.user?.user_metadata?.full_name as string | undefined) ||
                  (session?.user?.user_metadata?.name as string | undefined) ||
                  null
                }
                registrationStatus={ownerRegistrationStatus}
              />
            )}
            {activeTab === 'frozen-access' && isSubscriptionFrozen && (
              <div className="rounded-xl border border-[#D44545]/20 bg-[#D44545]/5 p-8 lg:p-10 max-w-4xl">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#D44545]/10 flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6 text-[#D44545]" />
                  </div>
                  <div>
                    <h2 className="text-xl text-[#F5F0E8] tracking-tight" style={{ fontFamily: "'Syne', sans-serif" }}>Subscription Required</h2>
                    <p className="text-sm text-[#B8B0A4] mt-2 max-w-2xl leading-relaxed">
                      Your subscription has expired or has been cancelled. All operational modules are locked for every branch until a new subscription is activated.
                    </p>
                    <div className="mt-4 p-4 rounded-lg bg-[#1C1C26] border border-[rgba(201,160,92,0.15)]">
                      <p className="text-sm text-[#C9A05C] font-semibold">To regain access:</p>
                      <ol className="text-xs text-[#B8B0A4] mt-2 space-y-1 list-decimal list-inside">
                        <li>Go to <span className="text-[#C9A05C] font-medium">Subscription & Billing</span> in the sidebar</li>
                        <li>Choose a plan and complete payment</li>
                        <li>Access will be restored immediately after payment confirmation</li>
                      </ol>
                    </div>
                    <p className="text-xs text-[#8A8279] mt-4 uppercase tracking-wider font-semibold">
                      Only the pawnshop owner can reactivate access.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="animate-spin h-8 w-8 text-[#C9A05C]" /></div>}>
            {activeTab === 'dashboard' && (
              <Dashboard 
                branchId={currentBranchId} 
                activeBranchId={activeOperationalBranchId}
                setActiveTab={setActiveTab} 
                isEnabled={isEnabled} 
              />
            )}
            {activeTab === 'sales' && <LoanManagement branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'approval-queue' && <ApprovalQueue branchId={currentBranchId} activeBranchId={activeOperationalBranchId} userRole={userRole} />}
            {activeTab === 'audit-history' && (effectiveUserRole === 'Owner' || effectiveUserRole === 'Admin') && (
              <AuditHistory branchId={currentBranchId} userRole={effectiveUserRole} />
            )}
            {activeTab === 'redemption' && <Redemption branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'crm' && <CrmTable branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'inventory' && <InventoryVault branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'decision' && <DecisionSupport branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'auction-queue' && <AuctionQueue branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'auction-settlements' && <AuctionSettlements branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'bidder-kyc' && <BidderKycReview />}
            {activeTab === 'auction-live' && <AuctionMarketplace branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'finance' && <FinanceTreasury branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'hr' && (
              <StaffMatrix
                branchId={currentBranchId}
                userRole={effectiveUserRole}
                activeBranchId={activeOperationalBranchId}
              />
            )}
            {activeTab === 'loan-history' && <TransactionHistory />}
            {activeTab === 'queue-mgmt' && <QueueManagement branchId={currentBranchId} />}
            {activeTab === 'finance-ledger' && <FinanceLedger branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'attendance' && <AttendanceTracker branchId={currentBranchId} activeBranchId={activeOperationalBranchId} userRole={userRole} />}
            {activeTab === 'payroll' && <PayrollManagement branchId={currentBranchId} activeBranchId={activeOperationalBranchId} />}
            {activeTab === 'compliance' && <OwnerComplianceDashboard />}
            {activeTab === 'subscription' && userRole === 'Owner' && <SubscriptionManager branchId={currentBranchId} onSubscriptionChange={() => setSubscriptionRefreshKey(k => k + 1)} />}
            {activeTab === 'support-chat' && ['Owner', 'Admin', 'Super Admin'].includes(userRole) && (
              <SupportChat pawnshopId={currentBranchId} userRole={userRole} />
            )}
            {activeTab === 'multi-branches' && (
              <MultiBranchManagement
                pawnshopId={currentBranchId}
                userRole={effectiveUserRole}
                activeBranchId={activeOperationalBranchId}
                onEnterLiveDashboard={handleOwnerEnterLiveDashboard}
              />
            )}

            {activeTab === 'branch-system-settings' && userRole !== 'Super Admin' && (
              <SystemSettings
                config={systemConfig}
                setConfig={setSystemConfig}
                userRole={userRole}
                branchId={currentBranchId}
                onBrandingUpdated={(branding) => {
                  setSidebarBranding((prev) => ({
                    ...prev,
                    pawnshopId: branding.pawnshopId || prev.pawnshopId,
                    pawnshopName: branding.pawnshopName || prev.pawnshopName,
                    displayName: branding.displayName || prev.displayName,
                    logoUrl: branding.logoUrl || null,
                    primaryColor: branding.primaryColor || prev.primaryColor,
                    secondaryColor: branding.secondaryColor || prev.secondaryColor,
                    customBrandingEnabled: Boolean(branding.customBrandingEnabled),
                  }));
                  setBrandLogoFailed(false);
                }}
              />
            )}
            
            {(activeTab === 'platform-control' || activeTab === 'system-settings' || activeTab === 'trial-requests' || activeTab === 'platform-compliance' || activeTab === 'platform-analytics') && 
             userRole === 'Super Admin' && (
              <SuperAdminDashboard 
                setActiveTab={setActiveTab} 
                activeTab={activeTab}
                globalConfig={systemConfig} 
                setGlobalConfig={setSystemConfig}
              />
            )}
            </Suspense>
          </div>
        </main>
      </div>
    </ToastContext.Provider>
  );
}

export default App;