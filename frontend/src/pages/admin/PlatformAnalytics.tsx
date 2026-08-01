import { useState, useEffect } from 'react';
import {
  Building2, Users, Activity, CreditCard, TrendingUp,
  AlertTriangle, Clock, DollarSign, Loader2, RefreshCcw,
  Plus, Send, UserPlus, ChevronDown, ChevronUp,
  BarChart3, PieChart, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import Swal from 'sweetalert2';
import api from '../../lib/apiClient';

interface PlatformAnalyticsProps {
  onNavigate?: (tab: string) => void;
}

export function PlatformAnalytics({ onNavigate }: PlatformAnalyticsProps) {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creatingPawnshop, setCreatingPawnshop] = useState(false);
  const [invitingOwner, setInvitingOwner] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selectedPawnshop, setSelectedPawnshop] = useState<any>(null);

  const [createForm, setCreateForm] = useState({
    name: '',
    ownerEmail: '',
    ownerName: '',
    contactPhone: '',
    address: '',
    activateTrial: true,
  });

  const [inviteForm, setInviteForm] = useState({
    email: '',
    ownerName: '',
    pawnshopName: '',
    message: '',
  });

  const [subAction, setSubAction] = useState<{
    type: 'extend' | 'upgrade' | 'status';
    pawnshopId: string;
    pawnshopName: string;
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

  const handleCreatePawnshop = async () => {
    if (!createForm.name || !createForm.ownerEmail) {
      showNotification('Pawnshop name and owner email are required', 'error');
      return;
    }
    setCreatingPawnshop(true);
    try {
      await api.post('/tenant-governance/pawnshops', createForm);
      showNotification(`Pawnshop "${createForm.name}" created successfully`);
      setShowCreateForm(false);
      setCreateForm({ name: '', ownerEmail: '', ownerName: '', contactPhone: '', address: '', activateTrial: true });
      fetchAnalytics();
    } catch (err: any) {
      showNotification(err?.message || 'Failed to create pawnshop', 'error');
    } finally {
      setCreatingPawnshop(false);
    }
  };

  const handleInviteOwner = async () => {
    if (!inviteForm.email || !inviteForm.pawnshopName) {
      showNotification('Email and pawnshop name are required', 'error');
      return;
    }
    setInvitingOwner(true);
    try {
      await api.post('/tenant-governance/invitations', inviteForm);
      showNotification(`Invitation sent to ${inviteForm.email}`);
      setShowInviteForm(false);
      setInviteForm({ email: '', ownerName: '', pawnshopName: '', message: '' });
    } catch (err: any) {
      showNotification(err?.message || 'Failed to send invitation', 'error');
    } finally {
      setInvitingOwner(false);
    }
  };

  const handleSubAction = async () => {
    if (!subAction) return;
    try {
      if (subAction.type === 'extend') {
        await api.post(`/tenant-governance/subscriptions/${subAction.pawnshopId}/extend-trial`, {
          additionalDays: subAction.additionalDays,
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
    { label: 'Total Loan Value', value: `₱${(analytics?.loans?.totalValue || 0).toLocaleString()}`, icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    { label: 'Pending Requests', value: analytics?.pendingRegistrations || 0, icon: Clock, color: 'text-rose-400', bg: 'bg-rose-400/10' },
  ];

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-light text-[#EAE2D6] tracking-tight">
            Platform <span className="font-bold text-[#C9A05C] italic">Analytics</span>
          </h1>
          <p className="text-[#6B655C] mt-2 font-medium italic">Cross-pawnshop metrics and management</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#C9A05C] text-[#1C1C26] rounded-xl font-semibold text-sm hover:bg-[#C9A05C]/90 transition-all"
          >
            <Plus size={16} /> Create Pawnshop
          </button>
          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="flex items-center gap-2 px-5 py-2.5 border border-[#C9A05C]/30 text-[#C9A05C] rounded-xl font-semibold text-sm hover:bg-[#C9A05C]/10 transition-all"
          >
            <UserPlus size={16} /> Invite Owner
          </button>
          <button
            onClick={fetchAnalytics}
            className="flex items-center gap-2 px-4 py-2.5 border border-[rgba(201,160,92,0.15)] text-[#999186] rounded-xl text-sm hover:bg-[#1C1C26] transition-all"
          >
            <RefreshCcw size={16} />
          </button>
        </div>
      </div>

      {/* CREATE PAWNSHOP FORM */}
      {showCreateForm && (
        <div className="rounded-xl border border-[#C9A05C]/20 bg-[#1C1C26] p-6 space-y-4">
          <h3 className="text-lg font-semibold text-[#EAE2D6]">Create New Pawnshop</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              placeholder="Pawnshop Name *"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
            <input
              placeholder="Owner Email *"
              type="email"
              value={createForm.ownerEmail}
              onChange={(e) => setCreateForm({ ...createForm, ownerEmail: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
            <input
              placeholder="Owner Name"
              value={createForm.ownerName}
              onChange={(e) => setCreateForm({ ...createForm, ownerName: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
            <input
              placeholder="Contact Phone"
              value={createForm.contactPhone}
              onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#999186]">
            <input
              type="checkbox"
              checked={createForm.activateTrial}
              onChange={(e) => setCreateForm({ ...createForm, activateTrial: e.target.checked })}
              className="rounded"
            />
            Activate 15-day trial subscription
          </label>
          <div className="flex gap-3">
            <button
              onClick={handleCreatePawnshop}
              disabled={creatingPawnshop}
              className="px-5 py-2.5 bg-[#C9A05C] text-[#1C1C26] rounded-xl font-semibold text-sm hover:bg-[#C9A05C]/90 transition-all disabled:opacity-50"
            >
              {creatingPawnshop ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Create Pawnshop'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-5 py-2.5 border border-[rgba(201,160,92,0.15)] text-[#999186] rounded-xl text-sm hover:bg-[#1C1C26] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* INVITE OWNER FORM */}
      {showInviteForm && (
        <div className="rounded-xl border border-[#C9A05C]/20 bg-[#1C1C26] p-6 space-y-4">
          <h3 className="text-lg font-semibold text-[#EAE2D6]">Invite Pawnshop Owner</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              placeholder="Owner Email *"
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
            <input
              placeholder="Pawnshop Name *"
              value={inviteForm.pawnshopName}
              onChange={(e) => setInviteForm({ ...inviteForm, pawnshopName: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
            <input
              placeholder="Owner Name"
              value={inviteForm.ownerName}
              onChange={(e) => setInviteForm({ ...inviteForm, ownerName: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50"
            />
            <textarea
              placeholder="Personal message (optional)"
              value={inviteForm.message}
              onChange={(e) => setInviteForm({ ...inviteForm, message: e.target.value })}
              className="px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm focus:outline-none focus:border-[#C9A05C]/50 resize-none"
              rows={2}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleInviteOwner}
              disabled={invitingOwner}
              className="px-5 py-2.5 bg-[#C9A05C] text-[#1C1C26] rounded-xl font-semibold text-sm hover:bg-[#C9A05C]/90 transition-all disabled:opacity-50"
            >
              {invitingOwner ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Send Invitation'}
            </button>
            <button
              onClick={() => setShowInviteForm(false)}
              className="px-5 py-2.5 border border-[rgba(201,160,92,0.15)] text-[#999186] rounded-xl text-sm hover:bg-[#1C1C26] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[rgba(201,160,92,0.1)] bg-[#1C1C26] p-4">
            <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <p className="text-2xl font-bold text-[#EAE2D6]">{stat.value}</p>
            <p className="text-xs text-[#6B655C] mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* SUBSCRIPTION MANAGEMENT MODAL */}
      {subAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1C1C26] border border-[rgba(201,160,92,0.2)] rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-[#EAE2D6]">
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
                className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm"
                placeholder="Additional days"
              />
            )}
            {subAction.type === 'upgrade' && (
              <select
                value={subForm.tier}
                onChange={(e) => setSubForm({ ...subForm, tier: e.target.value })}
                className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm"
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
                className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm"
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
              className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#EAE2D6] text-sm"
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
                className="px-5 py-2.5 border border-[rgba(201,160,92,0.15)] text-[#999186] rounded-xl text-sm"
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
