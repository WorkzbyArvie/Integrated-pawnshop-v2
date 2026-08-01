import { useState, useEffect } from 'react';
import { GitBranch, MapPin, Building2, Shield, Loader2, X, Navigation, ArrowLeft, AlertTriangle, TrendingUp } from 'lucide-react';
import { useToast } from '../App';
import api from '../lib/apiClient';
import { LocationPicker } from './LocationPicker';
import { BranchAnalytics } from './BranchAnalytics';

interface BranchRow {
  id: number;
  name: string;
  location: string;
  pawnshop_id: string;
  owner_user_id: string | null;
  is_active: boolean;
  manager_name: string | null;
  staff_count: number;
  active_tickets: number;
  redeemed_tickets: number;
  at_risk_tickets: number;
  active_loan_value: number;
  redeemed_last_30d: number;
  performance_score: number;
  performance_status: string;
}

interface BranchListResponse {
  pawnshopId: string;
  limit: { maxBranches: number | null; activeBranches: number; remaining: number | null };
  branches: BranchRow[];
}

interface BranchManagementProps {
  pawnshopId?: string;
  pawnshopName?: string;
  onBack?: () => void;
}

export function BranchManagement({ pawnshopId, pawnshopName, onBack }: BranchManagementProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<BranchListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [analyticsView, setAnalyticsView] = useState<{ open: boolean; branch: BranchRow | null }>({ open: false, branch: null });

  const [locationModal, setLocationModal] = useState<{
    open: boolean;
    branch: BranchRow | null;
    lat: number | null;
    lng: number | null;
    address: string;
    saving: boolean;
  }>({ open: false, branch: null, lat: null, lng: null, address: '', saving: false });

  const fetchBranches = async () => {
    if (!pawnshopId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const result = await api.get<BranchListResponse>('/tenant-governance/branches', { pawnshopId });
      setData(result);
    } catch (err: unknown) {
      console.error('Branch fetch error:', err);
      showToast('Failed to load branches for this tenant', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [pawnshopId]);

  const openLocationModal = (branch: BranchRow) => {
    setLocationModal({
      open: true,
      branch,
      lat: null,
      lng: null,
      address: branch.location || '',
      saving: false,
    });
  };

  const saveLocation = async () => {
    if (!locationModal.branch || locationModal.lat === null || locationModal.lng === null) {
      showToast('Please select a location on the map first.', 'error');
      return;
    }

    setLocationModal((prev) => ({ ...prev, saving: true }));

    try {
      await api.patch(`/pawnshops/${locationModal.branch.pawnshop_id}/location`, {
        latitude: locationModal.lat,
        longitude: locationModal.lng,
        address: locationModal.address || undefined,
      });

      showToast(`Location saved for ${locationModal.branch.name}`, 'success');
      setLocationModal({ open: false, branch: null, lat: null, lng: null, address: '', saving: false });
      fetchBranches();
    } catch (err: unknown) {
      console.error('Save location error:', err);
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLocationModal((prev) => ({ ...prev, saving: false }));
    }
  };

  if (analyticsView.open && analyticsView.branch) {
    return (
      <BranchAnalytics
        branchId={String(analyticsView.branch.id)}
        branchName={analyticsView.branch.name}
        onBack={() => setAnalyticsView({ open: false, branch: null })}
      />
    );
  }

  const branches = data?.branches || [];
  const limit = data?.limit;

  const performanceColor = (status: string) => {
    switch (status) {
      case 'PERFORMING': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      case 'AT_RISK': return 'text-rose-600 bg-rose-50 border-rose-100';
      default: return 'text-amber-600 bg-amber-50 border-amber-100';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {locationModal.open && locationModal.branch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-[#14141B] rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-6 border-b border-[rgba(201,160,92,0.08)]">
              <div>
                <h2 className="text-xl font-black text-[#EAE2D6]">Set Location — {locationModal.branch.name}</h2>
                <p className="text-sm text-[#6B655C] mt-1">Click the map or search an address to pin the branch location.</p>
              </div>
              <button
                onClick={() => setLocationModal({ open: false, branch: null, lat: null, lng: null, address: '', saving: false })}
                className="p-2 hover:bg-[#1C1C26] rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-[#6B655C]" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <LocationPicker
                latitude={locationModal.lat}
                longitude={locationModal.lng}
                onLocationSelect={(lat, lng) => setLocationModal((prev) => ({ ...prev, lat, lng }))}
                onAddressResolve={(addr) => setLocationModal((prev) => ({ ...prev, address: addr }))}
              />
              {locationModal.address && (
                <div className="bg-[#C9A05C]/10 border border-[rgba(201,160,92,0.2)] rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-[#C9A05C] uppercase tracking-wider mb-1">Resolved Address</p>
                  <p className="text-sm text-[#C9A05C]">{locationModal.address}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-[rgba(201,160,92,0.08)]">
              <button
                onClick={() => setLocationModal({ open: false, branch: null, lat: null, lng: null, address: '', saving: false })}
                className="px-6 py-3 bg-[#1C1C26] text-[#999186] rounded-xl text-sm font-bold hover:bg-[#222228] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLocation}
                disabled={locationModal.saving || locationModal.lat === null}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {locationModal.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                {locationModal.saving ? 'Saving...' : 'Save Location'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="p-3 bg-[#14141B] rounded-xl border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] transition-all text-[#6B655C] hover:text-[#C9A05C]"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-3xl font-black text-[#EAE2D6] flex items-center gap-3 tracking-tight">
              <div className="p-2 bg-[#C9A05C] rounded-xl shadow-lg">
                <GitBranch className="w-7 h-7 text-white" />
              </div>
              <span className="text-[#C9A05C]">{pawnshopName || 'Tenant'}</span>
              <span className="text-[#6B655C] font-medium">Branches</span>
            </h1>
            <p className="text-[#6B655C] font-medium mt-1 ml-16">
              {limit ? `${limit.activeBranches} of ${limit.maxBranches ?? '∞'} branches active` : 'Loading branch data...'}
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-32 bg-[#14141B] rounded-[3rem] border border-[rgba(201,160,92,0.08)]">
          <Loader2 className="w-12 h-12 text-[#C9A05C] animate-spin mb-4" />
          <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-[0.3em]">Loading Branches...</p>
        </div>
      ) : branches.length === 0 ? (
        <div className="py-20 text-center bg-[#14141B] rounded-[3rem] border-2 border-dashed border-[rgba(201,160,92,0.12)]">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-[#6B655C] font-bold text-[10px] uppercase tracking-widest">No branches registered for this tenant.</p>
          <p className="text-[#6B655C] font-medium text-xs mt-2">Branches are created by the tenant owner from their dashboard.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {branches.map((branch) => (
            <div key={branch.id} className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-[2.5rem] p-8 hover:shadow-2xl hover:border-[rgba(201,160,92,0.2)] transition-all group relative overflow-hidden">
              <div className="flex justify-between items-start mb-6 relative z-10">
                <div className="w-14 h-14 bg-[#1C1C26] rounded-2xl flex items-center justify-center group-hover:bg-[#C9A05C] transition-colors">
                  <Building2 className="w-7 h-7 text-[#6B655C] group-hover:text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border ${performanceColor(branch.performance_status)}`}>
                    {branch.performance_status === 'PERFORMING' ? 'Performing' : branch.performance_status === 'AT_RISK' ? 'At Risk' : 'Stable'}
                  </span>
                </div>
              </div>

              <div className="relative z-10">
                <h3 className="text-2xl font-black text-[#EAE2D6] group-hover:text-[#C9A05C] transition-colors">{branch.name}</h3>
                <p className="text-[#6B655C] flex items-center gap-1.5 text-sm mb-4 font-bold">
                  <MapPin className="w-4 h-4 text-blue-500" /> {branch.location || 'No location set'}
                </p>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Active Tickets</p>
                    <p className="font-bold text-[#EAE2D6] text-sm">{branch.active_tickets}</p>
                  </div>
                  <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Staff</p>
                    <p className="font-bold text-[#EAE2D6] text-sm">{branch.staff_count}</p>
                  </div>
                  <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Loan Value</p>
                    <p className="font-bold text-[#EAE2D6] text-sm">₱{branch.active_loan_value.toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Score</p>
                    <p className="font-bold text-[#C9A05C] text-sm">{branch.performance_score}/100</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-50 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-[#1C1C26] text-[#999186] rounded-xl group-hover:bg-[#C9A05C]/10 group-hover:text-[#C9A05C] transition-colors">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#6B655C] uppercase font-black tracking-tighter">Manager</p>
                      <p className="text-sm font-bold text-[#EAE2D6]">{branch.manager_name || 'Unassigned'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-[#1C1C26] text-[#999186] rounded-xl group-hover:bg-[#C9A05C]/10 group-hover:text-[#C9A05C] transition-colors">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#6B655C] uppercase font-black tracking-tighter">At Risk</p>
                      <p className="text-sm font-bold text-[#EAE2D6]">{branch.at_risk_tickets} tickets</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => openLocationModal(branch)}
                    className="flex-1 py-3 bg-[#1C1C26] text-[#6B655C] text-[10px] font-black uppercase rounded-xl group-hover:bg-blue-600/10 group-hover:text-blue-500 transition-all hover:shadow-md flex items-center justify-center gap-2"
                  >
                    <MapPin size={14} /> Location
                  </button>
                  <button
                    onClick={() => setAnalyticsView({ open: true, branch })}
                    className="flex-1 py-3 bg-[#C9A05C]/10 text-[#C9A05C] text-[10px] font-black uppercase rounded-xl hover:bg-[#C9A05C] hover:text-white transition-all hover:shadow-md flex items-center justify-center gap-2"
                  >
                    <TrendingUp size={14} /> Analytics
                  </button>
                </div>
              </div>

              <GitBranch className="absolute -right-8 -bottom-8 w-48 h-48 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
