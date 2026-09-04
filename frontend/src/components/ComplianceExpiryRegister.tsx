import { useEffect, useState, useCallback } from 'react';
import { CalendarClock, AlertTriangle, RefreshCw, History, Loader2 } from 'lucide-react';
import { api } from '../lib/apiClient';

const DOCUMENT_LABELS: Record<string, string> = {
  DTI_REGISTRATION: 'DTI/SEC Registration',
  MAYORS_PERMIT: "Mayor's Permit",
  BIR_COR: 'BIR COR',
  BSP_LICENSE: 'BSP License',
  AMLC_REGISTRATION: 'AMLC Registration',
  GOVERNMENT_ID: 'Government ID',
  PROOF_OF_ADDRESS: 'Proof of Address',
  FIRE_SAFETY_CERT: 'Fire Safety Cert',
  OCCUPANCY_PERMIT: 'Occupancy Permit',
  SEC_REGISTRATION: 'SEC Registration',
};

interface DocRow {
  id: string;
  type: string;
  status: string;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  fileName: string;
}

interface RegisterPawnshop {
  pawnshopId: string;
  pawnshopName: string;
  ownerEmail: string | null;
  documents: DocRow[];
  expiringCount: number;
  expiredCount: number;
}

interface Reminder {
  id: string;
  title: string;
  body: string;
  channel: string;
  createdAt: string;
  documentType: string;
  pawnshopId: string;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
}

function formatDate(value: string | null) {
  if (!value) return 'No expiry';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysTone(days: number | null, status: string) {
  if (status === 'EXPIRED') return { color: 'text-red-400', bg: 'bg-red-500/15' };
  if (days === null) return { color: 'text-gilded-muted', bg: 'bg-gilded-darker/60' };
  if (days <= 7) return { color: 'text-red-400', bg: 'bg-red-500/15' };
  if (days <= 14) return { color: 'text-orange-400', bg: 'bg-orange-500/15' };
  if (days <= 30) return { color: 'text-amber-400', bg: 'bg-amber-500/15' };
  return { color: 'text-emerald-400', bg: 'bg-emerald-500/15' };
}

export default function ComplianceExpiryRegister({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState<RegisterPawnshop[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ pawnshops: RegisterPawnshop[] }>('/compliance/expiry-register');
      setRegister(data.pawnshops || []);
      if (isSuperAdmin) {
        const hist = await api.get<{ reminders: Reminder[] }>('/compliance/reminder-history').catch(() => null);
        setReminders(hist?.reminders || []);
      }
    } catch (err) {
      console.error('Failed to load expiry register:', err);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const expiringSoon = register.flatMap((ps) =>
    ps.documents
      .filter((d) => d.daysUntilExpiry !== null && d.daysUntilExpiry <= 30)
      .map((d) => ({ ps, d })),
  );
  const urgent = expiringSoon.filter((x) => (x.d.daysUntilExpiry ?? 31) <= 7 || x.d.status === 'EXPIRED');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-gilded-gold" />
          <h2 className="text-lg font-display font-bold text-gilded-gold">Regulatory Expiry Register</h2>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-1.5 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light text-xs hover:border-gilded-gold/50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {(loading || expiringSoon.length > 0) && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
            urgent.length > 0
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <p className="text-sm">
            {loading
              ? 'Checking document expirations...'
              : urgent.length > 0
              ? `${urgent.length} document${urgent.length > 1 ? 's' : ''} expiring within 7 days or already expired. Replace them now to stay compliant.`
              : `${expiringSoon.length} document${expiringSoon.length > 1 ? 's' : ''} expiring within 30 days. Review and replace soon.`}
          </p>
        </div>
      )}

      {isSuperAdmin && (
        <button
          onClick={() => setShowHistory((s) => !s)}
          className="flex items-center gap-2 px-3 py-1.5 bg-gilded-dark border border-gilded-border rounded-lg text-gilded-light text-xs hover:border-gilded-gold/50 transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          {showHistory ? 'Hide Reminder History' : 'Show Reminder History'}
        </button>
      )}

      {showHistory && isSuperAdmin && (
        <div className="bg-gilded-dark border border-gilded-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gilded-light mb-3">Reminder History</h3>
          {reminders.length === 0 ? (
            <p className="text-xs text-gilded-muted">No compliance reminders sent yet.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {reminders.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 text-xs rounded-lg bg-gilded-darker/60 border border-gilded-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gilded-light">{r.title}</p>
                    <p className="text-gilded-muted mt-0.5">{r.body}</p>
                    {r.documentType && (
                      <p className="text-[11px] text-gilded-muted mt-0.5">
                        {DOCUMENT_LABELS[r.documentType] || r.documentType}
                        {r.expiryDate ? ` · expires ${formatDate(r.expiryDate)}` : ''}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-gilded-muted">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="bg-gilded-dark border border-gilded-border rounded-xl p-10 flex justify-center">
          <Loader2 className="w-6 h-6 text-gilded-gold animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {register.length === 0 ? (
            <div className="text-center py-12 text-gilded-muted">No pawnshop data found.</div>
          ) : (
            register.map((ps) => (
              <div key={ps.pawnshopId} className="bg-gilded-dark border border-gilded-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gilded-border">
                  <div>
                    <h4 className="font-semibold text-gilded-light">{ps.pawnshopName}</h4>
                    {ps.ownerEmail && <p className="text-[11px] text-gilded-muted">Owner: {ps.ownerEmail}</p>}
                  </div>
                  <div className="flex gap-2 text-[11px]">
                    {ps.expiringCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                        {ps.expiringCount} expiring
                      </span>
                    )}
                    {ps.expiredCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                        {ps.expiredCount} expired
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-gilded-border/50">
                  {ps.documents.map((d) => {
                    const tone = daysTone(d.daysUntilExpiry, d.status);
                    return (
                      <div key={d.type} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-gilded-light truncate">
                            {DOCUMENT_LABELS[d.type] || d.type}
                          </p>
                          <p className="text-[11px] text-gilded-muted truncate">
                            {d.status === 'NOT_UPLOADED'
                              ? 'Not uploaded'
                              : d.status === 'REJECTED'
                              ? 'Rejected'
                              : d.fileName || d.status.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {d.status === 'NOT_UPLOADED' ? (
                            <span className="text-[11px] text-gilded-muted">Missing</span>
                          ) : (
                            <span className="text-[11px] text-gilded-muted">
                              Expires {formatDate(d.expiryDate)}
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone.bg} ${tone.color} min-w-[64px] text-center`}>
                            {d.status === 'EXPIRED'
                              ? 'Expired'
                              : d.status === 'NOT_UPLOADED'
                              ? '—'
                              : d.daysUntilExpiry !== null
                              ? `${d.daysUntilExpiry}d`
                              : 'No expiry'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
