/**
 * ComplianceDashboard â€“ Auction winner compliance workflow.
 *
 * State Machine: PENDING_COMPLIANCE â†’ COMPLIED â†’ READY_FOR_RELEASE â†’ RELEASED
 *                           â†˜ EXPIRED
 *
 * Features:
 *   - Compliance records table with status filter
 *   - Statistics overview (counts per status, avg compliance hours)
 *   - Status transition actions (Submit â†’ Verify â†’ Release)
 *   - Deadline extension
 *   - Privacy audit log
 */

import { useState, useCallback } from 'react';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  Package,
  AlertTriangle,
  RefreshCw,
  Filter,
  Loader2,
  BarChart3,
  Timer,
  Eye,
  CalendarPlus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Swal from 'sweetalert2';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatCurrency, formatDateTime, formatDate, statusColor, humanizeStatus } from '@/lib/formatters';
import type { AuctionWinnerCompliance, ComplianceStatistics, ComplianceStatus } from '@/lib/types';
import { useToast } from '../App';

const COMPLIANCE_STATUSES: ComplianceStatus[] = [
  'PENDING_COMPLIANCE', 'COMPLIED', 'READY_FOR_RELEASE', 'RELEASED', 'EXPIRED',
];

interface ComplianceDashboardProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

export function ComplianceDashboard({ branchId: _branchId, activeBranchId }: ComplianceDashboardProps) {
  const { showToast } = useToast();
  const normalizedBranchId =
    Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
      ? Number(activeBranchId)
      : undefined;

  // â”€â”€ State â”€â”€
  const [statusFilter, setStatusFilter] = useState<ComplianceStatus | ''>('');
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedCompliance, setSelectedCompliance] = useState<AuctionWinnerCompliance | null>(null);

  // Release form
  const [releaseForm, setReleaseForm] = useState({
    releasedBy: '',
    releaseNotes: '',
  });

  // Extend form
  const [extendHours, setExtendHours] = useState('24');

  // â”€â”€ Data â”€â”€
  const compQuery: Record<string, string | number | boolean | undefined> = {};
  if (statusFilter) compQuery.status = statusFilter;
  if (Number.isFinite(normalizedBranchId)) compQuery.branchId = normalizedBranchId;

  const {
    data: compliances,
    loading,
    error,
    refetch: refetchCompliances,
  } = useApi<AuctionWinnerCompliance[]>('/compliance', compQuery, [statusFilter, normalizedBranchId]);

  const statsQuery: Record<string, string | number | boolean | undefined> = {};
  if (Number.isFinite(normalizedBranchId)) statsQuery.branchId = normalizedBranchId;

  const {
    data: stats,
    refetch: refetchStats,
  } = useApi<ComplianceStatistics>('/compliance/statistics', statsQuery, [normalizedBranchId]);

  const complianceList: AuctionWinnerCompliance[] = Array.isArray(compliances) ? compliances : [];

  const refetchAll = useCallback(() => {
    refetchCompliances();
    refetchStats();
  }, [refetchCompliances, refetchStats]);

  // â”€â”€ Handlers â”€â”€
  const handleVerifySubmit = async () => {
    if (!selectedCompliance) return;
    try {
      await api.post(`/compliance/${selectedCompliance.id}/verify`, {
        verifiedBy: localStorage.getItem('user_id') || 'admin',
      });
      showToast('Compliance verified â€” ready for release', 'success');
      setShowVerifyDialog(false);
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleRelease = async () => {
    if (!selectedCompliance) return;
    if (!releaseForm.releasedBy) {
      showToast('Released by is required', 'error');
      return;
    }
    try {
      await api.post(`/compliance/${selectedCompliance.id}/release`, releaseForm);
      showToast('Item released to winner', 'success');
      setShowReleaseDialog(false);
      setReleaseForm({ releasedBy: '', releaseNotes: '' });
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleExtend = async () => {
    if (!selectedCompliance) return;
    try {
      await api.patch(`/compliance/${selectedCompliance.id}/extend-deadline`, {
        additionalHours: parseInt(extendHours),
      });
      showToast(`Deadline extended by ${extendHours} hours`, 'success');
      setShowExtendDialog(false);
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleOfferNextBidder = async (compliance: AuctionWinnerCompliance) => {
    const result = await Swal.fire({
      icon: 'question',
      title: 'Offer To Next Bidder?',
      text: 'This will replace the current winner in compliance.',
      showCancelButton: true,
      confirmButtonText: 'Yes, offer next',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#2563eb',
    });
    if (!result.isConfirmed) return;

    try {
      await api.post(`/compliance/${compliance.id}/offer-next`, {
        promotedBy: localStorage.getItem('user_id') || 'admin',
      });
      await Swal.fire({
        icon: 'success',
        title: 'Updated',
        text: 'Next highest bidder has been moved to compliance.',
        timer: 1800,
        showConfirmButton: false,
      });
      refetchAll();
    } catch (err: unknown) {
      await Swal.fire({
        icon: 'error',
        title: 'Offer Failed',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const openAction = (compliance: AuctionWinnerCompliance, action: 'verify' | 'release' | 'extend' | 'detail') => {
    setSelectedCompliance(compliance);
    switch (action) {
      case 'verify': setShowVerifyDialog(true); break;
      case 'release': setShowReleaseDialog(true); break;
      case 'extend': setShowExtendDialog(true); break;
      case 'detail': setShowDetailDialog(true); break;
    }
  };

  const isDeadlineClose = (deadline: string) => {
    const diff = new Date(deadline).getTime() - Date.now();
    return diff > 0 && diff < 12 * 60 * 60 * 1000; // < 12 hours
  };

  const isExpired = (deadline: string) => {
    return new Date(deadline).getTime() < Date.now();
  };

  const getFallbackRound = (compliance: AuctionWinnerCompliance) => {
    const transfers = (compliance.accessLog || []).filter((entry) => {
      const marker = (entry.accessType || entry.action || '').toUpperCase();
      return marker.includes('NEXT_BIDDER');
    });

    return transfers.length + 1;
  };

  const getTransferHistory = (compliance: AuctionWinnerCompliance) => {
    return (compliance.accessLog || [])
      .filter((entry) => {
        const marker = (entry.accessType || entry.action || '').toUpperCase();
        return marker.includes('NEXT_BIDDER');
      })
      .map((entry) => ({
        at: entry.timestamp || entry.accessedAt,
        from: entry.previousWinnerId,
        to: entry.newWinnerId,
        by: entry.accessedBy || entry.userId || 'system',
      }));
  };

  const getWinnerName = (compliance: AuctionWinnerCompliance) => {
    return compliance.winnerFullName?.trim() || `Winner ${compliance.winnerId?.slice(0, 8) || ''}`;
  };

  const getWinnerPhone = (compliance: AuctionWinnerCompliance) => {
    return compliance.winnerPhone?.trim() || 'No phone available';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">Compliance Dashboard</h1>
          <p className="text-[#6B655C] mt-1">Auction winner compliance workflow & item release</p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#1C1C26] rounded-xl"><BarChart3 className="w-5 h-5 text-[#999186]" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.total}</p>
                  <p className="text-xs text-[#6B655C]">Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-xl"><Clock className="w-5 h-5 text-amber-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.pending}</p>
                  <p className="text-xs text-[#6B655C]">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-100 rounded-xl"><CheckCircle2 className="w-5 h-5 text-sky-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.complied}</p>
                  <p className="text-xs text-[#6B655C]">Complied</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#C9A05C]/15 rounded-xl"><Package className="w-5 h-5 text-[#C9A05C]" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.readyForRelease}</p>
                  <p className="text-xs text-[#6B655C]">Ready</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-xl"><ShieldCheck className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.released}</p>
                  <p className="text-xs text-[#6B655C]">Released</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-100 rounded-xl"><Timer className="w-5 h-5 text-violet-600" /></div>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{stats.averageComplianceHours?.toFixed(1) ?? 0}h</p>
                  <p className="text-xs text-[#6B655C]">Avg Time</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-[#6B655C]" />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ComplianceStatus | '')}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value=" ">All Statuses</SelectItem>
            {COMPLIANCE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{humanizeStatus(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Compliance Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#C9A05C]" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-12">
          <AlertTriangle className="w-5 h-5 text-rose-500 mr-2" />
          <span className="text-rose-600">{error}</span>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Compliance Records</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead>Contact #</TableHead>
                  <TableHead>Round</TableHead>
                  <TableHead>Winning Bid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Payment Ref</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complianceList.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.id?.slice(0, 8)}...</TableCell>
                    <TableCell>
                      <div className="leading-tight">
                        <p className="font-semibold text-[#EAE2D6]">{getWinnerName(c)}</p>
                        <p className="font-mono text-[10px] text-[#6B655C]">{c.winnerId?.slice(0, 8)}...</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{getWinnerPhone(c)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        #{getFallbackRound(c)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{formatCurrency(c.winningBidAmount)}</TableCell>
                    <TableCell>
                      <Badge className={statusColor(c.status)}>{humanizeStatus(c.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs ${isExpired(c.complianceDeadline) ? 'text-rose-600 font-bold' : isDeadlineClose(c.complianceDeadline) ? 'text-amber-600 font-medium' : ''}`}>
                        {formatDateTime(c.complianceDeadline)}
                        {isDeadlineClose(c.complianceDeadline) && !isExpired(c.complianceDeadline) && (
                          <AlertTriangle className="w-3 h-3 inline ml-1 text-amber-500" />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{c.paymentReference || 'â€”'}</TableCell>
                    <TableCell className="text-xs">{formatDate(c.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="text-xs" onClick={() => openAction(c, 'detail')}>
                          <Eye className="w-3 h-3" />
                        </Button>
                        {c.status === 'COMPLIED' && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => openAction(c, 'verify')}>
                            Verify
                          </Button>
                        )}
                        {c.status === 'READY_FOR_RELEASE' && (
                          <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => openAction(c, 'release')}>
                            Release
                          </Button>
                        )}
                        {c.status === 'PENDING_COMPLIANCE' && (
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => openAction(c, 'extend')}>
                            <CalendarPlus className="w-3 h-3" />
                          </Button>
                        )}
                        {(c.status === 'PENDING_COMPLIANCE' || c.status === 'EXPIRED') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => handleOfferNextBidder(c)}
                          >
                            Offer Next
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {complianceList.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-[#6B655C] py-8">No compliance records found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Verify Dialog */}
      <Dialog open={showVerifyDialog} onOpenChange={setShowVerifyDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Verify Compliance</DialogTitle>
            <DialogDescription>Confirm the winner has submitted valid payment proof.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {selectedCompliance?.paymentProofUrl && (
              <div>
                <p className="text-sm font-medium text-[#6B655C] mb-1">Payment Proof</p>
                <a href={selectedCompliance.paymentProofUrl} target="_blank" rel="noreferrer" className="text-[#C9A05C] text-sm underline">
                  View Document
                </a>
              </div>
            )}
            {selectedCompliance?.paymentReference && (
              <p className="text-sm"><span className="font-medium">Ref:</span> {selectedCompliance.paymentReference}</p>
            )}
            {selectedCompliance?.paidAmount != null && (
              <p className="text-sm"><span className="font-medium">Paid:</span> {formatCurrency(selectedCompliance.paidAmount)}</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleVerifySubmit}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Verify & Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Dialog */}
      <Dialog open={showReleaseDialog} onOpenChange={setShowReleaseDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Release Item</DialogTitle>
            <DialogDescription>Release the auctioned item to the winning bidder.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Released By *</label>
              <Input
                placeholder="Staff name or ID"
                value={releaseForm.releasedBy}
                onChange={(e) => setReleaseForm({ ...releaseForm, releasedBy: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Release Notes</label>
              <Input
                placeholder="Optional notes..."
                value={releaseForm.releaseNotes}
                onChange={(e) => setReleaseForm({ ...releaseForm, releaseNotes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleRelease}>
              <Package className="w-4 h-4 mr-2" /> Release Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Deadline Dialog */}
      <Dialog open={showExtendDialog} onOpenChange={setShowExtendDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Extend Deadline</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium text-[#6B655C]">Additional Hours</label>
            <Input
              type="number"
              min={1}
              max={168}
              value={extendHours}
              onChange={(e) => setExtendHours(e.target.value)}
            />
            {selectedCompliance && (
              <p className="text-xs text-[#6B655C] mt-2">
                Current deadline: {formatDateTime(selectedCompliance.complianceDeadline)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleExtend}>
              <CalendarPlus className="w-4 h-4 mr-2" /> Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Compliance Detail</DialogTitle>
          </DialogHeader>
          {selectedCompliance && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[#6B655C]">Status</p>
                  <Badge className={statusColor(selectedCompliance.status)}>{humanizeStatus(selectedCompliance.status)}</Badge>
                </div>
                <div>
                  <p className="text-[#6B655C]">Winning Bid</p>
                  <p className="font-bold">{formatCurrency(selectedCompliance.winningBidAmount)}</p>
                </div>
                <div>
                  <p className="text-[#6B655C]">Winner</p>
                  <p className="font-semibold text-[#EAE2D6]">{getWinnerName(selectedCompliance)}</p>
                  <p className="font-mono text-[10px] text-[#6B655C]">{selectedCompliance.winnerId}</p>
                </div>
                <div>
                  <p className="text-[#6B655C]">Winner Contact #</p>
                  <p className="font-semibold">{getWinnerPhone(selectedCompliance)}</p>
                </div>
                <div>
                  <p className="text-[#6B655C]">Fallback Round</p>
                  <p className="font-bold">#{getFallbackRound(selectedCompliance)}</p>
                </div>
                <div>
                  <p className="text-[#6B655C]">Deadline</p>
                  <p>{formatDateTime(selectedCompliance.complianceDeadline)}</p>
                </div>
                {selectedCompliance.verifiedBy && (
                  <div>
                    <p className="text-[#6B655C]">Verified By</p>
                    <p>{selectedCompliance.verifiedBy}</p>
                  </div>
                )}
                {selectedCompliance.releasedBy && (
                  <div>
                    <p className="text-[#6B655C]">Released By</p>
                    <p>{selectedCompliance.releasedBy}</p>
                  </div>
                )}
              </div>
              {selectedCompliance.accessLog && selectedCompliance.accessLog.length > 0 && (
                <div>
                  <h4 className="font-bold text-sm text-[#6B655C] mb-2 flex items-center gap-1">
                    <Eye className="w-4 h-4" /> Access Log
                  </h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {selectedCompliance.accessLog.map((log, i) => (
                      <div key={i} className="text-xs text-[#6B655C] flex justify-between bg-[#1C1C26] rounded px-2 py-1">
                        <span>{log.action || log.accessType || 'ACTIVITY'}</span>
                        <span>{formatDateTime(log.accessedAt || log.timestamp || selectedCompliance.updatedAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {getTransferHistory(selectedCompliance).length > 0 && (
                <div>
                  <h4 className="font-bold text-sm text-[#6B655C] mb-2">Winner Transfer History</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {getTransferHistory(selectedCompliance).map((item, idx) => (
                      <div key={`${item.from}-${item.to}-${idx}`} className="text-xs text-[#999186] bg-amber-50 border border-amber-100 rounded px-2 py-1 flex justify-between gap-2">
                        <span className="truncate">
                          {item.from?.slice(0, 8)}... {'->'} {item.to?.slice(0, 8)}... ({item.by})
                        </span>
                        <span>{item.at ? formatDateTime(item.at) : 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ComplianceDashboard;
