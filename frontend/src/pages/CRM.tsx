import { useState, useEffect } from 'react';
import { Search, Filter, MoreVertical, Phone, Mail, Shield, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// 1. ADD THIS INTERFACE
interface CrmTableProps {
  branchId: string | null;
}

interface Customer {
  id: string;
  full_name: string;
  contact_number: string;
  address: string;
  loyaltytier: string;
  pawnshop_id: string | null;
  created_at: string;
}

// 2. UPDATE THE FUNCTION SIGNATURE TO ACCEPT branchId
export function CrmTable({ branchId }: CrmTableProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('customer')
          .select('id, full_name, contact_number, address, loyaltytier, pawnshop_id, created_at')
          .order('created_at', { ascending: false });

        if (branchId) {
          query = query.eq('pawnshop_id', branchId);
        }

        const { data, error } = await query;

        if (error) throw error;
        setCustomers(data || []);
      } catch (error) {
        console.error('Error fetching customers:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomers();
  }, [branchId]); // RE-RUN when branch changes

  const filteredCustomers = customers.filter(c => 
    (c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.contact_number.includes(searchTerm) ||
    c.id.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (tierFilter === 'all' || c.loyaltytier === tierFilter)
  );

  const tierColors: Record<string, string> = {
    'Standard': 'bg-gray-500/20 text-gray-400',
    'Bronze': 'bg-amber-700/20 text-amber-500',
    'Silver': 'bg-gray-400/20 text-gray-300',
    'Gold': 'bg-yellow-500/20 text-yellow-400',
    'VIP': 'bg-purple-600/20 text-purple-400',
  };

  if (loading) {
    return (
      <div className="p-20 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#C9A05C] border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-[#6B655C] font-black text-[10px] uppercase tracking-widest">Querying Client Ledger...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Controls */}
      <div className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B655C] w-4 h-4" />
          <input 
            type="text"
            placeholder="Search by name or phone..."
            className="w-full pl-11 pr-4 py-3 bg-[#1C1C26] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#C9A05C] transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#6B655C]" />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="bg-[#1C1C26] border-none rounded-xl px-4 py-3 text-xs font-bold text-[#999186] outline-none focus:ring-2 focus:ring-[#C9A05C] transition-all"
          >
            <option value="all">All Tiers</option>
            <option value="Standard">Standard</option>
            <option value="Bronze">Bronze</option>
            <option value="Silver">Silver</option>
            <option value="Gold">Gold</option>
            <option value="VIP">VIP</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-50">
              <th className="px-6 py-4 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Client Identity</th>
              <th className="px-6 py-4 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Contact Info</th>
              <th className="px-6 py-4 text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Verification</th>
              <th className="px-6 py-4 text-[10px] font-black text-[#6B655C] uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredCustomers.map((customer) => (
              <tr key={customer.id} className="group hover:bg-[#1C1C26]/50 transition-colors">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#C9A05C]/10 text-[#C9A05C] rounded-xl flex items-center justify-center font-bold">
                      {customer.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-[#EAE2D6]">{customer.full_name}</p>
                      <p className="text-[10px] text-[#6B655C] font-medium">UID: {customer.id.slice(0, 8)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-[#999186]">
                      <Phone className="w-3 h-3 text-[#6B655C]" /> {customer.contact_number}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#999186]">
                      <Mail className="w-3 h-3 text-[#6B655C]" /> {customer.address}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-500" />
                    <div>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${tierColors[customer.loyaltytier] || 'bg-gray-500/20 text-gray-400'}`}>
                        {customer.loyaltytier || 'Standard'}
                      </span>
                      <p className="text-[10px] text-[#6B655C] font-medium mt-1">{customer.id.slice(0, 8)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5 text-right">
                  <button className="p-2 hover:bg-[#14141B] hover:shadow-sm rounded-lg transition-all">
                    <MoreVertical className="w-4 h-4 text-[#6B655C]" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}