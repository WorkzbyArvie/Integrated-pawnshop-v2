import { useState, useEffect } from 'react';
import {
  Building2, Globe, Loader2,
  X, Trash2, AlertTriangle, Search, TrendingUp, CreditCard, Users, UserCircle2, Shield
} from 'lucide-react';
import Swal from 'sweetalert2';
import api from '../../lib/apiClient';

interface PlatformControlProps {
  userRole: string;
}

export function PlatformControl({ userRole }: PlatformControlProps) {
  const [pawnshops, setPawnshops] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [shopToDelete, setShopToDelete] = useState<any>(null);
  const [selectedShop, setSelectedShop] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [staffAccounts, setStaffAccounts] = useState<any[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

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

      const enrichedData = await Promise.all(shops.map(async (shop: any) => {
        const metadata = metadataById.get(String(shop.id));
        let staffCount = 0;
        try {
          const staffData = await api.get<{ totalAccounts: number }>(`/tenant-governance/pawnshops/${shop.id}/staff`);
          staffCount = staffData?.totalAccounts ?? 0;
        } catch { /* ignore */ }
        return {
          ...shop,
          subscriptionPlan:
            metadata?.subscription_tier ||
            shop.settings?.subscription_plan ||
            'FREE',
          staffCount,
        };
      }));
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

  const filteredShops = pawnshops.filter(shop =>
    (shop.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (shop.contactEmail || shop.owner_email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const fetchStaffAccounts = async (pawnshopId: string) => {
    setLoadingStaff(true);
    setStaffAccounts([]);
    try {
      const data = await api.get<{ totalAccounts: number; accounts: any[] }>(`/tenant-governance/pawnshops/${pawnshopId}/staff`);
      setStaffAccounts(data?.accounts || []);
    } catch (err: unknown) {
      showNotification((err instanceof Error ? err.message : String(err)) || "Failed to load staff accounts", "error");
    } finally {
      setLoadingStaff(false);
    }
  };

  if (!isSuperAdmin) return <div className="p-20 text-center font-black uppercase italic">Access Denied</div>;

  return (
    <div className="p-8 space-y-10 animate-in fade-in duration-500 relative">

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-left">
        <div>
          <h1 className="text-4xl font-light text-[#F5F0E8] tracking-tight">
            Platform <span className="font-bold text-[#C9A05C] italic">Control</span>
          </h1>
          <p className="text-[#8A8279] mt-2 font-medium italic">Manage tenants, monitor performance, and control access.</p>
        </div>
        <div className="flex items-center gap-3 px-5 py-3 bg-[#14141B] rounded-2xl border border-[rgba(201,160,92,0.08)]">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">{pawnshops.length} Tenants</span>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-[#8A8279]" size={18} />
        <input
          type="text" placeholder="Search tenants..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-14 pr-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] shadow-sm outline-none font-medium text-[#F5F0E8]"
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

            <h3 className="font-bold text-2xl text-[#F5F0E8] mb-1 tracking-tight">{shop.name}</h3>
            <p className="text-sm text-[#8A8279] font-medium mb-6 italic">{shop.contactEmail || 'No email'}</p>

            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#1C1C26] rounded-xl border border-[rgba(201,160,92,0.08)] mb-6">
              <CreditCard size={14} className="text-[#C9A05C]" />
              <span className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Plan</span>
              <span className="font-bold text-[#C9A05C] text-xs">{shop.subscriptionPlan}</span>
            </div>

            {shop.staffCount != null && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#1C1C26] rounded-xl border border-[rgba(201,160,92,0.08)] mb-6 ml-2">
                <Users size={14} className="text-emerald-500" />
                <span className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Staff</span>
                <span className="font-bold text-emerald-500 text-xs">{shop.staffCount}</span>
              </div>
            )}

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
          <p className="text-[#8A8279] font-bold text-[10px] uppercase tracking-widest">
            {pawnshops.length === 0 ? 'No tenants registered yet.' : 'No tenants match your search.'}
          </p>
        </div>
      )}

      {selectedShop && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#030213]/80 backdrop-blur-md animate-in fade-in" onClick={() => { setSelectedShop(null); setStaffAccounts([]); }} />
          <div className="relative bg-[#14141B] w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[48px] p-12 shadow-2xl animate-in slide-in-from-bottom-10 text-left">
            <div className="flex justify-between items-start mb-10">
              <div>
                <p className="text-[10px] font-black text-[#C9A05C] uppercase tracking-[0.2em] mb-2">Tenant Overview</p>
                <h2 className="text-4xl font-black text-[#F5F0E8] tracking-tighter uppercase italic leading-none">{selectedShop.name}</h2>
              </div>
              <button onClick={() => { setSelectedShop(null); setStaffAccounts([]); }} className="p-4 bg-[#1C1C26] rounded-2xl hover:text-rose-500 transition-all"><X size={24} /></button>
            </div>

            <div className="flex items-center gap-3 p-6 bg-[#1C1C26] rounded-[24px] border border-[rgba(201,160,92,0.08)] mb-10">
              <CreditCard className="text-[#C9A05C]" size={24} />
              <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Plan</p>
              <p className="text-lg font-black text-[#C9A05C]">{selectedShop.subscriptionPlan}</p>
              <div className="ml-auto flex items-center gap-2">
                <Users className="text-emerald-500" size={18} />
                <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Staff</p>
                <p className="text-lg font-black text-emerald-500">{selectedShop.staffCount ?? 0}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-10 text-left">
              <div className="p-5 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Email</p>
                <p className="text-sm font-bold text-[#F5F0E8]">{selectedShop.contactEmail || 'N/A'}</p>
              </div>
              <div className="p-5 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Phone</p>
                <p className="text-sm font-bold text-[#F5F0E8]">{selectedShop.contactPhone || 'N/A'}</p>
              </div>
              <div className="p-5 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)] col-span-2">
                <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Address</p>
                <p className="text-sm font-bold text-[#F5F0E8]">{selectedShop.address || 'No address set'}</p>
              </div>
            </div>

            <div className="mb-6">
              <button
                onClick={() => void fetchStaffAccounts(selectedShop.id)}
                disabled={loadingStaff}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#C9A05C] text-white text-xs font-black uppercase tracking-widest hover:bg-[#C9A05C]/80 disabled:opacity-50 transition-all"
              >
                {loadingStaff ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                {staffAccounts.length > 0 ? 'Refresh Staff Accounts' : 'Check Staff Accounts'}
              </button>
            </div>

            {staffAccounts.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-[#C9A05C] uppercase tracking-[0.2em] mb-2">Registered Accounts ({staffAccounts.length})</p>
                {staffAccounts.map((acc: any) => (
                  <div key={acc.id} className="flex items-center gap-4 p-4 bg-[#1C1C26] rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <div className={`p-2 rounded-xl ${acc.isOnline ? 'bg-emerald-500/20 text-emerald-500' : 'bg-[#222228] text-[#8A8279]'}`}>
                      <UserCircle2 size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#F5F0E8] truncate">{acc.fullName || 'No name'}</p>
                      <p className="text-xs text-[#8A8279] truncate">{acc.email || 'No email'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                        acc.role === 'OWNER' ? 'bg-[#C9A05C]/20 text-[#C9A05C]' :
                        acc.role === 'ADMIN' ? 'bg-indigo-500/20 text-indigo-400' :
                        acc.role === 'MANAGER' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-[#222228] text-[#8A8279]'
                      }`}>
                        {acc.role}
                      </span>
                      {acc.isOnline && (
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {shopToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#030213]/60 backdrop-blur-sm animate-in fade-in" onClick={() => setShopToDelete(null)} />
          <div className="relative bg-[#14141B] w-full max-w-md rounded-[40px] p-10 shadow-2xl border border-[rgba(201,160,92,0.08)] text-left">
            <AlertTriangle className="text-rose-500 mb-6" size={32} />
            <h2 className="text-3xl font-black text-[#F5F0E8] tracking-tighter uppercase italic mb-4 leading-none">Confirm Delete</h2>
            <p className="text-[#8A8279] font-medium mb-8 leading-relaxed">Remove <span className="text-[#F5F0E8] font-bold underline">"{shopToDelete.name}"</span>? All branches, staff, and data under this tenant will be affected.</p>
            <div className="flex gap-4">
              <button onClick={() => setShopToDelete(null)} className="flex-1 py-4 rounded-2xl bg-[#1C1C26] text-[#B8B0A4] font-bold text-xs uppercase">Cancel</button>
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
