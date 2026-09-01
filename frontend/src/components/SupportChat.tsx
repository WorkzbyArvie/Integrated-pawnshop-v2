import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquareText, PlusCircle, SendHorizonal } from 'lucide-react';
import api from '../lib/apiClient';
import { useToast } from '../App';

type Conversation = {
  id: string;
  pawnshop_id: string;
  pawnshop_name?: string;
  subject: string;
  status: 'OPEN' | 'HANDLING' | 'FIXING' | 'DONE' | 'CLOSED';
  last_message_at: string;
  last_message?: string | null;
};

type ChatMessage = {
  id: string;
  sender_id: string;
  sender_role: 'TENANT' | 'PLATFORM';
  message: string;
  created_at: string;
};

interface SupportChatProps {
  pawnshopId: string | null;
  userRole: string;
}

export function SupportChat({ pawnshopId, userRole }: SupportChatProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [subjectDraft, setSubjectDraft] = useState('');
  const [initialDraft, setInitialDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [superFilterPawnshopName, setSuperFilterPawnshopName] = useState('');
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const normalizedRole = useMemo(
    () => (userRole || '').toUpperCase().replace(/[_\s]/g, ''),
    [userRole],
  );

  const isSuperAdmin = normalizedRole === 'SUPERADMIN';
  const canManageTicketStatus = isSuperAdmin || ['OWNER', 'ADMIN'].includes(normalizedRole);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const queryPawnshopId = isSuperAdmin ? undefined : (pawnshopId || undefined);
      const queryPawnshopName = isSuperAdmin ? (superFilterPawnshopName.trim() || undefined) : undefined;
      const data = await api.get<{ conversations: Conversation[] }>(
        '/tenant-governance/support-chat/conversations',
        {
          pawnshopId: queryPawnshopId,
          pawnshopName: queryPawnshopName,
        },
      );
      setConversations(data.conversations || []);

      if (!activeConversationId && data.conversations?.length) {
        setActiveConversationId(data.conversations[0].id);
      }
    } catch (error: any) {
      showToast(error?.message || 'Failed to load support conversations', 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateConversationStatus = async (
    conversationId: string,
    status: Conversation['status'],
  ) => {
    setUpdatingStatusId(conversationId);
    try {
      await api.patch(`/tenant-governance/support-chat/conversations/${conversationId}/status`, { status });
      await fetchConversations();
      showToast(`Ticket marked as ${status}.`, 'success');
    } catch (error: any) {
      showToast(error?.message || 'Failed to update ticket status', 'error');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const fetchMessages = async (conversationId: string) => {
    try {
      const data = await api.get<{ messages: ChatMessage[] }>(
        `/tenant-governance/support-chat/conversations/${conversationId}/messages`,
      );
      setMessages(data.messages || []);
    } catch (error: any) {
      showToast(error?.message || 'Failed to load messages', 'error');
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [pawnshopId, userRole]);

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId]);

  const handleCreateConversation = async (e: FormEvent) => {
    e.preventDefault();
    if (isSuperAdmin) {
      showToast('Super admin cannot create inquiry tickets. Reply to existing tickets instead.', 'error');
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<{ conversation: Conversation }>(
        '/tenant-governance/support-chat/conversations',
        {
          pawnshopId: pawnshopId,
          subject: subjectDraft,
          initialMessage: initialDraft,
        },
      );
      setSubjectDraft('');
      setInitialDraft('');
      showToast('Conversation created', 'success');
      await fetchConversations();
      if (created?.conversation?.id) {
        setActiveConversationId(created.conversation.id);
      }
    } catch (error: any) {
      showToast(error?.message || 'Failed to create conversation', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeConversationId || !messageDraft.trim()) return;
    setSending(true);
    try {
      await api.post(`/tenant-governance/support-chat/conversations/${activeConversationId}/messages`, {
        message: messageDraft.trim(),
      });
      setMessageDraft('');
      await fetchMessages(activeConversationId);
      await fetchConversations();
    } catch (error: any) {
      showToast(error?.message || 'Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  };

  const groupedConversations = useMemo(() => {
    if (!isSuperAdmin) {
      return [{ pawnshopName: null as string | null, items: conversations }];
    }

    const groups = new Map<string, Conversation[]>();
    conversations.forEach((c) => {
      const key = c.pawnshop_name || c.pawnshop_id || 'Unassigned Pawnshop';
      const bucket = groups.get(key) || [];
      bucket.push(c);
      groups.set(key, bucket);
    });

    return Array.from(groups.entries()).map(([pawnshopName, items]) => ({ pawnshopName, items }));
  }, [conversations, isSuperAdmin]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-left">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-black uppercase tracking-tight text-[#F5F0E8] flex items-center gap-2">
          <MessageSquareText className="w-6 h-6 text-[#C9A05C]" />
          Support Chat
        </h2>
        {isSuperAdmin && (
          <div className="flex items-center gap-2">
            <input
              value={superFilterPawnshopName}
              onChange={(e) => setSuperFilterPawnshopName(e.target.value)}
              placeholder="Search pawnshop name"
              className="px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-xl text-xs w-64"
            />
            <button
              onClick={() => {
                fetchConversations();
              }}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase"
            >
              Load
            </button>
          </div>
        )}
      </div>
      {!isSuperAdmin && (
        <form onSubmit={handleCreateConversation} className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-[#8A8279] uppercase tracking-wider">
            <PlusCircle className="w-4 h-4 text-[#C9A05C]" />
            New Inquiry
          </div>
          <input
            value={subjectDraft}
            onChange={(e) => setSubjectDraft(e.target.value)}
            placeholder="Subject"
            className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-xl text-sm"
            required
          />
          <textarea
            value={initialDraft}
            onChange={(e) => setInitialDraft(e.target.value)}
            placeholder="Describe your question or concern"
            className="w-full min-h-24 px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-xl text-sm"
            required
          />
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create conversation'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-10 flex justify-center">
          <Loader2 className="w-7 h-7 text-[#C9A05C] animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-3 space-y-3 max-h-[560px] overflow-y-auto">
            {groupedConversations.map((group) => (
              <div key={group.pawnshopName || 'default'} className="space-y-2">
                {isSuperAdmin && group.pawnshopName && (
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#8A8279] px-1">
                    {group.pawnshopName}
                  </p>
                )}
                {group.items.map((c) => (
                  <div
                    key={c.id}
                    className={`w-full text-left p-3 rounded-2xl border transition-colors ${
                      c.id === activeConversationId
                        ? 'border-blue-500 bg-[#C9A05C]/10'
                        : 'border-[rgba(201,160,92,0.12)] bg-[#14141B] hover:bg-[#1C1C26]'
                    }`}
                  >
                    <button
                      onClick={() => setActiveConversationId(c.id)}
                      className="w-full text-left"
                    >
                      <p className="text-xs font-black uppercase tracking-wider text-[#8A8279]">{c.status}</p>
                      <p className="text-sm font-bold text-[#F5F0E8] mt-1">{c.subject}</p>
                      {c.last_message && (
                        <p className="text-xs text-[#8A8279] mt-2 line-clamp-2">{c.last_message}</p>
                      )}
                    </button>

                    {canManageTicketStatus && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(['HANDLING', 'FIXING', 'DONE'] as Conversation['status'][]).map((status) => (
                          <button
                            key={status}
                            onClick={() => updateConversationStatus(c.id, status)}
                            disabled={updatingStatusId === c.id}
                            className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                              c.status === status
                                ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                                : 'bg-[#14141B] border-[rgba(201,160,92,0.12)] text-[#B8B0A4] hover:bg-[#1C1C26]'
                            } disabled:opacity-50`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-[#8A8279] text-center py-8">No inquiries yet.</p>
            )}
          </div>

          <div className="bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-3xl p-4 flex flex-col h-[560px]">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {messages.map((m) => {
                const isPlatform = m.sender_role === 'PLATFORM';
                return (
                  <div key={m.id} className={`flex ${isPlatform ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm ${
                        isPlatform
                          ? 'bg-slate-900 text-white rounded-tl-md'
                          : 'bg-blue-600 text-white rounded-tr-md'
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider opacity-75 mb-1">{m.sender_role}</p>
                      <p>{m.message}</p>
                    </div>
                  </div>
                );
              })}
              {activeConversationId && messages.length === 0 && (
                <p className="text-xs text-[#8A8279] text-center py-8">No messages yet.</p>
              )}
              {!activeConversationId && (
                <p className="text-xs text-[#8A8279] text-center py-8">Select a conversation to start chatting.</p>
              )}
            </div>

            <form onSubmit={handleSend} className="pt-3 mt-3 border-t border-[rgba(201,160,92,0.08)] flex gap-2">
              <input
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="Type your message"
                className="flex-1 px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-xl text-sm"
                disabled={!activeConversationId || sending}
              />
              <button
                type="submit"
                disabled={!activeConversationId || sending || !messageDraft.trim()}
                className="px-3 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
