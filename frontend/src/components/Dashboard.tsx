import { useEffect, useState } from 'react';
import { Card, CardContent, CardInner } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { 
  DollarSign, TrendingUp, Users, RotateCcw, Building2, AlertTriangle, 
  ChevronRight, Box, ShieldCheck, UserCog, CheckCircle2, Copy, Check
} from "lucide-react";
import { supabase } from '../lib/supabaseClient';
import { getBackendUrl } from '../lib/backendUrl';
import { formatCurrency } from '../lib/formatters';


export interface DashboardProps {
  branchId: string | null;
  activeBranchId?: number | null;
  setActiveTab: (tab: string) => void;
  isEnabled: (featureKey: string) => boolean;
}


export function Dashboard({
  branchId,
  activeBranchId,
  setActiveTab,
  isEnabled
}: DashboardProps) {
  const isSupportLiveView = localStorage.getItem('app_perspective') === 'SHOP';
  const activeOperationalBranchId = Number.isInteger(activeBranchId as number) ? Number(activeBranchId) : null;
  const hasActiveOperationalBranch = activeOperationalBranchId != null && activeOperationalBranchId > 0;
  
  const [stats, setStats] = useState<any>(() => {
    // Hydrate from localStorage if available (for impersonation mode)
    try {
      const cached = localStorage.getItem('branch_dashboard_stats');
      if (cached) return JSON.parse(cached);
    } catch (e) {
      console.warn('Failed to hydrate stats from localStorage', e);
    }
    return null;
  });
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthCode, setAdminAuthCode] = useState('');
  const [adminRole, setAdminRole] = useState('BRANCH_ADMIN');
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{ email: string; password: string; role: string; pawnshop: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeBranchName, setActiveBranchName] = useState<string>("Loading...");
  const [loading, setLoading] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(() => {
    // Initialize from localStorage on mount
    const storedRole = String(localStorage.getItem('user_role') || '').toUpperCase();
    return ['BRANCH_ADMIN', 'BRANCH ADMIN', 'BRANCHADMIN', 'ADMIN'].includes(storedRole);
  });
  const [lastLoadedPawnshopId, setLastLoadedPawnshopId] = useState<string | null>(null);

  // Determine targetUuid: priority is query param > localStorage > prop > null
  const getTargetUuid = () => {
    const params = new URLSearchParams(window.location.search);
    const queryPawnshop = params.get('pawnshop');
    if (queryPawnshop) {
      return queryPawnshop;
    }

    const storedPawnshop = localStorage.getItem('active_pawnshop_id');
    if (storedPawnshop) {
      return storedPawnshop;
    }

    if (branchId) {
      return branchId;
    }

    return null;
    return null;
  };

  const targetUuid = getTargetUuid();
  const HQ_UUID = '00000000-0000-0000-0000-000000000000';

  // Sync impersonation mode with localStorage
  useEffect(() => {
    const storedRole = String(localStorage.getItem('user_role') || '').toUpperCase();
    const branchAdminMode = ['BRANCH_ADMIN', 'BRANCH ADMIN', 'BRANCHADMIN', 'ADMIN'].includes(storedRole);
    setIsImpersonating(branchAdminMode);
  }, []);

  useEffect(() => {
    // Prevent loading the same pawnshop twice
    if (targetUuid && targetUuid === lastLoadedPawnshopId) {
      return;
    }

    loadDashboardData();
    if (targetUuid) {
      setLastLoadedPawnshopId(targetUuid);
    }
  }, [targetUuid, activeOperationalBranchId]);

  // Real-time sync: subscribe to Ticket changes and refresh dashboard
  useEffect(() => {
    if (!targetUuid) return;
    let mounted = true;

    const channel = supabase
      .channel('dashboard_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket' }, (payload) => {
        if (mounted) {
          loadDashboardData();
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (mounted) {
            loadDashboardData();
          }
        }
      });

    return () => {
      mounted = false;
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [targetUuid, activeOperationalBranchId]);

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      console.debug('[Dashboard] loadDashboardData start', { targetUuid });

      // If server-provided branch snapshot exists (from admin impersonation), use it first
      try {
        const cached = localStorage.getItem('branch_dashboard_stats');

        if (cached) {
          const parsed = JSON.parse(cached);
          // Cached snapshot is only trusted for support live view.




          if (parsed && isSupportLiveView && parsed.pawnshopId === targetUuid) {


            setStats({
              totalLoans: parsed.totalPrincipal || 0,
              totalInterest: parsed.projectedInterest || 0,
              portfolioGrowth: 0,
              activeTickets: parsed.activeTickets || 0,
              staffOnDuty: parsed.staffOnDuty || 0,
              efficiency: 0,
              clientCount: parsed.clientCount || 0,
              inventorySummary: parsed.inventorySummary || [] ,
              totalEarnings: parsed.totalEarnings || 0
            });
            setActiveBranchName(parsed.name || 'Branch Office');
            setIsImpersonating(true);
            setLoading(false);

            return; // skip live supabase queries to avoid RLS issues for impersonation
          }
        }
      } catch (e) {
        console.warn('Failed to parse branch_dashboard_stats', e);
      }

      // If no branch is selected, we won't fetch branch-scoped dashboard data.
      if (!targetUuid) {
        setStats({
          totalLoans: 0,
          totalInterest: 0,
          portfolioGrowth: 0,
          activeTickets: 0,
          staffOnDuty: 0,
          efficiency: 0,
          clientCount: 0,
          inventorySummary: []
        });
        setActiveBranchName('No Branch Selected');
        setLoading(false);
        return;
      }


      
      // 1. Fetch Branch Identity
      const { data: shopData, error: shopError } = await supabase
        .from('pawnshops')
        .select('id, name, status')
        .eq('id', targetUuid)
        .maybeSingle();



      if (shopError) {
        console.error('âŒ [Dashboard] Pawnshop error:', shopError.code, shopError.message);
        if (shopError.code === '42501') throw new Error("Permission Denied: Pawnshop Access Restricted");
        throw shopError;
      }

      if (!shopData) {
        console.error('âŒ [Dashboard] Pawnshop not found for UUID:', targetUuid);
        throw new Error(`Pawnshop ${targetUuid} not found`);
      }



      let resolvedBranchName = shopData?.name || (targetUuid === HQ_UUID ? "PawnGold HQ" : "Branch Office");
      if (hasActiveOperationalBranch) {
        const { data: branchData } = await supabase
          .from('branch')
          .select('name')
          .eq('id', activeOperationalBranchId)
          .maybeSingle();
        if (branchData?.name) {
          resolvedBranchName = branchData.name;
        }
      }

      setActiveBranchName(resolvedBranchName);


      // 2. Parallel Fetch: Tickets and Customer Count

      const ticketsBase = isSupportLiveView
        ? supabase.from('ticket').select('category,status').eq('pawnshop_id', targetUuid)
        : supabase.from('ticket').select('loan_amount,category,status').eq('pawnshop_id', targetUuid);

      const ticketsPromise = hasActiveOperationalBranch
        ? ticketsBase.eq('branch_id', activeOperationalBranchId as any)
        : ticketsBase;

      const customersPromise = hasActiveOperationalBranch
        ? supabase
            .from('ticket')
            .select('customer_id')
            .eq('pawnshop_id', targetUuid)
            .eq('branch_id', activeOperationalBranchId as any)
        : supabase
            .from('customer')
            .select('*', { count: 'exact', head: true })
            .eq('pawnshop_id', targetUuid);

      const [ticketsRes, customersRes] = await Promise.all([
        ticketsPromise,
        customersPromise
      ]);

      const customerCount = hasActiveOperationalBranch
        ? new Set(((customersRes as any)?.data || []).map((row: any) => row.customer_id).filter(Boolean)).size
        : ((customersRes as any)?.count || 0);



      if (ticketsRes.error) {
        console.error('âŒ [Dashboard] Tickets query error:', ticketsRes.error);
        throw ticketsRes.error;
      }
      if (customersRes.error) {
        console.error('âŒ [Dashboard] Customers query error:', customersRes.error);
        throw customersRes.error;
      }

      const tickets = ticketsRes.data || [];

      
      // --- EMPTY STATE HANDLER ---
      // If no tickets are found, we set default stats and STOP loading to prevent the loop
      if (tickets.length === 0) {
        console.warn('âš ï¸  [Dashboard] No tickets found, setting default stats');
        setStats({
          totalLoans: 0,
          totalInterest: 0,
          portfolioGrowth: 0,
          activeTickets: 0,
          staffOnDuty: 0,
          efficiency: 0,
          clientCount: customerCount,
          inventorySummary: []
        });
        setLoading(false);
  
        return;
      }


      const activeTickets = tickets.filter(t => t.status?.toUpperCase() === 'ACTIVE');
      const totalPrincipal = isSupportLiveView
        ? 0
        : activeTickets.reduce((sum, t: any) => sum + (Number(t.loan_amount) || 0), 0);
      

      
      const categoryMap = activeTickets.reduce((acc: any, t: any) => {
        const catName = t.category || 'Other';
        acc[catName] = (acc[catName] || 0) + 1;
        return acc;
      }, {});



      const finalStats = {
        totalLoans: totalPrincipal,
        totalInterest: totalPrincipal * 0.035,
        portfolioGrowth: 12.5,
        activeTickets: activeTickets.length,
        staffOnDuty: 4,
        efficiency: totalPrincipal > 0 ? 98 : 0,
        clientCount: customerCount,
        inventorySummary: Object.keys(categoryMap).map(name => ({
          name,
          count: categoryMap[name],
          color: name.toLowerCase().includes('gold') ? '#4F46E5' : '#10B981'
        })).sort((a, b) => b.count - a.count)
      };


      setStats(finalStats);
      setLoading(false);

    } catch (err: unknown) {
      console.error("âŒ [Dashboard] Load Error:", err);
      const message = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : undefined;
      const details = err && typeof err === 'object' && 'details' in err ? (err as { details: unknown }).details : undefined;
      console.error("âŒ [Dashboard] Error details:", {
        message,
        code,
        details,
      });
      setError(message.includes("permission denied") || code === '42501'
        ? "Access Denied: Please check database RLS policies." 
        : message);
      setLoading(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminSubmitting(true);
    setAdminError(null);
    try {
      // Validation
      if (!adminEmail || !adminEmail.includes('@')) {
        throw new Error('Please enter a valid email address');
      }

      if (!adminPassword || adminPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      if (!adminAuthCode.trim()) {
        throw new Error('Authentication code is required');
      }

      if (!isImpersonating) {
        throw new Error('You can only add branch admins when viewing a specific pawnshop. Please enter a branch first.');
      }

      if (!targetUuid) {
        throw new Error('Pawnshop ID is missing. Please refresh and try again.');
      }

      // Full role set — staff specializations map to role=STAFF + staff_type
      const staffSpecializations = ['CASHIER_TELLER', 'APPRAISER', 'INVENTORY_CUSTODIAN', 'AUDITOR'];
      const allowedRoles = ['BRANCH_ADMIN', 'MANAGER', 'HR', ...staffSpecializations];
      const requestedRole = String(adminRole).trim().toUpperCase();
      if (!allowedRoles.includes(requestedRole)) {
        throw new Error(`Invalid role. Allowed roles: ${allowedRoles.join(', ')}`);
      }
      const backendRole = staffSpecializations.includes(requestedRole)
        ? 'STAFF'
        : requestedRole === 'BRANCH_ADMIN' ? 'ADMIN' : requestedRole;
      const staffType = staffSpecializations.includes(requestedRole) ? requestedRole : undefined;

      // Call backend to create auth user and profile
      const backendUrl = getBackendUrl();


      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${backendUrl}/auth/create-branch-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          email: adminEmail,
          password: adminPassword,
          role: backendRole,
          staff_type: staffType,
          pawnshop_id: targetUuid,
          full_name: adminEmail.split('@')[0],
          auth_code: adminAuthCode.trim(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        })
      });

      const result = await res.json();

      if (!res.ok) {
        const errorMsg = result.message || result.error || `Failed to create admin: ${res.statusText}`;
        console.error('âŒ [Dashboard] Backend error:', result);
        throw new Error(errorMsg);
      }


      
      // Store credentials for success modal before clearing form
      const roleLabels: Record<string, string> = {
        BRANCH_ADMIN: 'Branch Admin',
        MANAGER: 'Manager',
        HR: 'HR',
        CASHIER_TELLER: 'Cashier/Teller',
        APPRAISER: 'Appraiser',
        INVENTORY_CUSTODIAN: 'Inventory Custodian',
        AUDITOR: 'Auditor',
      };
      setSuccessData({ email: adminEmail, password: adminPassword, role: roleLabels[requestedRole] || requestedRole, pawnshop: activeBranchName });

      // Clear form
      setAdminEmail('');
      setAdminPassword('');
      setAdminAuthCode('');
      setAdminRole('BRANCH_ADMIN');
      setShowAddAdminModal(false);
      
      // Reload data
      loadDashboardData();
    } catch (err: unknown) {
      console.error('âŒ [Dashboard] Error adding admin:', err);
      setAdminError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdminSubmitting(false);
    }
  };

  const handleRequestAdminAuthCode = async () => {
    setAdminError(null);
    try {
      if (!adminEmail || !adminEmail.includes('@')) {
        throw new Error('Enter a valid email before requesting auth code');
      }

      const backendUrl = getBackendUrl();

      const res = await fetch(`${backendUrl}/auth/request-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail.trim().toLowerCase(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result?.message || result?.error || 'Failed to request auth code');
      }

      if (result?.warning || result?.deliveryMethod === 'IN_APP') {
        setAdminError(result?.warning || 'Email delivery unavailable. Use the in-app code shown by the backend.');
      } else {
        setAdminError('Authentication code sent to your email.');
      }
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && !isImpersonating && !stats) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4" style={{ color: 'var(--text-muted)' }}>
      <div
        className="w-10 h-10 rounded-[14px] flex items-center justify-center"
        style={{ background: 'rgba(201,160,92,0.08)', border: '1px solid rgba(201,160,92,0.15)' }}
      >
        <RotateCcw className="animate-spin" size={18} style={{ color: 'var(--gold)' }} />
      </div>
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold animate-pulse" style={{ fontFamily: 'var(--font-mono)' }}>
        Connecting to Branch
      </p>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-10">
      <div
        className="w-14 h-14 rounded-[18px] flex items-center justify-center"
        style={{ background: 'rgba(212,69,69,0.1)', border: '1px solid rgba(212,69,69,0.2)' }}
      >
        <AlertTriangle size={24} style={{ color: 'var(--red)' }} />
      </div>
      <div>
        <p className="font-semibold text-base" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{error}</p>
        <p className="text-[11px] mt-2 max-w-xs mx-auto" style={{ color: 'var(--text-muted)' }}>
          Verify Row Level Security policies or contact Super Admin for access.
        </p>
      </div>
      <button
        onClick={loadDashboardData}
        className="px-6 py-2.5 rounded-[12px] text-[11px] font-semibold uppercase tracking-[0.12em] transition-all duration-200 active:scale-[0.97]"
        style={{ background: 'rgba(212,69,69,0.1)', color: 'var(--red)', border: '1px solid rgba(212,69,69,0.2)' }}
      >
        Retry Connection
      </button>
    </div>
  );

  if (!stats && !isImpersonating) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4" style={{ color: 'var(--text-muted)' }}>
      <div
        className="w-14 h-14 rounded-[18px] flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <Building2 size={22} style={{ color: 'var(--text-muted)' }} />
      </div>
      <p className="text-[11px] uppercase tracking-[0.2em] font-semibold" style={{ fontFamily: 'var(--font-mono)' }}>No Branch Selected</p>
      <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>Select a branch to view metrics</p>
    </div>
  );

  if (!stats) return null;

  return (
    <div className="space-y-6 py-6" style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both' }}>

      {/* HEADER */}
      <div className="flex justify-between items-end">
        <div>
          <h1
            className="text-2xl font-bold tracking-tighter leading-none"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            Operational <span style={{ color: 'var(--gold)' }}>Intelligence</span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <Building2 size={12} style={{ color: 'var(--gold)' }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {activeBranchName}
              <span className="ml-2 opacity-40">[{targetUuid ? targetUuid.slice(0, 8) : '--------'}]</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-[10px]"
            style={{ background: 'rgba(61,168,108,0.08)', border: '1px solid rgba(61,168,108,0.18)' }}
          >
            <div className="w-[6px] h-[6px] rounded-full" style={{ background: 'var(--green)', boxShadow: '0 0 6px rgba(61,168,108,0.7)', animation: 'goldPulse 2.4s ease-in-out infinite' }} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>Live</span>
          </div>
          {isImpersonating && (
            <button
              onClick={() => setShowAddAdminModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-[12px] text-[12px] font-semibold transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
                color: '#0A0A0F',
                border: '1px solid rgba(201,160,92,0.5)',
                boxShadow: '0 4px 14px rgba(201,160,92,0.22)',
              }}
            >
              <UserCog size={14} />
              <span>Add Admin</span>
            </button>
          )}
        </div>
      </div>

      {/* BENTO ROW 1 — 3fr hero | 1fr stacked */}
      <div
        className="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-4"
        style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) 80ms both' }}
      >
        {/* Hero metric */}
        <MetricCard
          title={isSupportLiveView ? 'Active Tickets' : 'Total Principal'}
          value={isSupportLiveView ? (stats?.activeTickets || 0) : formatCurrency(stats?.totalLoans || 0)}
          sub={isSupportLiveView ? 'Current Open Tickets' : 'Active Loan Portfolio'}
          growth={stats?.portfolioGrowth || 0}
          icon={isSupportLiveView ? <RotateCcw size={16} style={{ color: 'var(--gold)' }} /> : <DollarSign size={16} style={{ color: 'var(--gold)' }} />}
          large
        />
        {/* Stacked right */}
        <div className="flex flex-col gap-4">
          <MetricCard
            title={isSupportLiveView ? 'Staff On Duty' : 'Projected Interest'}
            value={isSupportLiveView ? (stats?.staffOnDuty || 0) : formatCurrency(stats?.totalInterest || 0)}
            sub={isSupportLiveView ? 'Shift Personnel' : '30-Day Accrual'}
            growth={isSupportLiveView ? 0 : 8.3}
            icon={isSupportLiveView ? <ShieldCheck size={14} style={{ color: 'var(--green)' }} /> : <TrendingUp size={14} style={{ color: 'var(--green)' }} />}
          />
          <MetricCard
            title="Active Clients"
            value={stats?.clientCount || 0}
            sub={isSupportLiveView ? 'Client Records' : 'Branch Members'}
            growth={1.2}
            icon={<Users size={14} style={{ color: 'var(--blue)' }} />}
          />
        </div>
      </div>

      {/* BENTO ROW 2 — 1fr | 2fr (score left, vault right) */}
      <div
        className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4"
        style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) 160ms both' }}
      >
        {/* Operational Score */}
        <Card className="hover:-translate-y-[2px]" style={{ transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
          <CardContent className="pt-5 flex flex-col h-full gap-5">
            <div className="flex items-start justify-between">
              <div
                className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(201,160,92,0.1)', border: '1px solid rgba(201,160,92,0.18)' }}
              >
                <ShieldCheck size={16} style={{ color: 'var(--gold)' }} />
              </div>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold" style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>Score</p>
                <p className="text-4xl font-bold tracking-tighter" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {stats?.efficiency || 0}<span className="text-xl" style={{ color: 'var(--gold)' }}>%</span>
                </p>
              </div>
            </div>
            <CardInner className="flex flex-col gap-0 flex-1">
              <StatusRow label="Staff On Duty" value={stats?.staffOnDuty || 0} />
              <StatusRow label="Active Tickets" value={stats?.activeTickets || 0} />
              <StatusRow label="Vault Capacity" value={stats?.activeTickets > 0 ? '42%' : '0%'} />
            </CardInner>
          </CardContent>
        </Card>

        {/* Vault Composition */}
        <Card className="hover:-translate-y-[2px]" style={{ transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
          <CardContent className="pt-5">
            <div className="flex justify-between items-start mb-5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Vault Composition</p>
                <h3 className="text-base font-bold mt-1" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>Asset Distribution</h3>
              </div>
              <div
                className="w-9 h-9 rounded-[12px] flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Box size={16} style={{ color: 'var(--gold)' }} />
              </div>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex-shrink-0" style={{ height: 220 }}>
                <ResponsiveContainer width={220} height={220}>
                  <PieChart>
                    <Pie data={stats?.inventorySummary || []} innerRadius={70} outerRadius={90} paddingAngle={4} dataKey="count">
                      {stats?.inventorySummary?.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid rgba(201,160,92,0.15)', background: '#14141B', color: '#EAE2D6', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 w-full space-y-3">
                {stats?.inventorySummary?.length > 0 ? (
                  stats.inventorySummary.map((item: any) => (
                    <div key={item.name} className="flex justify-between items-center group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="text-[12px] font-medium uppercase tracking-tight transition-colors" style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                      </div>
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.count} units</span>
                    </div>
                  ))
                ) : (
                  <CardInner className="flex items-center justify-center py-6">
                    <p className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>Vault Empty — No active tickets</p>
                  </CardInner>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CTA BAR */}
      <div style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) 240ms both' }}>
        {isEnabled('loan_management') ? (
          <button
            onClick={() => setActiveTab('Loan Management')}
            className="flex items-center gap-3 px-5 py-3 rounded-[14px] text-[12px] font-semibold transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
              color: '#0A0A0F',
              border: '1px solid rgba(201,160,92,0.5)',
              boxShadow: '0 0 0 1px rgba(201,160,92,0.2) inset, 0 4px 14px rgba(201,160,92,0.22)',
            }}
          >
            <span>New Transaction</span>
            <div
              className="w-6 h-6 rounded-[8px] flex items-center justify-center"
              style={{ background: 'rgba(10,10,15,0.15)' }}
            >
              <ChevronRight size={12} />
            </div>
          </button>
        ) : (
          <div
            className="inline-flex items-center px-5 py-3 rounded-[14px] text-[12px] font-medium cursor-not-allowed opacity-40"
            style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            Module Locked
          </div>
        )}
      </div>

      {/* SUCCESS MODAL */}
      {successData && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C26] p-[2px] rounded-[2rem] shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-[#14141B]/95 backdrop-blur-md rounded-[calc(2rem-2px)] overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-600/90 to-teal-600/90 px-8 py-8 text-center">
                <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-9 h-9 text-white" />
                </div>
                <h2 className="text-lg font-black uppercase tracking-wider text-white">Staff Member Created</h2>
                <p className="text-emerald-100 text-xs font-medium mt-1">Account is active and ready to use</p>
              </div>
              <div className="p-8 space-y-5">
                {[
                  { label: 'Email', value: successData.email, key: 'email' },
                  { label: 'Password', value: successData.password, key: 'password' },
                ].map(({ label, value, key }) => (
                  <div key={key} className="flex items-center justify-between bg-[#1C1C26] rounded-2xl px-5 py-3.5 border border-[rgba(201,160,92,0.08)]">
                    <div className="min-w-0">
                      <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-[0.2em]">{label}</p>
                      <p className="text-sm font-bold text-[#EAE2D6] truncate">{value}</p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(value);
                        setCopiedField(key);
                        setTimeout(() => setCopiedField(null), 2000);
                      }}
                      className="ml-3 p-2 rounded-xl hover:bg-[#222228] transition-all flex-shrink-0"
                      title={`Copy ${label.toLowerCase()}`}
                    >
                      {copiedField === key
                        ? <Check className="w-4 h-4 text-emerald-600" />
                        : <Copy className="w-4 h-4 text-[#6B655C]" />}
                    </button>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#C9A05C]/10 rounded-xl px-4 py-3 border border-[rgba(201,160,92,0.15)]">
                    <p className="text-[9px] font-black text-[#C9A05C] uppercase tracking-[0.2em]">Role</p>
                    <p className="text-sm font-bold text-[#C9A05C]">{successData.role}</p>
                  </div>
                  <div className="bg-[rgba(201,160,92,0.05)] rounded-xl px-4 py-3 border border-[rgba(201,160,92,0.1)]">
                    <p className="text-[9px] font-black text-violet-400 uppercase tracking-[0.2em]">Branch</p>
                    <p className="text-sm font-bold text-violet-400 truncate">{successData.pawnshop}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-emerald-400/10 rounded-xl px-4 py-3 border border-emerald-400/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-[10px] font-bold text-emerald-400">Auto-verified — can login immediately</p>
                </div>
                <button
                  onClick={() => { setSuccessData(null); setCopiedField(null); }}
                  className="w-full py-3.5 bg-[#C9A05C] text-[#0A0A0F] rounded-full font-bold uppercase text-xs tracking-wider active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[#D4B06A]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD ADMIN MODAL */}
      {showAddAdminModal && isImpersonating && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1C1C26] p-[2px] rounded-[2rem] shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-[#14141B]/95 backdrop-blur-md rounded-[calc(2rem-2px)] p-8 space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black uppercase text-[#EAE2D6]">Add Admin</h2>
                  <p className="text-[10px] font-bold text-[#C9A05C] uppercase tracking-widest mt-2">
                    📍 {activeBranchName}
                  </p>
                </div>
                <button
                  onClick={() => setShowAddAdminModal(false)}
                  className="w-8 h-8 rounded-full bg-[#1C1C26] flex items-center justify-center hover:bg-[#222228] transition-all text-[#6B655C]"
                >
                  <span className="text-sm">✕</span>
                </button>
              </div>

              <form onSubmit={handleAddAdmin} className="space-y-4">
                <div className="p-4 bg-[#C9A05C]/10 text-[#C9A05C] text-[10px] font-bold rounded-xl border border-[rgba(201,160,92,0.15)]">
                  ℹ️ This admin will have access to <strong>{activeBranchName}</strong> only.
                </div>

                <div>
                  <label className="text-[10px] font-black text-[#6B655C] uppercase tracking-[0.2em] block mb-2">Email Address</label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@pawngold.com"
                    className="w-full px-4 py-3 bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] rounded-2xl focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#EAE2D6] placeholder:text-[#6B655C]/50"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-[#6B655C] uppercase tracking-[0.2em] block mb-2">Password (Min 8 characters)</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter secure password"
                    className="w-full px-4 py-3 bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] rounded-2xl focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#EAE2D6] placeholder:text-[#6B655C]/50"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-[#6B655C] uppercase tracking-[0.2em] block mb-2">Authentication Code</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={adminAuthCode}
                      onChange={(e) => setAdminAuthCode(e.target.value)}
                      placeholder="Enter auth code"
                      className="w-full px-4 py-3 bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] rounded-2xl focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#EAE2D6] placeholder:text-[#6B655C]/50"
                      required
                    />
                    <button
                      type="button"
                      onClick={handleRequestAdminAuthCode}
                      className="px-5 py-3 bg-[#C9A05C]/10 text-[#C9A05C] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#C9A05C]/20 transition-all border border-[rgba(201,160,92,0.15)]"
                    >
                      Get Code
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-[#6B655C] uppercase tracking-[0.2em] block mb-2">Role for this Pawnshop</label>
                  <select
                    value={adminRole}
                    onChange={(e) => setAdminRole(e.target.value)}
                    className="w-full px-4 py-3 bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] rounded-2xl focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#EAE2D6]"
                  >
                    <option value="BRANCH_ADMIN">Branch Admin</option>
                    <option value="MANAGER">Manager</option>
                    <option value="HR">HR</option>
                    <option value="CASHIER_TELLER">Cashier/Teller</option>
                    <option value="APPRAISER">Appraiser</option>
                    <option value="INVENTORY_CUSTODIAN">Inventory Custodian</option>
                    <option value="AUDITOR">Auditor (Read Only)</option>
                  </select>
                </div>

                {adminError && (
                  <div className="p-3 bg-rose-500/10 text-rose-400 text-[11px] font-bold rounded-xl border border-rose-500/20">
                    ❌ {adminError}
                  </div>
                )}

                <div className="flex gap-2 pt-4">
                  <button
                    type="submit"
                    disabled={adminSubmitting}
                    className="flex-1 py-3 bg-[#C9A05C] text-[#0A0A0F] rounded-full font-bold uppercase tracking-wider text-[10px] active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[#D4B06A] disabled:opacity-50"
                  >
                    {adminSubmitting ? 'Adding...' : 'Add Admin'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddAdminModal(false)}
                    className="flex-1 py-3 bg-[#1C1C26] text-[#6B655C] rounded-full font-black uppercase tracking-widest text-[10px] hover:bg-[#222228] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, sub, growth, icon, large }: any) {
  return (
    <Card
      className="h-full hover:-translate-y-[2px]"
      style={{ transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <CardContent className={`flex flex-col justify-between h-full ${large ? 'pt-6 pb-6' : 'pt-5 pb-5'}`}>
        <div className="flex justify-between items-start">
          <p
            className="text-[9px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {title}
          </p>
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {icon}
          </div>
        </div>
        <p
          className={`font-bold tracking-tighter ${large ? 'text-4xl mt-4' : 'text-2xl mt-3'}`}
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {value}
        </p>
        <div className="flex items-center justify-between mt-4">
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{sub}</p>
          {growth > 0 && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-[6px]"
              style={{
                color: 'var(--green)',
                background: 'rgba(61,168,108,0.1)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              +{growth}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, value }: { label: string; value: any }) {
  return (
    <div
      className="flex justify-between items-center py-2.5 border-b last:border-b-0"
      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </span>
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

