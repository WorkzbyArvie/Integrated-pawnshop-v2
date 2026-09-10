import { useState, useEffect } from 'react';
import {
  Building2, Users, Activity,
  Clock, DollarSign, Loader2, RefreshCcw,
  TrendingUp, AlertTriangle,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import Swal from 'sweetalert2';
import api from '../../lib/apiClient';

const GOLD = '#C9A05C';
const COLORS = ['#C9A05C', '#34D399', '#60A5FA', '#F87171', '#FBBF24', '#A78BFA'];

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1C1C26',
    border: `1px solid rgba(201,160,92,0.2)`,
    borderRadius: '12px',
    color: '#F5F0E8',
    fontSize: '13px',
  },
  itemStyle: { color: '#F5F0E8' },
};

export function PlatformAnalytics() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [subAction, setSubAction] = useState<{
    type: 'extend' | 'upgrade' | 'status';
    pawnshopId: string;
    pawnshopName: string;
    additionalDays?: number;
  } | null>(null);

  const [subForm, setSubForm] = useState({
    additionalDays: 15,
    tier: 'BASIC' as string,
    status: 'ACTIVE' as string,
    reason: '',
  });

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    void Swal.fire({
      toast: true,
      position: 'top',
      icon: type,
      title: message,
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true,
    });
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const data = await api.get<any>('/tenant-governance/analytics/platform');
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to load platform analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubAction = async () => {
    if (!subAction) return;
    try {
      if (subAction.type === 'extend') {
        await api.post(`/tenant-governance/subscriptions/${subAction.pawnshopId}/extend-trial`, {
          additionalDays: subForm.additionalDays,
          reason: subForm.reason,
        });
        showNotification(`Trial extended by ${subForm.additionalDays} days`);
      } else if (subAction.type === 'upgrade') {
        await api.post(`/tenant-governance/subscriptions/${subAction.pawnshopId}/upgrade-tier`, {
          tier: subForm.tier,
          reason: subForm.reason,
        });
        showNotification(`Upgraded to ${subForm.tier}`);
      } else if (subAction.type === 'status') {
        await api.patch(`/tenant-governance/subscriptions/${subAction.pawnshopId}/status`, {
          status: subForm.status,
          reason: subForm.reason,
        });
        showNotification(`Subscription status changed to ${subForm.status}`);
      }
      setSubAction(null);
      fetchAnalytics();
    } catch (err: any) {
      showNotification(err?.message || 'Action failed', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: 'Total Pawnshops', value: analytics?.pawnshops?.total || 0, icon: Building2, color: 'text-[#C9A05C]', bg: 'bg-[#C9A05C]/10' },
    { label: 'Active Pawnshops', value: analytics?.pawnshops?.active || 0, icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: 'Total Users', value: analytics?.users?.total || 0, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: 'Active Loans', value: analytics?.loans?.disbursed || 0, icon: DollarSign, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: 'Pending Requests', value: analytics?.pendingRegistrations || 0, icon: Clock, color: 'text-rose-400', bg: 'bg-rose-400/10' },
    { label: 'Active Subscriptions', value: analytics?.subscriptions?.active || 0, icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  ];

  const pawnshopStatusData = [
    { name: 'Active', value: analytics?.pawnshops?.active || 0 },
    { name: 'Frozen', value: analytics?.pawnshops?.frozen || 0 },
    { name: 'Inactive', value: Math.max(0, (analytics?.pawnshops?.total || 0) - (analytics?.pawnshops?.active || 0) - (analytics?.pawnshops?.frozen || 0)) },
  ].filter(d => d.value > 0);

  const subscriptionData = [
    { name: 'Trial', value: analytics?.subscriptions?.trial || 0 },
    { name: 'Active', value: analytics?.subscriptions?.active || 0 },
    { name: 'Other', value: Math.max(0, (analytics?.subscriptions?.total || 0) - (analytics?.subscriptions?.trial || 0) - (analytics?.subscriptions?.active || 0)) },
  ].filter(d => d.value > 0);

  const loansData = [
    { name: 'Total', value: analytics?.loans?.total || 0 },
    { name: 'Disbursed', value: analytics?.loans?.disbursed || 0 },
  ];

  const ticketsData = [
    { name: 'Total', value: analytics?.tickets?.total || 0 },
    { name: 'Active', value: analytics?.tickets?.active || 0 },
  ];

  const userData = [
    { name: 'Owners', value: analytics?.users?.owners || 0 },
    { name: 'Other Users', value: Math.max(0, (analytics?.users?.total || 0) - (analytics?.users?.owners || 0)) },
  ].filter(d => d.value > 0);

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-light text-[#F5F0E8] tracking-tight">
            Platform <span className="font-bold text-[#C9A05C] italic">Analytics</span>
          </h1>
          <p className="text-[#8A8279] mt-2 font-medium italic">Cross-pawnshop metrics and management</p>
        </div>
        <button
          onClick={fetchAnalytics}
          className="flex items-center gap-2 px-4 py-2.5 border border-[rgba(201,160,92,0.15)] text-[#B8B0A4] rounded-xl text-sm hover:bg-[#1C1C26] transition-all"
        >
          <RefreshCcw size={16} />
          Refresh
        </button>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-4">
            <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <p className="text-2xl font-bold text-[#F5F0E8]">{stat.value}</p>
            <p className="text-xs text-[#8A8279] mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* CHARTS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pawnshop Status Distribution */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-6">
          <h3 className="text-sm font-semibold text-[#F5F0E8] mb-4">Pawnshop Status Distribution</h3>
          {pawnshopStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pawnshopStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pawnshopStatusData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Legend
                  wrapperStyle={{ color: '#8A8279', fontSize: '12px' }}
                  formatter={(value: string) => <span style={{ color: '#B8B0A4' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-[#8A8279] text-sm text-center py-10">No pawnshop data</p>
          )}
        </div>

        {/* Subscription Tier Breakdown */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-6">
          <h3 className="text-sm font-semibold text-[#F5F0E8] mb-4">Subscription Breakdown</h3>
          {subscriptionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={subscriptionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {subscriptionData.map((_, i) => (
                    <Cell key={i} fill={COLORS[(i + 1) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Legend
                  wrapperStyle={{ color: '#8A8279', fontSize: '12px' }}
                  formatter={(value: string) => <span style={{ color: '#B8B0A4' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-[#8A8279] text-sm text-center py-10">No subscription data</p>
          )}
        </div>

        {/* Loans Overview */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-6">
          <h3 className="text-sm font-semibold text-[#F5F0E8] mb-4">Loans Overview</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={loansData} barSize={48}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#8A8279', fontSize: 12 }}
                axisLine={{ stroke: 'rgba(201,160,92,0.15)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8A8279', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {loansData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#34D399' : GOLD} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ticket Lifecycle */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-6">
          <h3 className="text-sm font-semibold text-[#F5F0E8] mb-4">Ticket Lifecycle</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ticketsData} barSize={48}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#8A8279', fontSize: 12 }}
                axisLine={{ stroke: 'rgba(201,160,92,0.15)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8A8279', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {ticketsData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#60A5FA' : '#FBBF24'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* User Distribution */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-6">
          <h3 className="text-sm font-semibold text-[#F5F0E8] mb-4">User Distribution</h3>
          {userData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={userData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {userData.map((_, i) => (
                    <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Legend
                  wrapperStyle={{ color: '#8A8279', fontSize: '12px' }}
                  formatter={(value: string) => <span style={{ color: '#B8B0A4' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-[#8A8279] text-sm text-center py-10">No user data</p>
          )}
        </div>

        {/* Pending Registrations Alert */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-6 flex flex-col justify-center items-center text-center">
          <div className="w-16 h-16 rounded-full bg-rose-400/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
          </div>
          <p className="text-3xl font-bold text-[#F5F0E8]">{analytics?.pendingRegistrations || 0}</p>
          <p className="text-sm text-[#8A8279] mt-1">Pending Registration Requests</p>
          <p className="text-xs text-[#8A8279] mt-3 max-w-[240px]">
            Client registrations awaiting approval across all pawnshops
          </p>
        </div>
      </div>

      {/* SUBSCRIPTION MANAGEMENT MODAL */}
      {subAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1C1C26] border border-[rgba(201,160,92,0.2)] rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-[#F5F0E8]">
              {subAction.type === 'extend' && `Extend Trial — ${subAction.pawnshopName}`}
              {subAction.type === 'upgrade' && `Upgrade Tier — ${subAction.pawnshopName}`}
              {subAction.type === 'status' && `Change Status — ${subAction.pawnshopName}`}
            </h3>
            {subAction.type === 'extend' && (
              <input
                type="number"
                min={1}
                value={subForm.additionalDays}
                onChange={(e) => setSubForm({ ...subForm, additionalDays: Number(e.target.value) })}
                className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#F5F0E8] text-sm"
                placeholder="Additional days"
              />
            )}
            {subAction.type === 'upgrade' && (
              <select
                value={subForm.tier}
                onChange={(e) => setSubForm({ ...subForm, tier: e.target.value })}
                className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#F5F0E8] text-sm"
              >
                <option value="FREE">FREE</option>
                <option value="BASIC">BASIC (₱2,999/mo)</option>
                <option value="PROFESSIONAL">PROFESSIONAL (₱7,999/mo)</option>
                <option value="ENTERPRISE">ENTERPRISE (₱19,999/mo)</option>
              </select>
            )}
            {subAction.type === 'status' && (
              <select
                value={subForm.status}
                onChange={(e) => setSubForm({ ...subForm, status: e.target.value })}
                className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#F5F0E8] text-sm"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="TRIAL">TRIAL</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            )}
            <input
              value={subForm.reason}
              onChange={(e) => setSubForm({ ...subForm, reason: e.target.value })}
              className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#F5F0E8] text-sm"
              placeholder="Reason (optional)"
            />
            <div className="flex gap-3">
              <button
                onClick={handleSubAction}
                className="px-5 py-2.5 bg-[#C9A05C] text-[#1C1C26] rounded-xl font-semibold text-sm"
              >
                Confirm
              </button>
              <button
                onClick={() => setSubAction(null)}
                className="px-5 py-2.5 border border-[rgba(201,160,92,0.15)] text-[#B8B0A4] rounded-xl text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
