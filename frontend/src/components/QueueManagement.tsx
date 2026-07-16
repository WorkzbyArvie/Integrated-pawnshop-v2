/**
 * QueueManagement â€“ Real-time customer queue dashboard.
 *
 * Features:
 *   - Live queue board with status columns (Waiting â†’ Serving â†’ Completed)
 *   - Call next customer button
 *   - Create new queue ticket
 *   - Statistics panel
 *   - Filters by type and date
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Users,
  Plus,
  PhoneCall,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Filter,
  Hash,
  Loader2,
  MessageSquare,
  Send,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatTime, formatDateTime, statusColor, humanizeStatus } from '@/lib/formatters';
import type { QueueTicket, QueueStatistics, QueueType, QueueStatus } from '@/lib/types';
import { useToast } from '../App';

const QUEUE_TYPES: QueueType[] = ['PAWNING', 'RENEWAL', 'REDEMPTION', 'AUCTION_INQUIRY', 'GENERAL'];

interface QueueManagementProps {
  branchId: string | null;
}

export function QueueManagement({ branchId: _branchId }: QueueManagementProps) {
  const { showToast } = useToast();

  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [statusFilter, setStatusFilter] = useState<QueueStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<QueueType | ''>('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [callingNext, setCallingNext] = useState(false);

  // New ticket form
  const [newTicket, setNewTicket] = useState({
    customerId: '',
    queueType: 'PAWNING' as QueueType,
    notes: '',
    priority: 0,
  });

  // Chat state
  const [chatTicket, setChatTicket] = useState<QueueTicket | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openChat = (ticket: QueueTicket) => {
    setChatTicket(ticket);
    setChatMessages([]);
    setChatInput('');
    loadChatMessages(ticket.id);
  };

  const closeChat = () => {
    setChatTicket(null);
    if (chatPollRef.current) clearInterval(chatPollRef.current);
  };

  const loadChatMessages = async (ticketId: string) => {
    setChatLoading(true);
    try {
      const msgs = await api.get<any[]>(`/queue/tickets/${ticketId}/messages`);
      setChatMessages(Array.isArray(msgs) ? msgs : []);
    } catch { setChatMessages([]); }
    setChatLoading(false);
  };

  useEffect(() => {
    if (!chatTicket) return;
    const interval = setInterval(() => loadChatMessages(chatTicket.id), 4000);
    chatPollRef.current = interval;
    return () => clearInterval(interval);
  }, [chatTicket?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  const sendChatMessage = async () => {
    if (!chatTicket || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    try {
      await api.post(`/queue/tickets/${chatTicket.id}/messages`, {
        senderId: localStorage.getItem('user_id') || 'staff',
        message: text,
      });
      await loadChatMessages(chatTicket.id);
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to send message', 'error');
    }
  };

  // â”€â”€ Data Fetching â”€â”€
  const query: Record<string, string | number | boolean | undefined> = {
    limit: 200,
    offset: 0,
  };
  if (statusFilter) query.status = statusFilter;
  if (typeFilter) query.queueType = typeFilter;

  const {
    data: ticketsRaw,
    loading: ticketsLoading,
    error: ticketsError,
    refetch: refetchTickets,
  } = useApi<QueueTicket[] | { data: QueueTicket[] }>('/queue', query, [statusFilter, typeFilter]);

  const {
    data: stats,
    refetch: refetchStats,
  } = useApi<QueueStatistics>('/queue/statistics');

  const tickets: QueueTicket[] = Array.isArray(ticketsRaw)
    ? ticketsRaw
    : (ticketsRaw as any)?.data ?? [];

  const refetchAll = useCallback(() => {
    refetchTickets();
    refetchStats();
  }, [refetchTickets, refetchStats]);

  // â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€
  const handleCreateTicket = async () => {
    if (!newTicket.customerId.trim()) {
      showToast('Customer ID is required', 'error');
      return;
    }
    setCreating(true);
    try {
      await api.post('/queue', {
        customerId: newTicket.customerId,
        queueType: newTicket.queueType,
        notes: newTicket.notes || undefined,
        priority: newTicket.priority,
      });
      showToast('Queue ticket created successfully', 'success');
      setShowCreateDialog(false);
      setNewTicket({ customerId: '', queueType: 'PAWNING', notes: '', priority: 0 });
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to create ticket', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleCallNext = async () => {
    setCallingNext(true);
    try {
      const result = await api.post<QueueTicket>('/queue/call-next', {
        staffId: localStorage.getItem('user_id') || 'staff',
        counterNumber: '1',
      });
      showToast(`Now serving: ${(result as any)?.queueNumber || 'Next customer'}`, 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'No waiting tickets', 'error');
    } finally {
      setCallingNext(false);
    }
  };

  const handleUpdateStatus = async (ticketId: string, status: QueueStatus) => {
    try {
      await api.patch(`/queue/${ticketId}`, { status });
      showToast(`Ticket updated to ${humanizeStatus(status)}`, 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to update ticket', 'error');
    }
  };

  const handleCancel = async (ticketId: string) => {
    try {
      await api.post(`/queue/${ticketId}/cancel`);
      showToast('Ticket cancelled', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to cancel ticket', 'error');
    }
  };

  // â”€â”€ Categorized tickets â”€â”€
  const waiting = tickets.filter((t) => t.status === 'WAITING');
  const serving = tickets.filter((t) => t.status === 'SERVING');
  const completed = tickets.filter((t) => t.status === 'COMPLETED');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">Queue Management</h1>
          <p className="text-[#6B655C] mt-1">Real-time customer service queue</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button onClick={handleCallNext} disabled={callingNext} className="bg-emerald-600 hover:bg-emerald-700">
            {callingNext ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PhoneCall className="w-4 h-4 mr-2" />}
            Call Next
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Ticket
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#C9A05C]/15 rounded-xl"><Users className="w-5 h-5 text-[#C9A05C]" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.totalToday}</p>
                  <p className="text-xs text-[#6B655C]">Today Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-xl"><Clock className="w-5 h-5 text-amber-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.waiting}</p>
                  <p className="text-xs text-[#6B655C]">Waiting</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-100 rounded-xl"><PhoneCall className="w-5 h-5 text-sky-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.serving}</p>
                  <p className="text-xs text-[#6B655C]">Serving</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-xl"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.completed}</p>
                  <p className="text-xs text-[#6B655C]">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-100 rounded-xl"><XCircle className="w-5 h-5 text-rose-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.noShow + stats.cancelled}</p>
                  <p className="text-xs text-[#6B655C]">No Show / Cancel</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-100 rounded-xl"><Clock className="w-5 h-5 text-violet-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.averageWaitMinutes?.toFixed(0) ?? 0}m</p>
                  <p className="text-xs text-[#6B655C]">Avg Wait</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-[#6B655C]" />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as QueueStatus | '')}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value=" ">All Statuses</SelectItem>
            {(['WAITING', 'SERVING', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as QueueStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{humanizeStatus(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as QueueType | '')}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value=" ">All Types</SelectItem>
            {QUEUE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{humanizeStatus(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Queue Board */}
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Board View</TabsTrigger>
          <TabsTrigger value="table">Table View</TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            {/* Waiting column */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-bold text-amber-700 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Waiting
                  <Badge variant="secondary" className="ml-1">{waiting.length}</Badge>
                </h3>
              </div>
              {waiting.map((ticket) => (
                <Card key={ticket.id} className="border-l-4 border-l-amber-400 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-black text-lg text-[#EAE2D6]">{ticket.queueNumber}</span>
                      <Badge className={statusColor(ticket.status)}>{humanizeStatus(ticket.status)}</Badge>
                    </div>
                    <p className="text-xs text-[#6B655C] mb-1">
                      <Hash className="w-3 h-3 inline mr-1" />{humanizeStatus(ticket.queueType)}
                    </p>
                    <p className="text-xs text-[#6B655C]">Created: {formatTime(ticket.createdAt)}</p>
                    {ticket.estimatedWaitMinutes != null && (
                      <p className="text-xs text-[#6B655C] mt-1">Est. wait: ~{ticket.estimatedWaitMinutes}m</p>
                    )}
                    {ticket.notes && <p className="text-xs text-[#6B655C] mt-1 italic">{ticket.notes}</p>}
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-xs" onClick={() => handleUpdateStatus(ticket.id, 'SERVING')}>
                        Serve
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => openChat(ticket)}>
                        <MessageSquare className="w-3 h-3 mr-1" /> Chat
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs text-rose-600" onClick={() => handleCancel(ticket.id)}>
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {waiting.length === 0 && (
                <p className="text-sm text-[#6B655C] text-center py-8">No customers waiting</p>
              )}
            </div>

            {/* Serving column */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-bold text-sky-700 flex items-center gap-2">
                  <PhoneCall className="w-4 h-4" /> Serving
                  <Badge variant="secondary" className="ml-1">{serving.length}</Badge>
                </h3>
              </div>
              {serving.map((ticket) => (
                <Card key={ticket.id} className="border-l-4 border-l-sky-400 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-black text-lg text-[#EAE2D6]">{ticket.queueNumber}</span>
                      <Badge className={statusColor(ticket.status)}>{humanizeStatus(ticket.status)}</Badge>
                    </div>
                    <p className="text-xs text-[#6B655C] mb-1">
                      <Hash className="w-3 h-3 inline mr-1" />{humanizeStatus(ticket.queueType)}
                    </p>
                    {ticket.counterNumber && (
                      <p className="text-xs text-[#6B655C]">Counter: {ticket.counterNumber}</p>
                    )}
                    <p className="text-xs text-[#6B655C]">Serving since: {formatTime(ticket.servedAt)}</p>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-xs" onClick={() => handleUpdateStatus(ticket.id, 'COMPLETED')}>
                        Complete
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => openChat(ticket)}>
                        <MessageSquare className="w-3 h-3 mr-1" /> Chat
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs text-amber-600" onClick={() => handleUpdateStatus(ticket.id, 'NO_SHOW')}>
                        No Show
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {serving.length === 0 && (
                <p className="text-sm text-[#6B655C] text-center py-8">No customers being served</p>
              )}
            </div>

            {/* Completed column */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-bold text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Completed
                  <Badge variant="secondary" className="ml-1">{completed.length}</Badge>
                </h3>
              </div>
              {completed.slice(0, 20).map((ticket) => (
                <Card key={ticket.id} className="border-l-4 border-l-emerald-400 shadow-sm opacity-80">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold text-[#6B655C]">{ticket.queueNumber}</span>
                      <Badge className={statusColor(ticket.status)}>{humanizeStatus(ticket.status)}</Badge>
                    </div>
                    <p className="text-xs text-[#6B655C]">
                      <Hash className="w-3 h-3 inline mr-1" />{humanizeStatus(ticket.queueType)}
                    </p>
                    <p className="text-xs text-[#6B655C]">Done: {formatTime(ticket.completedAt)}</p>
                  </CardContent>
                </Card>
              ))}
              {completed.length === 0 && (
                <p className="text-sm text-[#6B655C] text-center py-8">No completed tickets today</p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="table">
          {ticketsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[#C9A05C]" />
            </div>
          ) : ticketsError ? (
            <div className="flex items-center justify-center py-12">
              <AlertTriangle className="w-5 h-5 text-rose-500 mr-2" />
              <span className="text-rose-600">{ticketsError}</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Counter</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Served</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-mono font-bold">{ticket.queueNumber}</TableCell>
                    <TableCell>{humanizeStatus(ticket.queueType)}</TableCell>
                    <TableCell>
                      <Badge className={statusColor(ticket.status)}>{humanizeStatus(ticket.status)}</Badge>
                    </TableCell>
                    <TableCell>{ticket.priority > 0 ? `P${ticket.priority}` : 'â€”'}</TableCell>
                    <TableCell>{ticket.counterNumber || 'â€”'}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(ticket.createdAt)}</TableCell>
                    <TableCell className="text-xs">{formatTime(ticket.servedAt)}</TableCell>
                    <TableCell className="text-xs">{formatTime(ticket.completedAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {ticket.status === 'WAITING' && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => handleUpdateStatus(ticket.id, 'SERVING')}>Serve</Button>
                        )}
                        {ticket.status === 'SERVING' && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => handleUpdateStatus(ticket.id, 'COMPLETED')}>Done</Button>
                        )}
                        {(ticket.status === 'WAITING') && (
                          <Button size="sm" variant="ghost" className="text-xs text-rose-600" onClick={() => handleCancel(ticket.id)}>Cancel</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {tickets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-[#6B655C] py-8">No tickets found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Ticket Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Queue Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Customer ID *</label>
              <Input
                placeholder="Enter customer UUID"
                value={newTicket.customerId}
                onChange={(e) => setNewTicket({ ...newTicket, customerId: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Service Type *</label>
              <Select value={newTicket.queueType} onValueChange={(v) => setNewTicket({ ...newTicket, queueType: v as QueueType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUEUE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{humanizeStatus(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Priority</label>
              <Input
                type="number"
                min={0}
                max={10}
                value={newTicket.priority}
                onChange={(e) => setNewTicket({ ...newTicket, priority: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-[#6B655C] mt-1">0 = normal priority, higher = served first</p>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Notes</label>
              <Input
                placeholder="Optional notes..."
                value={newTicket.notes}
                onChange={(e) => setNewTicket({ ...newTicket, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreateTicket} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Create Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chat Dialog */}
      <Dialog open={!!chatTicket} onOpenChange={(open) => { if (!open) closeChat(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Chat â€“ Ticket {chatTicket?.queueNumber}
              <Badge className={statusColor(chatTicket?.status || 'WAITING')}>{humanizeStatus(chatTicket?.status || 'WAITING')}</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="h-80 overflow-y-auto border rounded-lg bg-[#1C1C26] p-3 space-y-2">
            {chatLoading && chatMessages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-5 h-5 animate-spin text-[#6B655C]" />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[#6B655C] text-sm">
                <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
                No messages yet
              </div>
            ) : (
              chatMessages.map((msg, i) => {
                const isStaff = msg.senderRole === 'STAFF' || msg.sender_role === 'STAFF';
                const time = msg.createdAt || msg.created_at || '';
                let timeLabel = '';
                try {
                  const d = new Date(time);
                  timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } catch {}
                return (
                  <div key={msg.id || i} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                      isStaff
                        ? 'bg-[#C9A05C] text-white rounded-br-sm'
                        : 'bg-[#14141B] border border-[rgba(201,160,92,0.12)] text-slate-800 rounded-bl-sm'
                    }`}>
                      {!isStaff && <p className="text-[10px] font-semibold text-amber-600 mb-0.5">Customer</p>}
                      <p>{msg.message}</p>
                      <p className={`text-[10px] mt-1 ${isStaff ? 'text-[#E5C88C]' : 'text-[#6B655C]'}`}>{timeLabel}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-2 mt-2">
            <Input
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage(); }}
            />
            <Button onClick={sendChatMessage} disabled={!chatInput.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default QueueManagement;
