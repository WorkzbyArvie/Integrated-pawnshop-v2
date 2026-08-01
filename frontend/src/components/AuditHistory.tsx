import { useEffect, useMemo, useState } from 'react';
import { Filter, Loader2, Search, Shield } from 'lucide-react';
import api from '../lib/apiClient';
import { useToast } from '../App';

type AuditLogRow = {
  id: string;
  pawnshop_id: string;
  actor_user_id: string;
  actor_email?: string | null;
  actor_name?: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

interface AuditHistoryProps {
  branchId: string | null;
  userRole: string;
}

const classifyAction = (action: string) => {
  const normalized = String(action || '').toUpperCase();
  if (normalized.includes('STAFF')) return 'Staff';
  if (normalized.includes('TRANSACTION')) return 'Transaction';
  if (normalized.includes('OPERATION') || normalized.includes('BRANCH')) return 'Operational';
  if (normalized.includes('SUPPORT')) return 'Support';
  if (normalized.includes('SUBSCRIPTION') || normalized.includes('BILLING')) return 'Billing';
  return 'Other';
};

const toHumanActionLabel = (action: string): string => {
  const raw = String(action || '').trim();
  if (!raw) return 'Unknown Action';

  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getOperationReason = (row: AuditLogRow): string => {
  const action = String(row.action || '').toUpperCase();
  const metadata = (row.metadata || {}) as Record<string, unknown>;

  if (action === 'OPERATIONAL_APPRAISAL_REJECTED') {
    return String(metadata.rejectionReason || metadata.reason || 'Appraisal was rejected by reviewer');
  }

  if (action === 'OPERATIONAL_APPRAISAL_APPROVED') {
    return 'Appraisal passed review and was approved for activation.';
  }

  if (action.includes('BRANCH_CREATED')) {
    const branchName = metadata.branchName ? ` (${String(metadata.branchName)})` : '';
    return `New branch was added${branchName}.`;
  }

  if (action.includes('BRANCH_UPDATED')) {
    return 'Branch configuration/details were updated.';
  }

  if (action.includes('SUPPORT_ACCESS_REQUESTED')) {
    return String(metadata.reason || 'Support access was requested.');
  }

  if (action.includes('SUBSCRIPTION_TIER_CHANGED')) {
    const previousTier = metadata.previousTier ? String(metadata.previousTier) : 'Previous plan';
    const newTier = metadata.newTier ? String(metadata.newTier) : 'new plan';
    return `Plan changed from ${previousTier} to ${newTier}.`;
  }

  if (action.includes('SUBSCRIPTION_CREATED')) {
    const tier = metadata.tier ? String(metadata.tier) : 'selected tier';
    return `Subscription created for ${tier}.`;
  }

  const reasonKeys = ['reason', 'rejectionReason', 'message', 'notes', 'requestedAction'];
  for (const key of reasonKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const previousStatus = metadata.previousStatus ? String(metadata.previousStatus) : null;
  const newStatus = metadata.newStatus ? String(metadata.newStatus) : null;
  if (previousStatus && newStatus) {
    return `Status changed from ${previousStatus} to ${newStatus}.`;
  }

  return 'Operational audit event recorded.';
};

export function AuditHistory({ branchId, userRole }: AuditHistoryProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const normalizedRole = String(userRole || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  const fetchHistory = async () => {
    if (!branchId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const tenantData = await api.get<AuditLogRow[]>('/tenant-governance/audit/history', {
        pawnshopId: branchId,
        limit: 300,
      });

      setRows(Array.isArray(tenantData) ? tenantData : []);
    } catch (error: any) {
      showToast(error?.message || 'Failed to load audit history', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [branchId]);

  const visibleRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      const category = classifyAction(row.action);
      const matchesCategory = categoryFilter === 'all' || category.toLowerCase() === categoryFilter;
      if (!matchesCategory) return false;

      if (!search) return true;

      const actor = `${row.actor_name || ''} ${row.actor_email || ''}`.toLowerCase();
      const action = String(row.action || '').toLowerCase();
      const actionLabel = toHumanActionLabel(row.action).toLowerCase();
      const reasonText = getOperationReason(row).toLowerCase();

      return actor.includes(search) || action.includes(search) || actionLabel.includes(search) || reasonText.includes(search);
    });
  }, [rows, searchTerm, categoryFilter]);

  const roleBadge = normalizedRole === 'OWNER' ? 'Owner View (Full Tenant Audit)' : 'Branch Admin View (Scoped Audit)';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tight uppercase italic leading-none">
            Audit <span className="text-[#C9A05C]">History</span>
          </h2>
          <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#C9A05C]" />
            {roleBadge}
          </p>
        </div>
        <button
          onClick={fetchHistory}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] hover:bg-[#1C1C26] text-[10px] font-black uppercase tracking-widest text-slate-800"
        >
          Refresh Logs
        </button>
      </div>

      <div className="bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.08)] p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#6B655C] absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search actor, action, or reason..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-[rgba(201,160,92,0.12)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[rgba(201,160,92,0.2)]"
          />
        </div>

        <div className="relative md:w-64">
          <Filter className="w-4 h-4 text-[#C9A05C] absolute left-4 top-1/2 -translate-y-1/2" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-[rgba(201,160,92,0.12)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[rgba(201,160,92,0.2)]"
          >
            <option value="all">All Categories</option>
            <option value="staff">Staff</option>
            <option value="transaction">Transaction</option>
            <option value="operational">Operational</option>
            <option value="support">Support</option>
            <option value="billing">Billing</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-[#14141B] rounded-[2.5rem] border border-dashed border-[rgba(201,160,92,0.12)]">
          <Loader2 className="w-10 h-10 text-[#C9A05C] animate-spin mb-3" />
          <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Loading Audit Logs...</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] p-8 text-sm font-bold text-[#6B655C]">
          No audit logs found for the current scope.
        </div>
      ) : (
        <div className="bg-[#14141B] rounded-[2.5rem] border border-[rgba(201,160,92,0.08)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="bg-[#1C1C26] border-b border-[rgba(201,160,92,0.08)]">
                <tr>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Time</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Actor</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Category</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Action</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Reason</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const category = classifyAction(row.action);
                  const reason = getOperationReason(row);
                  const actionLabel = toHumanActionLabel(row.action);
                  return (
                    <tr key={row.id} className="border-b last:border-b-0 border-[rgba(201,160,92,0.08)] hover:bg-[#C9A05C]/8/20 transition-colors">
                      <td className="px-5 py-4 text-sm font-bold text-[#6B655C]">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : 'Unknown'}
                      </td>
                      <td className="px-5 py-4 text-sm font-bold text-[#6B655C]">
                        {row.actor_name || row.actor_email || row.actor_user_id}
                      </td>
                      <td className="px-5 py-4 text-xs font-black uppercase tracking-wider text-[#C9A05C]">{category}</td>
                      <td className="px-5 py-4 text-sm font-bold text-[#6B655C]">{actionLabel}</td>
                      <td className="px-5 py-4 text-xs text-[#999186] max-w-[420px] whitespace-pre-wrap break-words">
                        {reason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
