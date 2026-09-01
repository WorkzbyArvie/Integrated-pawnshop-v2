import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Search, Shield } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../App';

interface RejectedRecord {
  id: number;
  ticketNumber: string;
  customerName: string;
  category: string;
  branchId: number | null;
  rejectedAt: string;
  reason: string;
}

interface RejectedAppraisalHistoryProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

const extractRejectionReason = (description: string | null | undefined) => {
  if (!description) return 'No reason captured';
  const match = description.match(/\[REJECTED:\s*([^\]]+)\]/i);
  return match?.[1]?.trim() || 'No reason captured';
};

export function RejectedAppraisalHistory({ branchId, activeBranchId }: RejectedAppraisalHistoryProps) {
  const { showToast } = useToast();
  const [records, setRecords] = useState<RejectedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchRejectedHistory = async () => {
    setLoading(true);

    try {
      const activeOperationalBranchId = Number.isInteger(activeBranchId as number) ? Number(activeBranchId) : null;
      const hasActiveOperationalBranch = activeOperationalBranchId != null && activeOperationalBranchId > 0;

      let query = supabase
        .from('ticket')
        .select(`
          id,
          ticket_number,
          category,
          branch_id,
          updated_at,
          description,
          customer:customer_id (
            full_name
          )
        `)
        .eq('status', 'REJECTED')
        .order('updated_at', { ascending: false });

      if (branchId) {
        query = query.eq('pawnshop_id', branchId);
      }

      if (hasActiveOperationalBranch) {
        query = query.eq('branch_id', activeOperationalBranchId as any);
      }

      const { data, error } = await query;
      if (error) throw error;

      const transformed: RejectedRecord[] = (data || []).map((row: any) => ({
        id: Number(row.id),
        ticketNumber: row.ticket_number || 'N/A',
        customerName: row.customer?.full_name || 'Unknown Customer',
        category: row.category || 'Uncategorized',
        branchId: Number.isInteger(row.branch_id) ? row.branch_id : null,
        rejectedAt: row.updated_at || '',
        reason: extractRejectionReason(row.description),
      }));

      setRecords(transformed);
    } catch (error: any) {
      console.error('Failed to load rejected appraisal history:', error);
      showToast(error.message || 'Failed to load rejected appraisal history', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRejectedHistory();
  }, [branchId, activeBranchId]);

  const filteredRecords = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return records;

    return records.filter((record) =>
      record.ticketNumber.toLowerCase().includes(search) ||
      record.customerName.toLowerCase().includes(search) ||
      record.category.toLowerCase().includes(search) ||
      record.reason.toLowerCase().includes(search)
    );
  }, [records, searchTerm]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[#F5F0E8] tracking-tight uppercase italic leading-none">
            Rejected <span className="text-rose-600">History</span>
          </h2>
          <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-[#8A8279] flex items-center gap-2">
            <Shield className="w-4 h-4 text-rose-500" />
            Owner-only audit trail for rejected appraisals
          </p>
        </div>

        <button
          onClick={fetchRejectedHistory}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] hover:bg-[#1C1C26] text-[10px] font-black uppercase tracking-widest text-slate-800"
        >
          Refresh History
        </button>
      </div>

      <div className="relative w-full md:w-[520px]">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8279]" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by ticket, customer, category, or reason..."
          className="w-full pl-12 pr-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold placeholder:text-[#8A8279] focus:outline-none focus:ring-2 focus:ring-rose-200"
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-[#14141B] rounded-[2.5rem] border border-dashed border-[rgba(201,160,92,0.12)]">
          <Loader2 className="w-10 h-10 text-rose-500 animate-spin mb-3" />
          <p className="text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Loading Rejected History...</p>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] p-8 flex items-center gap-4">
          <AlertCircle className="w-6 h-6 text-[#8A8279]" />
          <p className="text-sm font-bold text-[#B8B0A4]">No rejected appraisals found for this scope.</p>
        </div>
      ) : (
        <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="bg-[#1C1C26] border-b border-[rgba(201,160,92,0.08)]">
                <tr>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Ticket</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Customer</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Category</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Branch</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Rejected At</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b last:border-b-0 border-[rgba(201,160,92,0.08)] hover:bg-rose-50/30 transition-colors">
                    <td className="px-5 py-4 text-xs font-black text-[#F5F0E8]">{record.ticketNumber}</td>
                    <td className="px-5 py-4 text-sm font-bold text-[#8A8279]">{record.customerName}</td>
                    <td className="px-5 py-4 text-sm font-bold text-[#8A8279]">{record.category}</td>
                    <td className="px-5 py-4 text-sm font-bold text-[#8A8279]">{record.branchId ?? 'N/A'}</td>
                    <td className="px-5 py-4 text-sm font-bold text-[#8A8279]">
                      {record.rejectedAt ? new Date(record.rejectedAt).toLocaleString() : 'Unknown'}
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-rose-700 max-w-[360px] whitespace-normal break-words">{record.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
