import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Building2, Eye, GitBranch, Loader2, MapPin, Pencil, PlusCircle, Save, ShieldCheck, ToggleLeft, ToggleRight, UserCircle2 } from 'lucide-react';
import api from '../lib/apiClient';
import { useToast } from '../App';
import { formatCurrency } from '../lib/formatters';
import { LocationPicker } from './LocationPicker';

type BranchRow = {
  id: number;
  name: string;
  location: string;
  owner_user_id?: string | null;
  manager_name: string | null;
  is_active: boolean;
  staff_count: number;
  active_tickets?: number;
  redeemed_tickets?: number;
  at_risk_tickets?: number;
  active_loan_value?: number;
  redeemed_last_30d?: number;
  performance_score?: number;
  performance_status?: 'PERFORMING' | 'STABLE' | 'AT_RISK' | string;
  created_at: string;
  updated_at: string;
};

type BranchListResponse = {
  pawnshopId: string;
  limit: {
    maxBranches: number | null;
    activeBranches: number;
    remaining: number | null;
  };
  branches: BranchRow[];
};

interface MultiBranchManagementProps {
  pawnshopId: string | null;
  userRole: string;
  activeBranchId?: number | null;
  onEnterLiveDashboard?: (branchId: number) => void;
}

export function MultiBranchManagement({
  pawnshopId,
  userRole,
  activeBranchId,
  onEnterLiveDashboard,
}: MultiBranchManagementProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<BranchListResponse | null>(null);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    location: '',
    managerName: '',
    assignAdmin: false,
    adminEmail: '',
    adminPassword: '',
    adminAuthCode: '',
  });
  const [formLat, setFormLat] = useState<number | null>(null);
  const [formLng, setFormLng] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', location: '', managerName: '', isActive: true });
  const [editLat, setEditLat] = useState<number | null>(null);
  const [editLng, setEditLng] = useState<number | null>(null);

  const normalizedRole = (userRole || '').toUpperCase().replace(/[_\s]/g, '');
  const canManage = ['OWNER'].includes(normalizedRole);

  const hasReachedLimit = useMemo(() => {
    if (!data?.limit) return false;
    if (data.limit.maxBranches === null) return false;
    return data.limit.activeBranches >= data.limit.maxBranches;
  }, [data]);

  const branchPerformanceSummary = useMemo(() => {
    const rows = data?.branches || [];
    const performing = rows.filter((row) => row.performance_status === 'PERFORMING').length;
    const atRisk = rows.filter((row) => row.performance_status === 'AT_RISK').length;
    return { performing, atRisk };
  }, [data]);

  const formatMoney = (value?: number) => {
    const amount = Number(value || 0);
    return formatCurrency(amount);
  };

  const shortOwnerId = (value?: string | null) => {
    if (!value) return null;
    if (value.length <= 12) return value;
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
  };

  const canEnterLiveDashboard = canManage && typeof onEnterLiveDashboard === 'function';

  const fetchBranches = async () => {
    if (!pawnshopId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await api.get<BranchListResponse>('/tenant-governance/branches', {
        pawnshopId,
      });
      setData(response);
    } catch (error: any) {
      showToast(error?.message || 'Failed to load branches', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [pawnshopId]);

  const resetCreateForm = () => {
    setForm({
      name: '',
      location: '',
      managerName: '',
      assignAdmin: false,
      adminEmail: '',
      adminPassword: '',
      adminAuthCode: '',
    });
    setFormLat(null);
    setFormLng(null);
  };

  const requestAdminAuthCode = async () => {
    if (!form.adminEmail.trim()) {
      showToast('Enter admin email before requesting auth code', 'error');
      return;
    }

    try {
      await api.post<{ authCode?: string; message?: string }>(
        '/auth/request-auth-code',
        {
          email: form.adminEmail.trim().toLowerCase(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        },
      );

      showToast('Authentication code sent to your email.', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Failed to request authentication code', 'error');
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!pawnshopId) {
      showToast('No pawnshop selected', 'error');
      return;
    }

    setSaving(true);
    try {
      const resolvedManagerName =
        form.managerName.trim() ||
        (form.assignAdmin ? `${form.name.trim()} Admin` : '');

      const created = await api.post<{ branch?: { id?: number } }>('/tenant-governance/branches', {
        pawnshopId,
        name: form.name.trim(),
        location: form.location.trim(),
        managerName: resolvedManagerName || undefined,
      });

      if (form.assignAdmin) {
        if (!form.adminEmail.trim() || !form.adminPassword || !form.adminAuthCode.trim()) {
          throw new Error('Admin email, password, and auth code are required to assign branch admin');
        }

        await api.post('/auth/create-branch-admin', {
          email: form.adminEmail.trim().toLowerCase(),
          password: form.adminPassword,
          role: 'BRANCH_ADMIN',
          pawnshop_id: pawnshopId,
          branch_id: created?.branch?.id,
          full_name: resolvedManagerName,
          auth_code: form.adminAuthCode.trim(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        });
      }

      showToast('Branch created successfully', 'success');
      resetCreateForm();
      await fetchBranches();
    } catch (error: any) {
      showToast(error?.message || 'Failed to create branch', 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (branch: BranchRow) => {
    setEditingBranchId(branch.id);
    setEditForm({
      name: branch.name,
      location: branch.location,
      managerName: branch.manager_name || '',
      isActive: branch.is_active,
    });
    setEditLat(null);
    setEditLng(null);
  };

  const saveEdit = async (branchId: number) => {
    setSaving(true);
    try {
      await api.patch(`/tenant-governance/branches/${branchId}`, {
        name: editForm.name.trim(),
        location: editForm.location.trim(),
        managerName: editForm.managerName.trim() || undefined,
        isActive: editForm.isActive,
      });
      showToast('Branch updated successfully', 'success');
      setEditingBranchId(null);
      await fetchBranches();
    } catch (error: any) {
      showToast(error?.message || 'Failed to update branch', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!pawnshopId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-3xl p-8 text-amber-800">
        <p className="font-black uppercase text-xs tracking-widest">Multi-Branch Unavailable</p>
        <p className="mt-2 text-sm font-medium">Select a pawnshop context first to manage branch network.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-[#F5F0E8] uppercase italic flex items-center gap-3">
            <span className="p-2 rounded-xl bg-emerald-600 shadow-lg shadow-emerald-200">
              <GitBranch className="w-6 h-6 text-white" />
            </span>
            Multi-Branch Management
          </h2>
          <p className="text-[#8A8279] font-medium mt-2">Create, organize, and govern branch operations per pawnshop subscription limits.</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-12 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8A8279]">Loading Branch Network...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8279]">Active Branches</p>
              <p className="text-3xl font-black text-[#F5F0E8] mt-2">{data?.limit.activeBranches ?? 0}</p>
            </div>
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8279]">Plan Limit</p>
              <p className="text-3xl font-black text-[#F5F0E8] mt-2">
                {data?.limit.maxBranches === null ? 'Unlimited' : data?.limit.maxBranches ?? 0}
              </p>
            </div>
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8279]">Remaining</p>
              <p className="text-3xl font-black text-[#F5F0E8] mt-2">
                {data?.limit.remaining === null ? 'Infinity' : data?.limit.remaining ?? 0}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Performing Branches</p>
              <p className="text-3xl font-black text-[#F5F0E8] mt-2">{branchPerformanceSummary.performing}</p>
            </div>
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500">At Risk Branches</p>
              <p className="text-3xl font-black text-[#F5F0E8] mt-2">{branchPerformanceSummary.atRisk}</p>
            </div>
          </div>

          {canManage && (
            <form onSubmit={handleCreate} className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6 md:p-8 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <PlusCircle className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-black text-[#F5F0E8] uppercase tracking-wide">Create New Branch</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Branch name"
                  className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <input
                  value={form.managerName}
                  onChange={(e) => setForm((prev) => ({ ...prev, managerName: e.target.value }))}
                  placeholder="Manager name (optional)"
                  className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8279] mb-2 block">Branch Location on Map</label>
                <LocationPicker
                  latitude={formLat}
                  longitude={formLng}
                  onLocationSelect={(lat, lng) => { setFormLat(lat); setFormLng(lng); }}
                  onAddressResolve={(address) => setForm((prev) => ({ ...prev, location: address }))}
                />
                {form.location && (
                  <p className="text-xs text-[#8A8279] mt-2 font-mono bg-[#1C1C26] px-3 py-2 rounded-lg">{form.location}</p>
                )}
              </div>

              <div className="rounded-2xl border border-[rgba(201,160,92,0.12)] p-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-bold text-[#8A8279]">
                  <input
                    type="checkbox"
                    checked={form.assignAdmin}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        assignAdmin: e.target.checked,
                      }))
                    }
                  />
                  Assign New Branch Admin Now
                </label>

                {form.assignAdmin && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <input
                      value={form.adminEmail}
                      onChange={(e) => setForm((prev) => ({ ...prev, adminEmail: e.target.value }))}
                      placeholder="Admin email"
                      className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      type="email"
                      required={form.assignAdmin}
                    />
                    <input
                      value={form.adminPassword}
                      onChange={(e) => setForm((prev) => ({ ...prev, adminPassword: e.target.value }))}
                      placeholder="Admin password"
                      className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      type="password"
                      minLength={8}
                      required={form.assignAdmin}
                    />
                    <input
                      value={form.adminAuthCode}
                      onChange={(e) => setForm((prev) => ({ ...prev, adminAuthCode: e.target.value }))}
                      placeholder="Auth code"
                      className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required={form.assignAdmin}
                    />
                    <button
                      type="button"
                      onClick={requestAdminAuthCode}
                      className="px-4 py-3 rounded-2xl border border-emerald-200 text-emerald-700 text-xs font-black uppercase tracking-wider hover:bg-emerald-50"
                    >
                      Request Code
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={saving || hasReachedLimit}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 text-white text-sm font-black uppercase tracking-wider disabled:opacity-50 hover:bg-emerald-700 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                {hasReachedLimit ? 'Branch Limit Reached' : 'Create Branch'}
              </button>
            </form>
          )}

          <div className="space-y-4">
            {(data?.branches || []).map((branch) => {
              const isEditing = editingBranchId === branch.id;
              const isSelectedLiveBranch = activeBranchId === branch.id;

              return (
                <div key={branch.id} className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-6">
                  {!isEditing ? (
                    <div className="space-y-4">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="space-y-2">
                          <h4 className="text-3xl font-black tracking-tight text-[#F5F0E8] uppercase flex items-center gap-2">
                            <Building2 className="w-6 h-6 text-emerald-600" />
                            {branch.name}
                          </h4>
                          <p className="text-base text-[#8A8279] font-medium flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-[#8A8279]" />
                            {branch.location}
                          </p>
                          <p className="text-base text-[#8A8279] font-medium flex items-center gap-2">
                            <UserCircle2 className="w-4 h-4 text-[#8A8279]" />
                            {branch.manager_name || 'Manager not assigned'}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${branch.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-[#222228] text-[#B8B0A4]'}`}>
                            {branch.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <span
                            className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                              branch.performance_status === 'AT_RISK'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {branch.performance_status === 'AT_RISK' ? 'At Risk' : 'Stable'}
                          </span>
                          {canManage && (
                            <button
                              onClick={() => startEdit(branch)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] text-[#8A8279] text-xs font-black uppercase tracking-wider hover:border-emerald-500 hover:text-emerald-700 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                          )}
                          {canEnterLiveDashboard && (
                            <button
                              onClick={() => onEnterLiveDashboard?.(branch.id)}
                              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${
                                isSelectedLiveBranch
                                  ? 'bg-[#C9A05C] text-white'
                                  : 'border border-[rgba(201,160,92,0.2)] text-[#C9A05C] hover:bg-[#C9A05C]/8'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {isSelectedLiveBranch ? 'Live Dashboard Active' : 'Enter Live Dashboard'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px] font-black uppercase tracking-wider">
                        <div className="px-3 py-2 rounded-xl bg-[#1C1C26] text-[#8A8279]">
                          Active Tickets: {branch.active_tickets ?? 0}
                        </div>
                        <div className="px-3 py-2 rounded-xl bg-[#1C1C26] text-[#8A8279]">
                          At Risk: {branch.at_risk_tickets ?? 0}
                        </div>
                        <div className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700">
                          Loan Value: {formatMoney(branch.active_loan_value)}
                        </div>
                      </div>

                      <p className="text-[11px] font-semibold text-[#8A8279]">
                        {branch.owner_user_id
                          ? `Owner linked: ${shortOwnerId(branch.owner_user_id)}`
                          : 'Owner not linked yet'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                          className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                        <input
                          value={editForm.managerName}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, managerName: e.target.value }))}
                          placeholder="Manager name"
                          className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8A8279] mb-2 block">Branch Location on Map</label>
                        <LocationPicker
                          latitude={editLat}
                          longitude={editLng}
                          onLocationSelect={(lat, lng) => { setEditLat(lat); setEditLng(lng); }}
                          onAddressResolve={(address) => setEditForm((prev) => ({ ...prev, location: address }))}
                        />
                        {editForm.location && (
                          <p className="text-xs text-[#8A8279] mt-2 font-mono bg-[#1C1C26] px-3 py-2 rounded-lg">{editForm.location}</p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, isActive: !prev.isActive }))}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] text-xs font-black uppercase tracking-wider text-[#8A8279] hover:border-emerald-500 hover:text-emerald-700 transition-colors"
                      >
                        {editForm.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        {editForm.isActive ? 'Set Inactive' : 'Set Active'}
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => saveEdit(branch.id)}
                          disabled={saving}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingBranchId(null)}
                          className="px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] text-xs font-black uppercase tracking-wider text-[#8A8279] hover:border-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {(data?.branches || []).length === 0 && (
              <div className="bg-[#1C1C26] border-2 border-dashed border-[rgba(201,160,92,0.12)] rounded-3xl p-10 text-center">
                <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto" />
                <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-[#8A8279]">No Branches Yet</p>
                <p className="mt-2 text-sm text-[#8A8279]">Create your first branch to enable multi-location operations.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
