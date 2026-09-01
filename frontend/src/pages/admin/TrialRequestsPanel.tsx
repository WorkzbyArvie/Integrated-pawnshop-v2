import { FormEvent, useEffect, useState } from 'react';
import { Loader2, MessageSquare, RefreshCcw, Send, Upload, X } from 'lucide-react';
import api from '../../lib/apiClient';
import { getSignedKycDocUrl } from '../../lib/kycDocs';
import { canApproveDocument } from '../../lib/onboardingStatus';
import { useToast } from '../../App';

type RequestStatus = 'PENDING' | 'CONTACTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ALL';

type TrialRequest = {
  id: string;
  pawnshop_name: string;
  owner_name: string;
  owner_email: string;
  contact_number?: string | null;
  selected_modules?: string[] | null;
  staff_count?: number | null;
  notes?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type TrialMessage = {
  id: string;
  sender_type: 'OWNER' | 'SUPER_ADMIN' | 'SYSTEM' | string;
  sender_name?: string | null;
  sender_email?: string | null;
  message: string;
  created_at: string;
};

type RegDocument = {
  id: string;
  document_type: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  status: string;
  rejection_reason: string | null;
  has_viewed?: boolean | null;
  created_at: string;
};

const STATUS_OPTIONS: RequestStatus[] = ['ALL', 'PENDING', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED'];

const REQUIRED_DOC_COUNT = 7;

const toneByStatus = (status: string) => {
  const normalized = (status || '').toUpperCase();
  if (normalized === 'APPROVED') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (normalized === 'CANCELLED') return 'text-[#8A8279] bg-[#1C1C26] border-slate-300';
  if (normalized === 'REJECTED') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (normalized === 'CONTACTED') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-[#C9A05C] bg-[#C9A05C]/10 border-[rgba(201,160,92,0.2)]';
};

export function TrialRequestsPanel() {
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<RequestStatus>('ALL');
  const [requests, setRequests] = useState<TrialRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messages, setMessages] = useState<TrialMessage[]>([]);
  const [adminNote, setAdminNote] = useState('');
  const [, setError] = useState<string | null>(null);
  const [, setSuccess] = useState<string | null>(null);
  const [regDocs, setRegDocs] = useState<RegDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<RegDocument | null>(null);
  const [previewDocSignedUrl, setPreviewDocSignedUrl] = useState<string | null>(null);
  const [previewDocSignFailed, setPreviewDocSignFailed] = useState(false);
  const [viewedDocIds, setViewedDocIds] = useState<Set<string>>(new Set());

  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? requests[0] ?? null;
  const selectedStatus = String(selectedRequest?.status || '').toUpperCase();
  const canReviewDecision = selectedStatus === 'PENDING' || selectedStatus === 'CONTACTED';
  const verifiedDocCount = regDocs.filter((d) => d.status === 'VERIFIED').length;
  const allDocsApproved = regDocs.length >= REQUIRED_DOC_COUNT && regDocs.every((d) => d.status === 'VERIFIED');

  useEffect(() => {
    if (!previewDoc) {
      setPreviewDocSignedUrl(null);
      setPreviewDocSignFailed(false);
      return;
    }
    let cancelled = false;
    setPreviewDocSignedUrl(null);
    setPreviewDocSignFailed(false);
    getSignedKycDocUrl(previewDoc.file_url)
      .then((minted) => {
        if (!cancelled) setPreviewDocSignedUrl(minted);
      })
      .catch(() => {
        if (!cancelled) setPreviewDocSignFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [previewDoc]);

  const loadRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = statusFilter === 'ALL' ? undefined : statusFilter;
      const rows = await api.get<TrialRequest[]>('/tenant-governance/client-registrations',
        status ? { status } : undefined,
      );
      const nextRows = Array.isArray(rows) ? rows : [];
      setRequests(nextRows);
      setSelectedRequestId((prev) => {
        if (!prev) return nextRows[0]?.id ?? null;
        return nextRows.some((request) => request.id === prev)
          ? prev
          : (nextRows[0]?.id ?? null);
      });
    } catch (err: unknown) {
      setRequests([]);
      setSelectedRequestId(null);
      const message = err instanceof Error ? err.message : String(err) || 'Unable to load trial requests.';
      setError(message);
      showToast(message, 'error');
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
    setLoadingDocs(true);
    try {
      const res = await api.get<{ documents: RegDocument[] }>(`/tenant-governance/client-registrations/${requestId}/documents/admin`);
      setRegDocs(res?.documents || []);
    } catch {
      setRegDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  };

  const openPreviewAndMarkViewed = async (doc: RegDocument) => {
    setPreviewDoc(doc);
    const normalized = (doc.status ?? '').toUpperCase();
    if (normalized === 'VERIFIED' || normalized === 'REJECTED') return;
    try {
      await api.post(`/tenant-governance/client-registrations/${selectedRequest?.id}/documents/${doc.id}/view`);
      setViewedDocIds((prev) => new Set(prev).add(doc.id));
    } catch {
      showToast('Could not record document view. Approve stays locked.', 'error');
    }
  };

  const previewDocViewed = previewDoc
    ? canApproveDocument(previewDoc.status, previewDoc.has_viewed, viewedDocIds, previewDoc.id)
    : false;

  const handleReviewDocument = async (documentId: string, decision: 'APPROVED' | 'REJECTED') => {
    if (!selectedRequest?.id) return;
    setReviewingDocId(documentId);
    try {
      await api.post(`/tenant-governance/client-registrations/${selectedRequest.id}/documents/${documentId}/review`, {
        decision,
      });
      showToast(`Document ${decision.toLowerCase()}.`, 'success');
      await loadDocuments(selectedRequest.id);
      setPreviewDoc((prev) =>
        prev && prev.id === documentId
          ? { ...prev, status: decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED' }
          : prev,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Failed to review document.';
      showToast(message, 'error');
    } finally {
      setReviewingDocId(null);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedRequest?.id) {
      setMessages([]);
      setRegDocs([]);
      return;
    }
    loadMessages(selectedRequest.id);
    loadDocuments(selectedRequest.id);
  }, [selectedRequest?.id]);

  const handleDecision = async (decision: 'CONTACTED' | 'APPROVED' | 'REJECTED') => {
    if (!selectedRequest?.id) return;

    if (decision === 'APPROVED' && !allDocsApproved) {
      const message = 'Cannot approve until all regulatory documents are approved.';
      setError(message);
      showToast(message, 'error');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const note = adminNote.trim();
      await api.post(`/tenant-governance/client-registrations/${selectedRequest.id}/review`, {
        decision,
        notes: note.length > 0 ? note : undefined,
      });
      const successMessage = `Request marked as ${decision}.`;
      setSuccess(successMessage);
      showToast(successMessage, 'success');
      setAdminNote('');
      await loadRequests();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Unable to update trial request status.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRequest?.id || !messageDraft.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/tenant-governance/client-registrations/${selectedRequest.id}/messages`, {
        message: messageDraft.trim(),
      });
      setMessageDraft('');
      await loadMessages(selectedRequest.id);
      const successMessage = 'Message sent to owner.';
      setSuccess(successMessage);
      showToast(successMessage, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err) || 'Unable to send message.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6 p-8">
      <header className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#C9A05C]">Onboarding Queue</p>
            <h2 className="mt-1 text-2xl font-black text-[#F5F0E8]">Trial Requests</h2>
            <p className="mt-1 text-sm text-[#B8B0A4]">Review, approve, reject, and message owners from one workspace.</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RequestStatus)}
              className="rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#8A8279]"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadRequests}
              className="inline-flex items-center gap-2 rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#8A8279] hover:bg-[#1C1C26]"
            >
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <article className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
          <h3 className="text-lg font-bold text-[#F5F0E8]">Request Queue</h3>
          {loading ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-[#8A8279]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading requests...
            </div>
          ) : requests.length === 0 ? (
            <p className="mt-6 text-sm text-[#B8B0A4]">No requests found for the selected filter.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {requests.map((request) => {
                const active = selectedRequest?.id === request.id;
                return (
                  <li
                    key={request.id}
                    onClick={() => setSelectedRequestId(request.id)}
                    className={`rounded-2xl border px-4 py-3 ${active ? 'border-indigo-300 bg-[#C9A05C]/10/40' : 'border-[rgba(201,160,92,0.12)] bg-[#14141B]'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-[#F5F0E8]">{request.pawnshop_name}</p>
                        <p className="text-xs text-[#8A8279]">{request.owner_name} • {request.owner_email}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${toneByStatus(request.status)}`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[#8A8279]">
                      Submitted: {new Date(request.created_at).toLocaleString()}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="rounded-3xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] p-6 shadow-sm">
          <h3 className="text-lg font-bold text-[#F5F0E8]">Selected Request</h3>
          {!selectedRequest ? (
            <p className="mt-4 text-sm text-[#B8B0A4]">Select a request from the queue to manage it.</p>
          ) : (
            <>
              <div className="mt-4 space-y-2 rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] p-4 text-sm text-[#8A8279]">
                <p><span className="font-bold">Pawnshop:</span> {selectedRequest.pawnshop_name}</p>
                <p><span className="font-bold">Owner:</span> {selectedRequest.owner_name}</p>
                <p><span className="font-bold">Email:</span> {selectedRequest.owner_email}</p>
                <p><span className="font-bold">Contact:</span> {selectedRequest.contact_number || 'Not provided'}</p>
                <p><span className="font-bold">Staff Count:</span> {selectedRequest.staff_count ?? 'N/A'}</p>
              </div>

              <div className="mt-4 rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Upload className="h-4 w-4 text-[#8A8279]" />
                  <p className="text-sm font-bold text-[#F5F0E8]">Regulatory Documents</p>
                  {regDocs.length > 0 && (
                    <span className="rounded-full bg-[#C9A05C]/10 px-2 py-0.5 text-[10px] font-black text-[#C9A05C]">
                      {regDocs.filter((d) => d.status === 'VERIFIED').length}/{regDocs.length} verified
                    </span>
                  )}
                </div>

                {loadingDocs ? (
                  <div className="flex items-center gap-2 text-xs text-[#8A8279]">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading documents...
                  </div>
                ) : regDocs.length === 0 ? (
                  <p className="text-xs text-[#8A8279]">No documents uploaded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {regDocs.map((doc) => {
                      const statusColor = doc.status === 'VERIFIED'
                        ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                        : doc.status === 'REJECTED'
                          ? 'text-rose-600 bg-rose-50 border-rose-200'
                          : 'text-amber-600 bg-amber-50 border-amber-200';
                      const canReview = doc.status !== 'VERIFIED' && doc.status !== 'REJECTED';

                      return (
                        <div key={doc.id} className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(201,160,92,0.08)] bg-[#14141B] px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[#F5F0E8] truncate">{doc.document_type.replace(/_/g, ' ')}</p>
                            <p className="text-[10px] text-[#8A8279] truncate">{doc.file_name}</p>
                            {doc.rejection_reason && (
                              <p className="mt-0.5 text-[10px] text-rose-400">{doc.rejection_reason}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${statusColor}`}>
                              {doc.status}
                            </span>
                            {doc.file_url && (
                              <button
                                type="button"
                                onClick={() => openPreviewAndMarkViewed(doc)}
                                className="rounded-lg border border-[rgba(201,160,92,0.2)] bg-[#C9A05C]/10 px-2 py-1 text-[9px] font-black uppercase text-[#C9A05C] hover:bg-[#C9A05C] hover:text-white"
                              >
                                {canReview ? 'View & Review' : 'View'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={3}
                placeholder="Optional review notes"
                className="mt-4 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm"
              />

              {canReviewDecision ? (
                <>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision('CONTACTED')}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-amber-700"
                    >
                      Mark Contacted
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !allDocsApproved}
                      onClick={() => handleDecision('APPROVED')}
                      className={`rounded-xl border border-emerald-200 px-3 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-40 ${allDocsApproved ? 'bg-emerald-50 text-emerald-700' : 'bg-[#1C1C26] text-emerald-700/50'}`}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision('REJECTED')}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-rose-700"
                    >
                      Reject
                    </button>
                  </div>
                  {!allDocsApproved && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      Approve is locked until all {REQUIRED_DOC_COUNT} regulatory documents are approved.
                      ({verifiedDocCount}/{REQUIRED_DOC_COUNT} verified — even one rejected document blocks approval.)
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#8A8279]">
                  This request is finalized and cannot be changed.
                </p>
              )}

              <div className="mt-6 rounded-2xl border border-[rgba(201,160,92,0.12)] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[#8A8279]" />
                  <p className="text-sm font-bold text-[#F5F0E8]">Onboarding Conversation</p>
                </div>

                <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl bg-[#1C1C26] p-3">
                  {loadingMessages ? (
                    <p className="text-xs text-[#8A8279]">Loading messages...</p>
                  ) : messages.length === 0 ? (
                    <p className="text-xs text-[#8A8279]">No messages yet.</p>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className="rounded-lg border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] p-2 text-xs text-[#D8D0C4]">
                        <p className="font-bold text-[#F5F0E8]">
                          {message.sender_name || message.sender_type}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{message.message}</p>
                        <p className="mt-1 text-[10px] text-[#8A8279]">{new Date(message.created_at).toLocaleString()}</p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
                  <input
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    placeholder="Send an update to owner"
                    className="flex-1 rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={submitting || !messageDraft.trim()}
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50"
                  >
                    <Send className="h-3 w-3" /> Send
                  </button>
                </form>
              </div>
            </>
          )}
        </article>
      </div>

      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-2xl border border-[rgba(201,160,92,0.2)] bg-[#14141B] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-none items-center justify-between border-b border-[rgba(201,160,92,0.12)] px-6 py-3">
              <div>
                <p className="text-sm font-bold text-[#F5F0E8]">{previewDoc.document_type.replace(/_/g, ' ')}</p>
                <p className="text-xs text-[#8A8279]">{previewDoc.file_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="rounded-lg border border-[rgba(201,160,92,0.12)] p-1.5 text-[#8A8279] hover:bg-[#1C1C26] hover:text-[#F5F0E8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex min-h-full items-center justify-center">
              {previewDocSignFailed ? (
                <p className="text-sm text-[#8A8279]">Document unavailable</p>
              ) : !previewDocSignedUrl ? (
                <Loader2 className="h-8 w-8 animate-spin text-[#C9A05C]" />
              ) : /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i.test(previewDoc.file_url) ? (
                <img
                  src={previewDocSignedUrl}
                  alt={previewDoc.file_name}
                  className="max-h-[78vh] max-w-full rounded-lg object-contain"
                />
              ) : previewDoc.file_url.includes('.pdf') || previewDoc.file_url.includes('pdf') ? (
                <iframe
                  src={previewDocSignedUrl}
                  title={previewDoc.file_name}
                  className="h-[78vh] w-[70vw] rounded-lg border border-[rgba(201,160,92,0.12)]"
                />
              ) : (
                <div className="text-center">
                  <p className="text-sm text-[#8A8279]">Preview not available for this file type.</p>
                  <a
                    href={previewDocSignedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block rounded-xl bg-[#C9A05C] px-4 py-2 text-xs font-black uppercase text-white hover:bg-[#b8913f]"
                  >
                    Open in New Tab
                  </a>
                </div>
              )}
              </div>
            </div>
            <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-[rgba(201,160,92,0.12)] px-6 py-3">
              <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${previewDoc.status === 'VERIFIED'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : previewDoc.status === 'REJECTED'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'}`}
              >
                {previewDoc.status === 'VERIFIED' ? 'Verified' : previewDoc.status === 'REJECTED' ? 'Rejected' : 'Under Review'}
              </span>
              {previewDoc.status !== 'VERIFIED' && previewDoc.status !== 'REJECTED' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={reviewingDocId === previewDoc.id || !previewDocViewed}
                    onClick={() => handleReviewDocument(previewDoc.id, 'APPROVED')}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {reviewingDocId === previewDoc.id ? '...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingDocId === previewDoc.id}
                    onClick={() => handleReviewDocument(previewDoc.id, 'REJECTED')}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {reviewingDocId === previewDoc.id ? '...' : 'Reject'}
                  </button>
                  {!previewDocViewed && (
                    <span className="text-[10px] font-semibold text-[#8A8279]">
                      Open and view the document to unlock Approve.
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
