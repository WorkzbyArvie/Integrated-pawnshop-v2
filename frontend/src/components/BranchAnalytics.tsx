import { useState, useEffect } from 'react';
import {
  ArrowLeft, TrendingUp, Users2, Package, Shield, Activity,
  BarChart3, PieChart as PieChartIcon, Loader2, AlertCircle,
  ArrowUpRight, Clock, CheckCircle2, XCircle, RefreshCw
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  AreaChart, Area
} from 'recharts';
import { supabase } from '../lib/supabaseClient';
import api from '../lib/apiClient';

/* â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface BranchAnalyticsProps {
  branchId: string;
  branchName: string;
  onBack: () => void;
}

interface BranchStats {
  pawnshopId: string;
  name: string;
  clientCount: number;
  inventorySummary: { name: string; count: number }[];
  staffOnDuty: number;
  activeTickets: number;
  vaultCapacity: number;
  subscriptionPlan?: string;
}

interface TicketsByStatus {
  [key: string]: string | number;
  status: string;
  count: number;
}

interface MonthlyTrend {
  month: string;
  tickets: number;
}

interface RecentTicket {
  id: number;
  ticketNumber: string;
  category: string;
  status: string;
  pawnDate: string;
}

/* â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#f97316', '#06b6d4'];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#6366f1',
  REDEEMED: '#10b981',
  OVERDUE: '#f59e0b',
  FORFEITED: '#ef4444',
  SOLD: '#8b5cf6',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  REDEEMED: 'Redeemed',
  OVERDUE: 'Overdue',
  FORFEITED: 'Forfeited',
  SOLD: 'Sold',
};

/* â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function BranchAnalytics({ branchId, branchName, onBack }: BranchAnalyticsProps) {
  const [stats, setStats] = useState<BranchStats | null>(null);
  const [ticketsByStatus, setTicketsByStatus] = useState<TicketsByStatus[]>([]);
  const [monthlyTrends, setMonthlyTrends] = useState<MonthlyTrend[]>([]);
  const [recentTickets, setRecentTickets] = useState<RecentTicket[]>([]);
  const [loanApplicationCount, setLoanApplicationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchBranchStats(),
        fetchTicketsByStatus(),
        fetchMonthlyTrends(),
        fetchRecentTickets(),
        fetchLoanApplications(),
      ]);
    } catch (err: unknown) {
      console.error('BranchAnalytics fetch error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchBranchStats = async () => {
    const stats = await api.get<BranchStats>(`/analytics/branch/${branchId}`);
    setStats(stats);
  };

  const fetchTicketsByStatus = async () => {
    const { data, error } = await supabase
      .from('ticket')
      .select('status')
      .eq('pawnshop_id', branchId);
    if (error) throw error;

    const counts: Record<string, number> = {};
    (data || []).forEach((t: any) => {
      const s = (t.status || 'UNKNOWN').toUpperCase();
      counts[s] = (counts[s] || 0) + 1;
    });

    setTicketsByStatus(
      Object.entries(counts).map(([status, count]) => ({ status, count }))
    );
  };

  const fetchMonthlyTrends = async () => {
    const { data, error } = await supabase
      .from('ticket')
      .select('pawn_date')
      .eq('pawnshop_id', branchId)
      .order('pawn_date', { ascending: true });
    if (error) throw error;

    const monthMap: Record<string, { tickets: number }> = {};
    (data || []).forEach((t: any) => {
      if (!t.pawn_date) return;
      const d = new Date(t.pawn_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { tickets: 0 };
      monthMap[key].tickets += 1;
    });

    const months = Object.keys(monthMap).sort().slice(-12);
    setMonthlyTrends(
      months.map(m => {
        const [y, mo] = m.split('-');
        const label = new Date(Number(y), Number(mo) - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
        return { month: label, ...monthMap[m] };
      })
    );
  };

  const fetchRecentTickets = async () => {
    const { data, error } = await supabase
      .from('ticket')
      .select('id, ticket_number, category, status, pawn_date')
      .eq('pawnshop_id', branchId)
      .order('pawn_date', { ascending: false })
      .limit(8);
    if (error) throw error;

    setRecentTickets(
      (data || []).map((t: any) => ({
        id: t.id,
        ticketNumber: t.ticket_number || `TKT-${t.id}`,
        category: t.category || 'General',
        status: (t.status || 'ACTIVE').toUpperCase(),
        pawnDate: t.pawn_date ? new Date(t.pawn_date).toLocaleDateString() : 'â€”',
      }))
    );
  };

  const fetchLoanApplications = async () => {
    const { count, error } = await supabase
      .from('loan_application')
      .select('id', { count: 'exact', head: true })
      .eq('pawnshop_id', branchId);
    if (error) throw error;
    setLoanApplicationCount(count || 0);
  };

  useEffect(() => { fetchAll(); }, [branchId]);

  const totalTickets = ticketsByStatus.reduce((s, t) => s + t.count, 0);

  /* â”€â”€ Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  if (loading) {
    return (
      <div className="min-h-[600px] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 text-[#C9A05C] animate-spin" />
        <p className="text-[#6B655C] text-sm font-medium">Loading branch analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-rose-400" />
        <p className="text-rose-500 text-sm font-bold">{error}</p>
        <button onClick={fetchAll} className="px-6 py-3 bg-[#C9A05C] text-white rounded-xl text-xs font-bold uppercase hover:bg-[#E5C88C] transition-colors">
          Retry
        </button>
      </div>
    );
  }

  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-3 bg-[#14141B] border-2 border-[rgba(201,160,92,0.12)] rounded-2xl hover:bg-[#1C1C26] hover:border-[rgba(201,160,92,0.3)] transition-all group"
          >
            <ArrowLeft className="w-5 h-5 text-[#6B655C] group-hover:text-[#C9A05C] transition-colors" />
          </button>
          <div>
            <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">{branchName}</h1>
            <p className="text-[#6B655C] text-xs font-bold uppercase tracking-widest mt-1">Pawnshop Details Dashboard</p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-2 px-5 py-3 bg-[#14141B] border-2 border-[rgba(201,160,92,0.12)] rounded-2xl text-xs font-bold text-[#6B655C] uppercase tracking-wider hover:border-[rgba(201,160,92,0.3)] hover:text-[#C9A05C] transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* â”€â”€ KPI Cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard
          icon={<Users2 className="w-5 h-5" />}
          label="Active Clients"
          value={String(stats?.clientCount || 0)}
          sub="Verified active clients"
          color="cyan"
        />
        <KpiCard
          icon={<Package className="w-5 h-5" />}
          label="Active Tickets"
          value={String(stats?.activeTickets || 0)}
          sub={`${totalTickets} total tickets`}
          color="violet"
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />}
          label="Avg Tickets / Day"
          value={String(Math.max(0, Number((((stats?.activeTickets || 0) / 30)).toFixed(1))))}
          sub="Rolling 30-day average"
          color="indigo"
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Loan Applications"
          value={String(loanApplicationCount || 0)}
          sub="Current pipeline volume"
          color="amber"
        />
      </div>

      {/* â”€â”€ Second Row KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <KpiCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Branch Count"
          value="1"
          sub="Current live branch context"
          color="sky"
        />
        <KpiCard
          icon={<Shield className="w-5 h-5" />}
          label="Staff / Personnel"
          value={String(stats?.staffOnDuty || 0)}
          sub="Registered profiles"
          color="rose"
        />
        <KpiCard
          icon={<Activity className="w-5 h-5" />}
          label="Subscription Plan"
          value={String(stats?.subscriptionPlan || 'FREE')}
          sub="Current tenant package"
          color="rose"
        />
      </div>

      {/* â”€â”€ Charts Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ticket Status Distribution */}
        <div className="bg-[#14141B] rounded-3xl border border-[rgba(201,160,92,0.12)] p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-[#C9A05C]/10 rounded-xl">
              <PieChartIcon className="w-4 h-4 text-[#C9A05C]" />
            </div>
            <h3 className="font-black text-sm text-slate-800 uppercase tracking-wider">Ticket Status Distribution</h3>
          </div>
          {ticketsByStatus.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie
                    data={ticketsByStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    dataKey="count"
                    nameKey="status"
                    stroke="none"
                    paddingAngle={3}
                  >
                    {ticketsByStatus.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.status] || COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any, name: any) => [value, STATUS_LABELS[name] || name]}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {ticketsByStatus.map((entry, i) => (
                  <div key={entry.status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[entry.status] || COLORS[i % COLORS.length] }}
                      />
                      <span className="text-xs font-bold text-[#999186]">{STATUS_LABELS[entry.status] || entry.status}</span>
                    </div>
                    <span className="text-xs font-black text-[#EAE2D6]">{entry.count}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-[rgba(201,160,92,0.08)] flex items-center justify-between">
                  <span className="text-xs font-bold text-[#6B655C]">Total</span>
                  <span className="text-xs font-black text-[#C9A05C]">{totalTickets}</span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState msg="No tickets found for this branch" />
          )}
        </div>

        {/* Vault Composition */}
        <div className="bg-[#14141B] rounded-3xl border border-[rgba(201,160,92,0.12)] p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-amber-50 rounded-xl">
              <BarChart3 className="w-4 h-4 text-amber-600" />
            </div>
            <h3 className="font-black text-sm text-slate-800 uppercase tracking-wider">Vault Composition</h3>
          </div>
          {(stats?.inventorySummary || []).length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats?.inventorySummary || []} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="count" name="Items" radius={[8, 8, 0, 0]}>
                  {(stats?.inventorySummary || []).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState msg="No inventory data available" />
          )}
        </div>
      </div>

      {/* â”€â”€ Monthly Trends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="bg-[#14141B] rounded-3xl border border-[rgba(201,160,92,0.12)] p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-emerald-50 rounded-xl">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <h3 className="font-black text-sm text-slate-800 uppercase tracking-wider">Monthly Ticket Trends</h3>
        </div>
        {monthlyTrends.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={monthlyTrends}>
              <defs>
                <linearGradient id="gradientTickets" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                formatter={(value: any) => [value, 'Ticket Count']}
              />
              <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
              <Area type="monotone" dataKey="tickets" name="Ticket Count" stroke="#6366f1" strokeWidth={2} fill="url(#gradientTickets)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState msg="No monthly data to display yet" />
        )}
      </div>

      {/* â”€â”€ Recent Tickets Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="bg-[#14141B] rounded-3xl border border-[rgba(201,160,92,0.12)] p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-violet-50 rounded-xl">
            <Clock className="w-4 h-4 text-violet-600" />
          </div>
          <h3 className="font-black text-sm text-slate-800 uppercase tracking-wider">Recent Ticket Activity</h3>
        </div>
        {recentTickets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[rgba(201,160,92,0.08)]">
                  <th className="pb-3 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Ticket #</th>
                  <th className="pb-3 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Category</th>
                  <th className="pb-3 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Status</th>
                  <th className="pb-3 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-[#1C1C26] transition-colors">
                    <td className="py-3 text-sm font-bold text-[#C9A05C]">{t.ticketNumber}</td>
                    <td className="py-3">
                      <span className="px-2.5 py-1 bg-[#1C1C26] text-[#999186] rounded-lg text-xs font-bold">{t.category}</span>
                    </td>
                    <td className="py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="py-3 text-xs text-[#6B655C] font-medium">{t.pawnDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState msg="No transactions recorded yet" />
        )}
      </div>
    </div>
  );
}

/* â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
  indigo:  { bg: 'bg-[#C9A05C]/10',  icon: 'text-[#C9A05C]',  border: 'border-[rgba(201,160,92,0.15)]' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-100' },
  cyan:    { bg: 'bg-cyan-50',    icon: 'text-cyan-600',    border: 'border-cyan-100' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   border: 'border-amber-100' },
  violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600',  border: 'border-violet-100' },
  rose:    { bg: 'bg-rose-50',    icon: 'text-rose-600',    border: 'border-rose-100' },
  sky:     { bg: 'bg-sky-50',     icon: 'text-sky-600',     border: 'border-sky-100' },
};

function KpiCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  const c = colorMap[color] || colorMap.indigo;
  return (
    <div className={`bg-[#14141B] rounded-3xl border ${c.border} p-6 shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2.5 ${c.bg} rounded-xl`}>
          <span className={c.icon}>{icon}</span>
        </div>
        <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-black text-[#EAE2D6] tracking-tight">{value}</p>
      <p className="text-xs text-[#6B655C] font-medium mt-1">{sub}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    ACTIVE:    { bg: 'bg-[#C9A05C]/10', text: 'text-[#C9A05C]', icon: <Activity className="w-3 h-3" /> },
    REDEEMED:  { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: <CheckCircle2 className="w-3 h-3" /> },
    OVERDUE:   { bg: 'bg-amber-50', text: 'text-amber-700', icon: <Clock className="w-3 h-3" /> },
    FORFEITED: { bg: 'bg-rose-50', text: 'text-rose-700', icon: <XCircle className="w-3 h-3" /> },
    SOLD:      { bg: 'bg-violet-50', text: 'text-violet-700', icon: <ArrowUpRight className="w-3 h-3" /> },
  };
  const c = config[status] || { bg: 'bg-[#1C1C26]', text: 'text-[#999186]', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 ${c.bg} ${c.text} rounded-lg text-[10px] font-black uppercase tracking-wider`}>
      {c.icon}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Package className="w-8 h-8 text-slate-200 mb-3" />
      <p className="text-[#6B655C] text-xs font-bold">{msg}</p>
    </div>
  );
}
