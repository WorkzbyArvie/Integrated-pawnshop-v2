import { useState, useEffect } from 'react';
import { 
  Building2, Globe, Loader2,
  X, Trash2, AlertTriangle, Search,
  TrendingUp, Users, Activity, CalendarDays, GitBranch, CreditCard
} from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../../lib/supabaseClient';
import api from '../../lib/apiClient';
import { BranchAnalytics } from '../../components/BranchAnalytics';

interface PlatformControlProps {
  userRole: string;
}

export function PlatformControl({ userRole }: PlatformControlProps) {
  const [pawnshops, setPawnshops] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // MODAL STATES
  const [shopToDelete, setShopToDelete] = useState<any>(null);
  const [selectedShop, setSelectedShop] = useState<any>(null);
  const [analyticsShop, setAnalyticsShop] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isSuperAdmin = userRole === 'SUPER' || userRole === 'SUPER_ADMIN' || userRole === 'Super Admin';
  console.log('User Role:', userRole, 'Is Super Admin:', isSuperAdmin);

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
      const { data, error } = await supabase
        .from('pawnshops')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!error && data) {
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

        // Fetch analytics for each pawnshop and enrich the data
        const enrichedData = await Promise.all(
          data.map(async (shop) => {
            const metadata = metadataById.get(String(shop.id));
            try {
              const stats = await api.get<any>(`/analytics/branch/${shop.id}`);
              return {
                ...shop,
                settings: {
                  ...(shop.settings || {}),
                  active_customers: stats.clientCount,
                  active_tickets: stats.activeTickets || 0,
                  avg_tickets_per_day:
                    stats.averageTicketsPerDay ||
                    stats.avgTicketsPerDay ||
                    Math.max(0, Number(((stats.activeTickets || 0) / 30).toFixed(1))),
                  subscription_plan:
                    metadata?.subscription_tier ||
                    stats.subscriptionPlan ||
                    stats.subscriptionTier ||
                    shop.settings?.subscription_plan ||
                    'FREE'
                }
              };
            } catch (err) {
              console.warn(`Failed to fetch stats for shop ${shop.id}:`, err);
            }
            return {
              ...shop,
              settings: {
                ...(shop.settings || {}),
                subscription_plan:
                  metadata?.subscription_tier ||
                  shop.settings?.subscription_plan ||
                  'FREE',
              },
            };
          })
        );
        setPawnshops(enrichedData);
      }
    } catch (err) {
      console.error('Error fetching pawnshops:', err);
    }
  };

  /**
   * FIXED DELETE LOGIC
   * Handles Foreign Key constraints by ensuring child records are 
   * addressed before removing the branch.
   */
  const handleDeleteConfirm = async () => {
    if (!shopToDelete) return;
    setIsDeleting(true);
    try {
      // 1. Remove admin invites and profiles referencing this pawnshop
      await supabase.from('admin_invites').delete().eq('pawnshop_id', shopToDelete.id);
      await supabase.from('profiles').delete().eq('pawnshop_id', shopToDelete.id);

      // 2. Find tickets for this pawnshop and remove dependent rows
      const { data: ticketRows, error: ticketErr } = await supabase
        .from('ticket')
        .select('id')
        .eq('pawnshop_id', shopToDelete.id);

      if (ticketErr) throw ticketErr;

      const ticketIds = (ticketRows || []).map((t: any) => t.id).filter(Boolean);

      if (ticketIds.length > 0) {
        // Delete Loans tied to tickets
        await supabase.from('loan').delete().in('ticketid', ticketIds as any[]);
        // Delete Inventory tied to tickets
        await supabase.from('inventory').delete().in('ticketid', ticketIds as any[]);
        // Delete Transactions tied to tickets
        await supabase.from('transaction').delete().in('ticketid', ticketIds as any[]);
        // Delete Tickets
        await supabase.from('ticket').delete().in('id', ticketIds as any[]);
      }

      // 3. Delete customers linked to pawnshop
      await supabase.from('customer').delete().eq('pawnshop_id', shopToDelete.id);

      // 4. Finally delete the pawnshop
      const { error } = await supabase.from('pawnshops').delete().eq('id', shopToDelete.id);
      if (error) throw error;

      showNotification(`${shopToDelete.name} has been removed.`);
      await fetchPawnshops();
      setShopToDelete(null);
    } catch (err: unknown) {
      // If a foreign key constraint blocks this, the error message will now appear
      console.error('delete pawnshop error', err);
      showNotification((err instanceof Error ? err.message : String(err)) || "Constraint Error: Delete related records first.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleShopStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('pawnshops').update({ is_active: !currentStatus }).eq('id', id);
    if (!error) {
      fetchPawnshops();
      showNotification(`Status updated to ${!currentStatus ? 'Active' : 'Suspended'}`);
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
    (shop.owner_email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isSuperAdmin) return <div className="p-20 text-center font-black uppercase italic">Access Denied</div>;

  return (
    <div className="p-8 space-y-10 animate-in fade-in duration-500 relative">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-left">
        <div>
          <h1 className="text-4xl font-light text-[#EAE2D6] tracking-tight">
            Platform <span className="font-bold text-[#C9A05C] italic">Control</span>
          </h1>
          <p className="text-[#6B655C] mt-2 font-medium italic">Manage branch isolation and real-time performance.</p>
        </div>
      </div>

      {/* SEARCH */}
      <div className="space-y-6">
        <div className="relative max-w-md">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-[#6B655C]" size={18} />
          <input 
            type="text" placeholder="Search branches..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-14 pr-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] shadow-sm outline-none font-medium text-[#EAE2D6]"
          />
        </div>
      </div>

      {/* BRANCH GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-left">
        {filteredShops.map((shop) => (
          <div key={shop.id} className="group bg-[#14141B] p-8 rounded-[32px] border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] transition-all duration-300 shadow-sm hover:shadow-2xl relative">
            <div className="flex justify-between items-start mb-6">
              <div className="p-4 bg-[#C9A05C]/10 rounded-2xl text-[#C9A05C] group-hover:bg-[#C9A05C] group-hover:text-white transition-colors">
                <Building2 size={24} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShopToDelete(shop)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={18} /></button>
                <button onClick={() => toggleShopStatus(shop.id, shop.is_active)} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border transition-all ${shop.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                  {shop.is_active ? 'Active' : 'Suspended'}
                </button>
              </div>
            </div>

            <h3 className="font-bold text-2xl text-[#EAE2D6] mb-1 tracking-tight">{shop.name}</h3>
            <p className="text-sm text-[#6B655C] font-medium mb-6 italic">{shop.owner_email}</p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Active Tickets</p>
                <p className="font-bold text-[#EAE2D6] text-xs">{shop.settings?.active_tickets || 0}</p>
              </div>
              <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Active Users</p>
                <p className="font-bold text-[#EAE2D6] text-xs">{shop.settings?.active_customers || 0}</p>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1">
                <Globe size={12} /> ID: {shop.id?.toString().slice(0, 8)}
              </span>
              <button 
                onClick={() => setSelectedShop(shop)}
                className="flex items-center gap-2 px-4 py-2 bg-[#C9A05C]/10 text-[#C9A05C] rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-[#C9A05C] hover:text-white transition-all"
              >
                <TrendingUp size={14} /> Pawnshop Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ANALYTICS MODAL */}
      {selectedShop && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#030213]/80 backdrop-blur-md animate-in fade-in" onClick={() => setSelectedShop(null)} />
          <div className="relative bg-[#14141B] w-full max-w-2xl rounded-[48px] p-12 shadow-2xl animate-in slide-in-from-bottom-10 text-left">
            <div className="flex justify-between items-start mb-10">
              <div>
                <p className="text-[10px] font-black text-[#C9A05C] uppercase tracking-[0.2em] mb-2">Pawnshop Performance</p>
                <h2 className="text-4xl font-black text-[#EAE2D6] tracking-tighter uppercase italic leading-none">{selectedShop.name}</h2>
              </div>
              <button onClick={() => setSelectedShop(null)} className="p-4 bg-[#1C1C26] rounded-2xl hover:text-rose-500 transition-all"><X size={24} /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
              <div className="p-8 bg-[#1C1C26] rounded-[32px] border border-[rgba(201,160,92,0.08)] flex items-center gap-6">
                <div className="w-16 h-16 bg-[#14141B] rounded-[24px] flex items-center justify-center text-[#C9A05C] shadow-sm">
                  <Users size={32} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#6B655C] uppercase tracking-widest">Client Count</p>
                  <p className="text-3xl font-black text-[#EAE2D6]">{selectedShop.settings?.active_customers || 0}</p>
                </div>
              </div>
              <div className="p-8 bg-[#1C1C26] rounded-[32px] border border-[rgba(201,160,92,0.08)] flex items-center gap-6">
                <div className="w-16 h-16 bg-[#14141B] rounded-[24px] flex items-center justify-center text-emerald-500 shadow-sm">
                  <CalendarDays size={32} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#6B655C] uppercase tracking-widest">Avg Tickets / Day</p>
                  <p className="text-3xl font-black text-[#EAE2D6]">{selectedShop.settings?.avg_tickets_per_day || 0}</p>
                </div>
              </div>
            </div>

            <div className="mb-10 p-6 bg-[#1C1C26] rounded-[28px] border border-[rgba(201,160,92,0.08)]">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-[0.2em]">7-Day Performance Trend</p>
                <Activity className="text-[#C9A05C]" size={16} />
              </div>
              <div className="h-20 flex items-end gap-2">
                {[0.68, 0.52, 0.76, 0.61, 0.84, 0.72, 0.9].map((ratio, idx) => (
                  <div
                    key={idx}
                    className="flex-1 bg-[#C9A05C]/15 rounded-t-lg border border-[rgba(201,160,92,0.2)]"
                    style={{ height: `${Math.max(24, Math.round(ratio * 100))}%` }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-2xl p-3">
                  <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Active Tickets</p>
                  <p className="text-sm font-black text-[#EAE2D6] mt-1">{selectedShop.settings?.active_tickets || 0}</p>
                </div>
                <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-2xl p-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Branch Count</p>
                    <p className="text-sm font-black text-[#EAE2D6] mt-1">1</p>
                  </div>
                  <GitBranch className="text-[#6B655C]" size={14} />
                </div>
                <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-2xl p-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Subscription Plan</p>
                    <p className="text-sm font-black text-[#EAE2D6] mt-1">{selectedShop.settings?.subscription_plan || 'FREE'}</p>
                  </div>
                  <CreditCard className="text-[#6B655C]" size={14} />
                </div>
              </div>
            </div>

            <button 
              onClick={() => {
                setAnalyticsShop(selectedShop);
                setSelectedShop(null);
              }}
              className="w-full py-6 bg-[#030213] text-white rounded-[24px] font-black uppercase text-xs tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] transition-transform"
            >
              <TrendingUp size={18} /> Open Analytics
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION */}
      {shopToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#030213]/60 backdrop-blur-sm animate-in fade-in" onClick={() => setShopToDelete(null)} />
          <div className="relative bg-[#14141B] w-full max-w-md rounded-[40px] p-10 shadow-2xl border border-[rgba(201,160,92,0.08)] text-left">
            <AlertTriangle className="text-rose-500 mb-6" size={32} />
            <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tighter uppercase italic mb-4 leading-none">Confirm Delete</h2>
            <p className="text-[#6B655C] font-medium mb-8 leading-relaxed">Remove <span className="text-[#EAE2D6] font-bold underline">"{shopToDelete.name}"</span>? This will break all isolated branch references.</p>
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