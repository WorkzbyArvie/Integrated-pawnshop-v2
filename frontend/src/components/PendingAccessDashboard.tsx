import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Clock3, MessageSquare, RefreshCcw, Send } from 'lucide-react';
import api from '../lib/apiClient';
import { useToast } from '../App';

type TrialRequest = {
  id: string;
  pawnshop_name: string;
  owner_name: string;
  owner_email: string;
  status: 'PENDING' | 'CONTACTED' | 'APPROVED' | 'REJECTED' | string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

type TrialMessage = {
  id: string;
  request_id: string;
  sender_type: 'OWNER' | 'SUPER_ADMIN' | 'SYSTEM' | string;
  sender_name?: string | null;
  sender_email?: string | null;
  message: string;
  created_at: string;
};

type PendingAccessDashboardProps = {
  ownerEmail?: string | null;
  ownerName?: string | null;
  registrationStatus?: string;
};

type TrialRequestForm = {
  pawnshopName: string;
  ownerName: string;
  ownerEmail: string;
  contactNumber: string;
  staffCount: number;
  notes: string;
  selectedModules: string[];
};

const TRIAL_MODULE_OPTIONS = [
  'Inventory Vault',
  'Finance & Treasury',
  'Customer CRM',
  'Staff Matrix',
  'Decision Support',
  'Auto-Reminders',
] as const;

const statusTone = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized === 'APPROVED') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (normalized === 'CANCELLED') return 'text-[#6B655C] bg-[#1C1C26] border-slate-300';
  if (normalized === 'REJECTED') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (normalized === 'CONTACTED') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-[#C9A05C] bg-[#C9A05C]/10 border-[rgba(201,160,92,0.2)]';
};

export function PendingAccessDashboard({ ownerEmail, ownerName, registrationStatus }: PendingAccessDashboardProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<TrialRequest[]>([]);
  const [messages, setMessages] = useState<TrialMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [, setSubmitMessage] = useState<string | null>(null);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TrialRequestForm>({
    pawnshopName: '',
    ownerName: ownerName || '',
    ownerEmail: ownerEmail || '',
    contactNumber: '',
    staffCount: 5,
    notes: '',
    selectedModules: ['Inventory Vault', 'Customer CRM'],
  });

  const latestRequest = requests[0] ?? null;
  const latestStatus = latestRequest?.status?.toUpperCase() || '';
  const hasActiveRequest = ['PENDING', 'CONTACTED', 'APPROVED'].includes(latestStatus);
  const canCancelRequest = ['PENDING', 'CONTACTED'].includes(latestStatus);

  const canSendMessage = useMemo(() => {
    if (!latestRequest) return false;
    const status = latestRequest.status.toUpperCase();
    return status === 'PENDING' || status === 'CONTACTED' || status === 'APPROVED';
  }, [latestRequest]);

  const canSubmitRequest = useMemo(() => {
    return !hasActiveRequest;
  }, [hasActiveRequest]);

  const loadRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<TrialRequest[]>('/tenant-governance/client-registrations/me');
      setRequests(Array.isArray(rows) ? rows : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Unable to load your onboarding status.';
      setError(message);
      showToast(message, 'error');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (requestId: string) => {
    setLoadingMessages(true);
    try {
      const rows = await api.get<TrialMessage[]>(`/tenant-governance/client-registrations/${requestId}/messages`);
      setMessages(Array.isArray(rows) ? rows : []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  useEffect(() => {
    if (!latestRequest?.id) {
      setMessages([]);
      return;
    }

    loadMessages(latestRequest.id);
  }, [latestRequest?.id]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      ownerEmail: prev.ownerEmail || ownerEmail || '',
      ownerName: prev.ownerName || ownerName || '',
    }));
  }, [ownerEmail, ownerName]);

  const toggleModule = (module: string) => {
    setForm((prev) => {
      const exists = prev.selectedModules.includes(module);
      if (exists) {
        return {
          ...prev,
          selectedModules: prev.selectedModules.filter((item) => item !== module),
        };
      }

      return {
        ...prev,
        selectedModules: [...prev.selectedModules, module],
      };
    });
  };

  const handleSubmitRequest = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitMessage(null);

    if (!canSubmitRequest) {
      const message = 'You already have an active trial request under review.';
      setError(message);
      showToast(message, 'error');
      return;
    }

    if (form.selectedModules.length === 0) {
      const message = 'Select at least one module for your trial setup.';
      setError(message);
      showToast(message, 'error');
      return;
    }

    setSubmittingRequest(true);
    try {
      await api.post('/tenant-governance/client-registrations/me', {
        pawnshopName: form.pawnshopName,
        ownerName: form.ownerName,
        ownerEmail: form.ownerEmail,
        contactNumber: form.contactNumber || undefined,
        selectedModules: form.selectedModules,
        staffCount: Number(form.staffCount),
        notes: form.notes || undefined,
      });

      const successMessage = 'Trial request submitted. Our team will review it shortly.';
      setSubmitMessage(successMessage);
      showToast(successMessage, 'success');
      setForm((prev) => ({
        ...prev,
        pawnshopName: '',
        contactNumber: '',
        staffCount: 5,
        notes: '',
      }));
      await loadRequests();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Unable to submit trial request right now.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleCancelRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!latestRequest?.id || !canCancelRequest) {
      return;
    }

    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 10) {
      const message = 'Please provide at least 10 characters for the cancellation reason.';
      setError(message);
      showToast(message, 'error');
      return;
    }

    setShowCancelConfirm(true);
  };

  const confirmCancelRequest = async () => {
    if (!latestRequest?.id || !canCancelRequest) {
      setShowCancelConfirm(false);
      return;
    }

    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 10) {
      const message = 'Please provide at least 10 characters for the cancellation reason.';
      setError(message);
      showToast(message, 'error');
      setShowCancelConfirm(false);
      return;
    }

    setCancellingRequest(true);
    setError(null);
    setSubmitMessage(null);
    try {
      await api.post(`/tenant-governance/client-registrations/${latestRequest.id}/cancel`, {
        reason: trimmedReason,
      });

      setCancelReason('');
      const successMessage = 'Trial request cancelled successfully. You may submit a new request anytime.';
      setSubmitMessage(successMessage);
      showToast(successMessage, 'success');
      await loadRequests();
      setMessages([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Unable to cancel trial request right now.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setCancellingRequest(false);
      setShowCancelConfirm(false);
    }
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!latestRequest?.id || !draft.trim() || !canSendMessage) return;

    setSending(true);
    setError(null);
    try {
      await api.post(`/tenant-governance/client-registrations/${latestRequest.id}/messages`, {
        message: draft.trim(),
      });
      setDraft('');
      await loadMessages(latestRequest.id);
      showToast('Message sent.', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Unable to send your message right now.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#6B655C]">Pending Access Mode</p>
            <h2 className="mt-2 text-2xl font-black text-[#EAE2D6]">Your account is active with limited access</h2>
            <p className="mt-2 max-w-3xl text-sm text-[#999186]">
              You can follow your onboarding status and chat with support while your trial request is being reviewed.
            </p>
            {ownerEmail ? (
              <p className="mt-2 text-xs text-[#6B655C]">Owner: {ownerEmail}</p>
            ) : null}
            {registrationStatus ? (
              <p className="mt-1 text-xs text-[#6B655C]">Current status: {registrationStatus}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={loadRequests}
            className="inline-flex items-center gap-2 rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#6B655C] hover:bg-[#1C1C26]"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
          <h3 className="text-lg font-bold text-[#EAE2D6]">Start Your Free Trial Setup</h3>
          <p className="mt-1 text-sm text-[#999186]">
            Complete this once. The selected modules below become your initial system configuration after approval.
          </p>

          <form onSubmit={handleSubmitRequest} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.pawnshopName}
                onChange={(e) => setForm((prev) => ({ ...prev, pawnshopName: e.target.value }))}
                placeholder="Pawnshop Name"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
                disabled={!canSubmitRequest}
              />
              <input
                value={form.ownerName}
                onChange={(e) => setForm((prev) => ({ ...prev, ownerName: e.target.value }))}
                placeholder="Owner / Admin Name"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
                disabled={!canSubmitRequest}
              />
              <input
                value={form.ownerEmail}
                onChange={(e) => setForm((prev) => ({ ...prev, ownerEmail: e.target.value }))}
                placeholder="Owner Email"
                type="email"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
                readOnly={Boolean(ownerEmail)}
                disabled={!canSubmitRequest}
              />
              <input
                value={form.contactNumber}
                onChange={(e) => setForm((prev) => ({ ...prev, contactNumber: e.target.value }))}
                placeholder="Contact Number"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                disabled={!canSubmitRequest}
              />
              <input
                value={form.staffCount}
                onChange={(e) => setForm((prev) => ({ ...prev, staffCount: Number(e.target.value || 1) }))}
                placeholder="Initial Staff Count"
                type="number"
                min={1}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                required
                disabled={!canSubmitRequest}
              />
              <div className="rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] px-3 py-2 text-xs font-semibold text-[#999186]">
                Selected modules: {form.selectedModules.length}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-bold text-[#EAE2D6]">Modules to activate</p>
              <div className="grid gap-2 md:grid-cols-2">
                {TRIAL_MODULE_OPTIONS.map((module) => {
                  const checked = form.selectedModules.includes(module);
                  return (
                    <label
                      key={module}
                      className="flex items-center gap-2 rounded-lg border border-[rgba(201,160,92,0.12)] bg-[#14141B] px-3 py-2 text-sm text-[#6B655C]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleModule(module)}
                        disabled={!canSubmitRequest}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span>{module}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional note (target go-live date, requirements, etc.)"
              className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              disabled={!canSubmitRequest}
            />

            {!canSubmitRequest ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                You already have an active request. Wait for admin review or continue chatting with support.
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submittingRequest || !canSubmitRequest}
              className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {submittingRequest ? 'Submitting...' : 'Submit Trial Request'}
            </button>
          </form>

          {canCancelRequest ? (
            <form onSubmit={handleCancelRequest} className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-bold text-rose-800">Cancel current trial request</p>
              <p className="mt-1 text-xs text-rose-700">
                Tell us why you are cancelling so we can improve onboarding support.
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Cancellation reason (minimum 10 characters)"
                className="mt-2 min-h-20 w-full rounded-lg border border-rose-200 bg-[#14141B] px-3 py-2 text-sm"
                required
              />
              <button
                type="submit"
                disabled={cancellingRequest || cancelReason.trim().length < 10}
                className="mt-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50"
              >
                {cancellingRequest ? 'Cancelling...' : 'Cancel Trial Request'}
              </button>
            </form>
          ) : null}
        </article>

        <div className="space-y-6">
          <article className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-[#6B655C]" />
            <h3 className="text-lg font-bold text-[#EAE2D6]">Application Status</h3>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-[#6B655C]">Loading your onboarding request...</p>
          ) : !latestRequest ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              No registration request found yet. Start from the landing page to submit your free trial request.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusTone(latestRequest.status)}`}>
                {latestRequest.status}
              </div>
              <p className="text-sm text-[#6B655C]">Business: <span className="font-semibold">{latestRequest.pawnshop_name}</span></p>
              <p className="text-sm text-[#6B655C]">Submitted: {new Date(latestRequest.created_at).toLocaleString()}</p>
              <p className="text-sm text-[#6B655C]">Last update: {new Date(latestRequest.updated_at).toLocaleString()}</p>
              {latestRequest.notes ? (
                <div className="rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] p-3 text-sm text-[#6B655C] whitespace-pre-wrap">
                  {latestRequest.notes}
                </div>
              ) : null}
            </div>
          )}
          </article>

          <article className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-[#6B655C]" />
            <h3 className="text-lg font-bold text-[#EAE2D6]">Onboarding Chat</h3>
          </div>

          <div className="mt-4 h-64 space-y-2 overflow-y-auto rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] p-3">
            {loadingMessages ? (
              <p className="text-sm text-[#6B655C]">Loading messages...</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-[#6B655C]">No messages yet. Ask us anything about setup and activation.</p>
            ) : (
              messages.map((message) => {
                const isOwner = message.sender_type === 'OWNER';
                const senderLabel =
                  message.sender_type === 'SYSTEM'
                    ? 'System'
                    : message.sender_type === 'SUPER_ADMIN'
                      ? 'Support Team'
                      : 'You';

                return (
                  <div
                    key={message.id}
                    className={`rounded-xl px-3 py-2 text-sm ${isOwner ? 'ml-8 bg-[#C9A05C]/15 text-[#C9A05C]' : 'mr-8 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-slate-800'}`}
                  >
                    <p className="text-[11px] font-black uppercase tracking-wider opacity-70">{senderLabel}</p>
                    <p className="mt-1 whitespace-pre-wrap">{message.message}</p>
                    <p className="mt-1 text-[10px] opacity-60">{new Date(message.created_at).toLocaleString()}</p>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={handleSend} className="mt-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={canSendMessage ? 'Type your message to support' : 'Messaging is unavailable for this status'}
              disabled={!canSendMessage}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-[#1C1C26]"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim() || !canSendMessage}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {sending ? 'Sending' : 'Send'}
            </button>
          </form>
          </article>
        </div>
      </div>

      {showCancelConfirm ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0f172acc] p-4">
          <div className="w-full max-w-md rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-5 shadow-2xl">
            <h4 className="text-lg font-black text-[#EAE2D6]">Confirm cancellation</h4>
            <p className="mt-2 text-sm text-[#999186]">
              This will cancel your current trial request and stop admin review for now. You can submit a new request later.
            </p>
            <div className="mt-4 rounded-lg border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] px-3 py-2 text-sm text-[#6B655C]">
              Reason: {cancelReason.trim()}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancellingRequest}
                className="rounded-lg border border-[rgba(201,160,92,0.12)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#6B655C]"
              >
                Keep Request
              </button>
              <button
                type="button"
                onClick={confirmCancelRequest}
                disabled={cancellingRequest}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50"
              >
                {cancellingRequest ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default PendingAccessDashboard;
