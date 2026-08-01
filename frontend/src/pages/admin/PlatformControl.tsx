import { useState, useEffect } from 'react';
import {
  Building2, Globe, Loader2,
  X, Trash2, AlertTriangle, Search,
  TrendingUp, Users, Activity, CalendarDays, GitBranch, CreditCard, ArrowRight
} from 'lucide-react';
import Swal from 'sweetalert2';
import api from '../../lib/apiClient';
import { BranchAnalytics } from '../../components/BranchAnalytics';

interface PlatformControlProps {
  userRole: string;
  onManageBranches?: (pawnshopId: string, pawnshopName: string) => void;
}

export function PlatformControl({ userRole, onManageBranches }: PlatformControlProps) {
  const [pawnshops, setPawnshops] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [shopToDelete, setShopToDelete] = useState<any>(null);
  const [selectedShop, setSelectedShop] = useState<any>(null);
  const [analyticsShop, setAnalyticsShop] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isSuperAdmin = userRole === 'SUPER' || userRole === 'SUPER_ADMIN' || userRole === 'Super Admin';

  useEffect(() => {
    if (isSuperAdmin) fetchPawnshops();
  }, [isSuperAdmin]);

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

  const fetchPawnshops = async () => {
    try {
      const data = await api.get<any[]>('/pawnshops');
      const shops = Array.isArray(data) ? data : [];

      let metadataRows: Array<Record<string, any>> = [];
      try {
        const metadata = await api.get<Array<Record<string, any>>>('/tenant-governance/pawnshops/metadata');
        metadataRows = Array.isArray(metadata) ? metadata : [];
      } catch (err) {
        console.warn('Unable to load pawnshop metadata:', err);
      }

      const metadataById = new Map(
        metadataRows
          .filter((row) => Boolean(row?.id))
          .map((row) => [String(row.id), row]),
      );

      let statsMap = new Map<string, any>();
      try {
        const ids = shops.map((s: any) => s.id).filter(Boolean);
        if (ids.length > 0) {
          const batchStats = await api.get<any[]>(`/analytics/branch-stats/batch?ids=${ids.join(',')}`);
          if (Array.isArray(batchStats)) {
            statsMap = new Map(batchStats.map((s: any) => [String(s.pawnshopId), s]));
          }
        }
      } catch (err) {
        console.warn('Unable to load batch branch stats:', err);
      }

      const enrichedData = shops.map((shop: any) => {
        const metadata = metadataById.get(String(shop.id));
        const stats = statsMap.get(String(shop.id)) || {};
        return {
          ...shop,
          clientCount: stats.clientCount || 0,
          activeTickets: stats.activeTickets || 0,
          avgTicketsPerDay: Math.max(0, Number(((stats.activeTickets || 0) / 30).toFixed(1))),
          subscriptionPlan:
            metadata?.subscription_tier ||
            shop.settings?.subscription_plan ||
            'FREE',
          loanValue: stats.totalPrincipal || 0,
        };
      });
      setPawnshops(enrichedData);
    } catch (err) {
      console.error('Error fetching pawnshops:', err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!shopToDelete) return;
    setIsDeleting(true);
    try {
      await api.post(`/tenant-governance/pawnshops/${shopToDelete.id}/delete`);
      showNotification(`${shopToDelete.name} has been removed.`);
      await fetchPawnshops();
      setShopToDelete(null);
    } catch (err: unknown) {
      showNotification((err instanceof Error ? err.message : String(err)) || "Failed to delete pawnshop.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleShopStatus = async (id: string, currentStatus: boolean) => {
    try {
      await api.patch(`/tenant-governance/pawnshops/${id}/toggle-status`);
      fetchPawnshops();
      showNotification(`Status updated to ${!currentStatus ? 'Active' : 'Suspended'}`);
    } catch (err: unknown) {
      showNotification((err instanceof Error ? err.message : String(err)) || "Failed to update status", "error");
    }
  };

  if (analyticsShop) {
    return (
      <div className="p-8">
        <BranchAnalytics
          branchId={analyticsShop.id}
          branchName={analyticsShop.name}
          onBack={() => setAnalyticsShop(null)}
        />
      </div>
    );
  }

  const filteredShops = pawnshops.filter(shop =>
    (shop.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (shop.contactEmail || shop.owner_email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isSuperAdmin) return <div className="p-20 text-center font-black uppercase italic">Access Denied</div>;

  return (
    <div className="p-8 space-y-10 animate-in fade-in duration-500 relative">

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-left">
        <div>
          <h1 className="text-4xl font-light text-[#EAE2D6] tracking-tight">
            Platform <span className="font-bold text-[#C9A05C] italic">Control</span>
          </h1>
          <p className="text-[#6B655C] mt-2 font-medium italic">Manage tenants, monitor performance, and control access.</p>
        </div>
        <div className="flex items-center gap-3 px-5 py-3 bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)]">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">{pawnshops.length} Tenants</span>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-[#6B655C]" size={18} />
        <input
          type="text" placeholder="Search tenants..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-14 pr-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] shadow-sm outline-none font-medium text-[#EAE2D6]"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-left">
        {filteredShops.map((shop) => (
          <div key={shop.id} className="group bg-[#14141B] p-8 rounded-[32px] border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] transition-all duration-300 shadow-sm hover:shadow-2xl relative">
            <div className="flex justify-between items-start mb-6">
              <div className="p-4 bg-[#C9A05C]/10 rounded-2xl text-[#C9A05C] group-hover:bg-[#C9A05C] group-hover:text-white transition-colors">
                <Building2 size={24} />
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={() => setShopToDelete(shop)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={18} /></button>
                <button onClick={() => toggleShopStatus(shop.id, shop.isActive)} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border transition-all ${shop.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                  {shop.isActive ? 'Active' : 'Suspended'}
                </button>
              </div>
            </div>

            <h3 className="font-bold text-2xl text-[#EAE2D6] mb-1 tracking-tight">{shop.name}</h3>
            <p className="text-sm text-[#6B655C] font-medium mb-6 italic">{shop.contactEmail || 'No email'}</p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Active Tickets</p>
                <p className="font-bold text-[#EAE2D6] text-xs">{shop.activeTickets || 0}</p>
              </div>
              <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Clients</p>
                <p className="font-bold text-[#EAE2D6] text-xs">{shop.clientCount || 0}</p>
              </div>
              <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Loan Value</p>
                <p className="font-bold text-[#EAE2D6] text-xs">₱{(shop.loanValue || 0).toLocaleString()}</p>
              </div>
              <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Plan</p>
                <p className="font-bold text-[#C9A05C] text-xs">{shop.subscriptionPlan}</p>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1">
                <Globe size={12} /> {shop.address || 'No address'}
              </span>
              <button
                onClick={() => setSelectedShop(shop)}
                className="flex items-center gap-2 px-4 py-2 bg-[#C9A05C]/10 text-[#C9A05C] rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-[#C9A05C] hover:text-white transition-all"
              >
                <TrendingUp size={14} /> Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredShops.length === 0 && (
        <div className="py-20 text-center bg-[#14141B] rounded-[3rem] border-2 border-dashed border-[rgba(201,160,92,0.12)]">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-[#6B655C] font-bold text-[10px] uppercase tracking-widest">
            {pawnshops.length === 0 ? 'No tenants registered yet.' : 'No tenants match your search.'}
          </p>
        </div>
      )}

      {selectedShop && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#030213]/80 backdrop-blur-md animate-in fade-in" onClick={() => setSelectedShop(null)} />
          <div className="relative bg-[#14141B] w-full max-w-2xl rounded-[48px] p-12 shadow-2xl animate-in slide-in-from-bottom-10 text-left">
            <div className="flex justify-between items-start mb-10">
              <div>
                <p className="text-[10px] font-black text-[#C9A05C] uppercase tracking-[0.2em] mb-2">Tenant Overview</p>
                <h2 className="text-4xl font-black text-[#EAE2D6] tracking-tighter uppercase italic leading-none">{selectedShop.name}</h2>
              </div>
              <button onClick={() => setSelectedShop(null)} className="p-4 bg-[#1C1C26] rounded-2xl hover:text-rose-500 transition-all"><X size={24} /></button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              <div className="p-6 bg-[#1C1C26] rounded-[24px] border border-[rgba(201,160,92,0.08)] text-center">
                <Users className="mx-auto text-[#C9A05C] mb-2" size={24} />
                <p className="text-2xl font-black text-[#EAE2D6]">{selectedShop.clientCount || 0}</p>
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mt-1">Clients</p>
              </div>
              <div className="p-6 bg-[#1C1C26] rounded-[24px] border border-[rgba(201,160,92,0.08)] text-center">
                <Activity className="mx-auto text-emerald-500 mb-2" size={24} />
                <p className="text-2xl font-black text-[#EAE2D6]">{selectedShop.activeTickets || 0}</p>
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mt-1">Active Tickets</p>
              </div>
              <div className="p-6 bg-[#1C1C26] rounded-[24px] border border-[rgba(201,160,92,0.08)] text-center">
                <CalendarDays className="mx-auto text-blue-500 mb-2" size={24} />
                <p className="text-2xl font-black text-[#EAE2D6]">{selectedShop.avgTicketsPerDay || 0}</p>
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mt-1">Avg / Day</p>
              </div>
              <div className="p-6 bg-[#1C1C26] rounded-[24px] border border-[rgba(201,160,92,0.08)] text-center">
                <CreditCard className="mx-auto text-[#C9A05C] mb-2" size={24} />
                <p className="text-lg font-black text-[#C9A05C]">{selectedShop.subscriptionPlan}</p>
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mt-1">Plan</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-10 text-left">
              <div className="p-5 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Email</p>
                <p className="text-sm font-bold text-[#EAE2D6]">{selectedShop.contactEmail || 'N/A'}</p>
              </div>
              <div className="p-5 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Phone</p>
                <p className="text-sm font-bold text-[#EAE2D6]">{selectedShop.contactPhone || 'N/A'}</p>
              </div>
              <div className="p-5 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)] col-span-2">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Address</p>
                <p className="text-sm font-bold text-[#EAE2D6]">{selectedShop.address || 'No address set'}</p>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => {
                  setAnalyticsShop(selectedShop);
                  setSelectedShop(null);
                }}
                className="flex-1 py-5 bg-[#1C1C26] text-[#EAE2D6] rounded-[24px] font-black uppercase text-xs tracking-[0.15em] flex items-center justify-center gap-3 hover:bg-[#222228] transition-all"
              >
                <TrendingUp size={18} /> Analytics
              </button>
              <button
                onClick={() => {
                  setSelectedShop(null);
                  onManageBranches?.(selectedShop.id, selectedShop.name);
                }}
                className="flex-1 py-5 bg-[#C9A05C] text-white rounded-[24px] font-black uppercase text-xs tracking-[0.15em] flex items-center justify-center gap-3 hover:brightness-110 transition-all"
              >
                <GitBranch size={18} /> Manage Branches <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {shopToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#030213]/60 backdrop-blur-sm animate-in fade-in" onClick={() => setShopToDelete(null)} />
          <div className="relative bg-[#14141B] w-full max-w-md rounded-[40px] p-10 shadow-2xl border border-[rgba(201,160,92,0.08)] text-left">
            <AlertTriangle className="text-rose-500 mb-6" size={32} />
            <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tighter uppercase italic mb-4 leading-none">Confirm Delete</h2>
            <p className="text-[#6B655C] font-medium mb-8 leading-relaxed">Remove <span className="text-[#EAE2D6] font-bold underline">"{shopToDelete.name}"</span>? All branches, staff, and data under this tenant will be affected.</p>
            <div className="flex gap-4">
              <button onClick={() => setShopToDelete(null)} className="flex-1 py-4 rounded-2xl bg-[#1C1C26] text-[#999186] font-bold text-xs uppercase">Cancel</button>
              <button onClick={handleDeleteConfirm} disabled={isDeleting} className="flex-1 py-4 rounded-2xl bg-rose-500 text-white font-black text-xs uppercase flex items-center justify-center gap-2">
                {isDeleting ? <Loader2 className="animate-spin" size={16} /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
