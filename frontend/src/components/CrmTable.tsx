import { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  Phone, 
  Shield, 
  User, 
  MapPin, 
  Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../App';

interface CrmTableProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface Customer {
  id: string;
  full_name: string;
  contact_number: string;
  address: string;
  pawnshop_id: string | null;
  created_at: string;
}

export function CrmTable({ branchId, activeBranchId }: CrmTableProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const { showToast } = useToast();
  
  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const activeOperationalBranchId = Number.isInteger(activeBranchId as number) ? Number(activeBranchId) : NaN;
      const hasActiveOperationalBranch = Number.isInteger(activeOperationalBranchId) && activeOperationalBranchId > 0;

      let scopedCustomerIds: string[] | null = null;
      if (branchId) {
        let ticketsQuery = supabase
          .from('ticket')
          .select('customer_id')
          .eq('pawnshop_id', branchId)
          .neq('status', 'REJECTED');

        if (hasActiveOperationalBranch) {
          ticketsQuery = ticketsQuery.eq('branch_id', activeOperationalBranchId as any);
        }

        const { data: ticketRows, error: ticketError } = await ticketsQuery;

        if (ticketError) throw ticketError;

        scopedCustomerIds = Array.from(
          new Set((ticketRows || []).map((row: any) => row.customer_id).filter(Boolean))
        );

        if (scopedCustomerIds.length === 0) {
          setCustomers([]);
          return;
        }
      }

      let query = supabase
        .from('customer')
        .select('*')
        .order('created_at', { ascending: false });

      if (branchId) {
        query = query.eq('pawnshop_id', branchId);
      }

      if (scopedCustomerIds) {
        query = query.in('id', scopedCustomerIds);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCustomers(data || []);
    } catch (error: any) {
      console.error('Fetch error:', error);
      showToast(error.message || 'Failed to sync with customer ledger', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [branchId, activeBranchId]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      c.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.contact_number?.includes(searchTerm) ||
      c.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [customers, searchTerm]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 bg-[#14141B] rounded-[3rem] border border-dashed border-[rgba(201,160,92,0.12)]">
        <Loader2 className="w-12 h-12 text-[#C9A05C] animate-spin mb-4" />
        <p className="text-[#6B655C] font-black uppercase tracking-widest text-[10px]">Syncing Client Ledger...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-[500px]">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 w-5 h-5" />
          <input 
            type="text"
            placeholder="Search by name, phone, or UUID..."
            className="w-full pl-14 pr-6 py-4 bg-[#14141B] border border-[rgba(201,160,92,0.08)] shadow-sm rounded-2xl text-sm font-bold placeholder:text-[#6B655C] focus:ring-2 focus:ring-[#C9A05C]/20 transition-all outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-[#14141B] px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.08)] shadow-sm">
            <p className="text-[8px] font-black text-[#6B655C] uppercase tracking-tighter">Total Records</p>
            <p className="text-sm font-black text-[#C9A05C]">{customers.length}</p>
          </div>
          <button className="flex items-center gap-2 px-6 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95 shadow-lg">
            <Filter className="w-4 h-4 text-[#C9A05C]" /> Filter
          </button>
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#1C1C26]/50">
                <th className="px-8 py-5 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Client Identity</th>
                <th className="px-8 py-5 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Contact Info</th>
                <th className="px-8 py-5 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} className="group hover:bg-[#1C1C26]/30 transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-[#C9A05C]/10 text-[#C9A05C] rounded-2xl flex items-center justify-center font-black text-sm border border-[rgba(201,160,92,0.15)] group-hover:scale-105 transition-transform">
                        {customer.full_name ? customer.full_name.substring(0, 2).toUpperCase() : '??'}
                      </div>
                      <div>
                        <p className="font-black text-[#EAE2D6] text-base leading-none mb-1">{customer.full_name}</p>
                        <span className="text-[9px] font-black text-white bg-[#C9A05C] px-1.5 py-0.5 rounded uppercase tracking-tighter">Verified</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#6B655C]">
                        <Phone className="w-3.5 h-3.5 text-[#C9A05C]" /> {customer.contact_number || 'N/A'}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-medium text-[#6B655C]">
                        <MapPin className="w-3.5 h-3.5 text-slate-300" /> 
                        <span className="truncate max-w-[180px]">{customer.address || 'No address'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-emerald-500" />
                      <div>
                        <p className="text-[10px] font-black text-[#EAE2D6] uppercase">Active</p>
                        <p className="text-[9px] font-bold text-[#6B655C] uppercase tracking-tighter">ID: {customer.id.slice(0, 8)}</p>
                      </div>
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredCustomers.length === 0 && (
          <div className="py-20 text-center">
            <User className="w-12 h-12 text-slate-100 mx-auto mb-4" />
            <p className="text-[#6B655C] font-black uppercase tracking-widest text-[10px]">No Matching Clients Found</p>
          </div>
        )}
      </div>


    </div>
  );
}