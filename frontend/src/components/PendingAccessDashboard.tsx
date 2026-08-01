import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Clock3, MessageSquare, RefreshCcw, Send, Upload, FileCheck, AlertCircle } from 'lucide-react';
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
  ownerEmail: string;
  contactNumber: string;
  notes: string;
};

type RegDocument = {
  id: string;
  document_type: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
};


const statusTone = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized === 'APPROVED') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (normalized === 'CANCELLED') return 'text-[#6B655C] bg-[#1C1C26] border-slate-300';
  if (normalized === 'REJECTED') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (normalized === 'CONTACTED') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-[#C9A05C] bg-[#C9A05C]/10 border-[rgba(201,160,92,0.2)]';
};

export function PendingAccessDashboard({ ownerEmail, registrationStatus }: PendingAccessDashboardProps) {
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
    ownerEmail: ownerEmail || '',
    contactNumber: '',
    notes: '',
  });
  const [regDocs, setRegDocs] = useState<RegDocument[]>([]);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);

  const REQUIRED_DOC_TYPES = [
    { type: 'DTI_REGISTRATION', label: 'DTI/SEC Registration', desc: 'Business name registration certificate' },
    { type: 'MAYORS_PERMIT', label: "Mayor's Permit", desc: 'Local business operating permit' },
    { type: 'BIR_COR', label: 'BIR Certificate of Registration', desc: 'Tax registration certificate' },
    { type: 'BSP_LICENSE', label: 'BSP License', desc: 'Bangko Sentral ng Pilipinas license to operate' },
    { type: 'AMLC_REGISTRATION', label: 'AMLC Registration', desc: 'Anti-Money Laundering Council registration' },
    { type: 'GOVERNMENT_ID', label: 'Valid Government ID', desc: 'Owner\u2019s valid government-issued ID' },
    { type: 'PROOF_OF_ADDRESS', label: 'Proof of Address', desc: 'Utility bill or lease contract' },
  ];

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

  const loadDocuments = async (requestId: string) => {
    try {
      const res = await api.get<{ documents: RegDocument[] }>(`/tenant-governance/client-registrations/${requestId}/documents`);
      setRegDocs(res?.documents || []);
    } catch {
      setRegDocs([]);
    }
  };

  const handleUploadDocument = async (docType: string, file: File) => {
    if (!latestRequest?.id) return;
    setUploadingDocType(docType);
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const safeExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const storagePath = `registration-docs/${latestRequest.id}/${docType}_${Date.now()}.${safeExt}`;

      const { supabase } = await import('../lib/supabaseClient');
      const { error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message || 'File upload to storage failed.');
      }

      const { data: urlData } = supabase.storage.from('kyc-documents').getPublicUrl(storagePath);
      const fileUrl = urlData?.publicUrl || storagePath;

      await api.post(`/tenant-governance/client-registrations/${latestRequest.id}/documents`, {
        documentType: docType,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
      });
      showToast(`${docType.replace(/_/g, ' ')} uploaded successfully.`, 'success');
      await loadDocuments(latestRequest.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Upload failed.';
      showToast(message, 'error');
    } finally {
      setUploadingDocType(null);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  useEffect(() => {
    if (!latestRequest?.id) {
      setMessages([]);
      setRegDocs([]);
      return;
    }

    loadMessages(latestRequest.id);
    loadDocuments(latestRequest.id);
  }, [latestRequest?.id]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      ownerEmail: prev.ownerEmail || ownerEmail || '',
    }));
  }, [ownerEmail]);


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

    setSubmittingRequest(true);
    try {
      await api.post('/tenant-governance/client-registrations/me', {
        pawnshopName: form.pawnshopName,
        ownerEmail: form.ownerEmail,
        contactNumber: form.contactNumber || undefined,
        notes: form.notes || undefined,
      });

      const successMessage = 'Trial request submitted. Our team will review it shortly.';
      setSubmitMessage(successMessage);
      showToast(successMessage, 'success');
      setForm((prev) => ({
        ...prev,
        pawnshopName: '',
        contactNumber: '',
        notes: '',
      }));
      await loadRequests();
      const updated = await api.get<TrialRequest[]>('/tenant-governance/client-registrations/me');
      const latest = Array.isArray(updated) ? updated[0] : null;
      if (latest?.id) await loadDocuments(latest.id);
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

          <form onSubmit={handleSubmitRequest} className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#999186]">
                  Pawnshop Name <span className="text-rose-400">*</span>
                </label>
                <input
                  value={form.pawnshopName}
                  onChange={(e) => setForm((prev) => ({ ...prev, pawnshopName: e.target.value }))}
                  placeholder="e.g. Golden Pawn jewelry shop"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  required
                  disabled={!canSubmitRequest}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#999186]">
                  Email Address <span className="text-rose-400">*</span>
                </label>
                <input
                  value={form.ownerEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, ownerEmail: e.target.value }))}
                  type="email"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  required
                  readOnly={Boolean(ownerEmail)}
                  disabled={!canSubmitRequest}
                />
                {ownerEmail && (
                  <p className="mt-1 text-[11px] text-[#6B655C]">Pre-filled from your account</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#999186]">
                  Contact Number
                </label>
                <input
                  value={form.contactNumber}
                  onChange={(e) => setForm((prev) => ({ ...prev, contactNumber: e.target.value }))}
                  placeholder="e.g. 09171234567"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  disabled={!canSubmitRequest}
                />
                <p className="mt-1 text-[11px] text-[#6B655C]">Phone or mobile number for SMS updates</p>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#999186]">
                Additional Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. Target go-live date, branch locations, special requirements..."
                className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                disabled={!canSubmitRequest}
              />
            </div>

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

          {hasActiveRequest && (
            <article className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-[#6B655C]" />
                <h3 className="text-lg font-bold text-[#EAE2D6]">Regulatory Documents</h3>
              </div>
              <p className="mt-1 text-xs text-[#6B655C]">
                Upload your business documents to speed up approval. All 7 documents are required before activation.
              </p>

              <div className="mt-4 space-y-3">
                {REQUIRED_DOC_TYPES.map((doc) => {
                  const existing = regDocs.find((d) => d.document_type === doc.type);
                  const isUploading = uploadingDocType === doc.type;
                  const statusColor = existing?.status === 'VERIFIED'
                    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                    : existing?.status === 'REJECTED'
                      ? 'text-rose-600 bg-rose-50 border-rose-200'
                      : existing
                        ? 'text-amber-600 bg-amber-50 border-amber-200'
                        : 'text-[#6B655C] bg-[#1C1C26] border-[rgba(201,160,92,0.12)]';

                  return (
                    <div key={doc.type} className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#EAE2D6] truncate">{doc.label}</p>
                        <p className="text-[11px] text-[#6B655C]">{doc.desc}</p>
                        {existing && (
                          <div className="mt-1 flex items-center gap-2">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${statusColor}`}>
                              {existing.status === 'VERIFIED' ? 'Verified' : existing.status === 'REJECTED' ? 'Rejected' : 'Under Review'}
                            </span>
                            <span className="text-[10px] text-[#6B655C] truncate">{existing.file_name}</span>
                          </div>
                        )}
                        {existing?.rejection_reason && (
                          <p className="mt-1 text-[10px] text-rose-400">{existing.rejection_reason}</p>
                        )}
                      </div>
                      <div>
                        {!existing || existing.status === 'REJECTED' ? (
                          <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest cursor-pointer transition-all ${isUploading ? 'bg-[#1C1C26] text-[#6B655C] cursor-wait' : 'bg-[#C9A05C]/10 text-[#C9A05C] hover:bg-[#C9A05C] hover:text-white'}`}>
                            {isUploading ? (
                              <>
                                <span className="animate-spin h-3 w-3 border-2 border-[#C9A05C] border-t-transparent rounded-full" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload size={12} /> Upload
                              </>
                            )}
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.jpg,.jpeg,.png"
                              disabled={isUploading}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadDocument(doc.type, file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        ) : existing.status === 'VERIFIED' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600">
                            <FileCheck size={12} /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-600">
                            <AlertCircle size={12} /> Pending
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center gap-2 text-[10px] text-[#6B655C]">
                <span className="font-bold">{regDocs.filter((d) => d.status === 'VERIFIED').length}/{REQUIRED_DOC_TYPES.length} documents verified</span>
                <div className="flex-1 h-1 bg-[#1C1C26] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#C9A05C] rounded-full transition-all"
                    style={{ width: `${(regDocs.filter((d) => d.status === 'VERIFIED').length / REQUIRED_DOC_TYPES.length) * 100}%` }}
                  />
                </div>
              </div>
            </article>
          )}

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
