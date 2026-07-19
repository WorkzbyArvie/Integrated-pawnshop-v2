/**
 * PayrollManagement -- Philippine-compliant payroll with tax & deductions.
 *
 * Features:
 *   - Payslip generation (individual + bulk)
 *   - TRAIN Law tax computation display
 *   - SSS, PhilHealth, Pag-IBIG deduction visibility
 *   - Payslip approval & payment workflow
 *   - Payroll period summary
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Wallet,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText,
  Calculator,
  Filter,
  Banknote,
  Printer,
  Settings,
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
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatCurrency, formatDate, statusColor, humanizeStatus } from '@/lib/formatters';
import type { Payslip, PayslipStatus, PayrollSummary } from '@/lib/types';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '../App';
import Swal from 'sweetalert2';

interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

interface PayrollManagementProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

export function PayrollManagement({ branchId: _branchId, activeBranchId }: PayrollManagementProps) {
  const { showToast } = useToast();
  const ALL_PAYROLL_STATUSES = '__ALL_PAYROLL_STATUSES__';
  const normalizedBranchId =
    Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
      ? Number(activeBranchId)
      : undefined;

  // â”€â”€ Staff list for dropdown â”€â”€
  const staffQuery: Record<string, string | number | boolean | undefined> = {};
  if (Number.isFinite(normalizedBranchId)) {
    staffQuery.branchId = normalizedBranchId;
  }
  const { data: staffListRaw } = useApi<StaffMember[]>('/attendance/staff-list', staffQuery, [normalizedBranchId]);
  const staffList: StaffMember[] = Array.isArray(staffListRaw) ? staffListRaw : [];
  const staffMap = Object.fromEntries(staffList.map(s => [s.id, s.fullName]));

  // â”€â”€ State â”€â”€
  const [statusFilter, setStatusFilter] = useState<PayslipStatus | ''>('');
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);
  const [selectedPosition, setSelectedPosition] = useState('');
  const [baseSalaryInput, setBaseSalaryInput] = useState('');
  const [allowanceInput, setAllowanceInput] = useState('');
  const [payrollFrequencyDays, setPayrollFrequencyDays] = useState<15 | 30>(30);
  const [savingSalary, setSavingSalary] = useState(false);

  // Summary period
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  // â”€â”€ Data â”€â”€
  const payslipsQuery: Record<string, string | number | boolean | undefined> = {};
  if (statusFilter) payslipsQuery.status = statusFilter;
  if (Number.isFinite(normalizedBranchId)) payslipsQuery.branchId = normalizedBranchId;

  const {
    data: payslips,
    loading: payslipsLoading,
    error: payslipsError,
    refetch: refetchPayslips,
  } = useApi<Payslip[]>('/payroll/payslips', payslipsQuery, [statusFilter, normalizedBranchId]);

  const summaryQuery: Record<string, string | number | boolean | undefined> = {
    periodStart: firstOfMonth,
    periodEnd: lastOfMonth,
  };
  if (Number.isFinite(normalizedBranchId)) summaryQuery.branchId = normalizedBranchId;

  const {
    data: summary,
    refetch: refetchSummary,
  } = useApi<PayrollSummary>('/payroll/summary', summaryQuery, [firstOfMonth, lastOfMonth, normalizedBranchId]);

  const {
    data: salarySettings,
    refetch: refetchSalarySettings,
  } = useApi<{
    salaryByPosition: Record<string, number>;
    allowanceByPosition?: Record<string, number>;
    payrollFrequencyDays?: 15 | 30;
  }>(
    '/payroll/settings/positions',
  );

  const payslipList: Payslip[] = Array.isArray(payslips) ? payslips : [];

  const knownPositions = useMemo(() => {
    const defaults = ['STAFF'];
    const fromStaff = staffList
      .map((s) => String(s.role || 'STAFF').trim().toUpperCase())
      .filter(Boolean);
    const fromSettings = Object.keys(salarySettings?.salaryByPosition || {}).map((r) =>
      String(r).trim().toUpperCase(),
    );
    const fromAllowanceSettings = Object.keys(
      salarySettings?.allowanceByPosition || {},
    ).map((r) => String(r).trim().toUpperCase());
    return Array.from(
      new Set([...defaults, ...fromStaff, ...fromSettings, ...fromAllowanceSettings]),
    ).sort();
  }, [staffList, salarySettings]);

  useEffect(() => {
    const freq = salarySettings?.payrollFrequencyDays;
    setPayrollFrequencyDays((prev) => {
      const nextFrequency = freq === 15 ? 15 : 30;
      return prev === nextFrequency ? prev : nextFrequency;
    });
  }, [salarySettings]);

  useEffect(() => {
    if (!selectedPosition && knownPositions.length > 0) {
      setSelectedPosition(knownPositions[0]);
    }
  }, [knownPositions, selectedPosition]);

  useEffect(() => {
    if (!selectedPosition) return;
    const base = salarySettings?.salaryByPosition?.[selectedPosition];
    const allowance = salarySettings?.allowanceByPosition?.[selectedPosition];
    setBaseSalaryInput(Number.isFinite(Number(base)) ? String(base) : '');
    setAllowanceInput(Number.isFinite(Number(allowance)) ? String(allowance) : '');
  }, [selectedPosition, salarySettings]);

  const toNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const deductionsOf = (ps: Payslip) => {
    const sss = toNumber(ps.sssDeduction ?? ps.sss);
    const philhealth = toNumber(ps.philhealthDeduction ?? ps.philhealth);
    const pagibig = toNumber(ps.pagibigDeduction ?? ps.pagibig);
    const withholdingTax = toNumber(ps.withholdingTax ?? ps.tax);
    const late = toNumber(ps.lateDeductions);
    const absent = toNumber(ps.absentDeductions);
    const other = toNumber(ps.otherDeductions);
    const total = toNumber(ps.totalDeductions ?? sss + philhealth + pagibig + withholdingTax + late + absent + other);

    return { sss, philhealth, pagibig, withholdingTax, late, absent, other, total };
  };

  const summaryView = useMemo(() => {
    const raw = (summary || {}) as any;
    return {
      totalGross: Number(raw.totalGross ?? raw.totalGrossPay ?? 0),
      totalNet: Number(raw.totalNet ?? raw.totalNetPay ?? 0),
      totalTax: Number(raw.totalTax ?? 0),
      totalSSS: Number(raw.totalSSS ?? 0),
      totalPhilHealth: Number(raw.totalPhilHealth ?? raw.totalPhilhealth ?? 0),
      totalPagIBIG: Number(raw.totalPagIBIG ?? raw.totalPagibig ?? 0),
      payslipCount: Number(raw.payslipCount ?? raw.totalStaff ?? 0),
    };
  }, [summary]);

  const refetchAll = useCallback(() => {
    refetchPayslips();
    refetchSummary();
    refetchSalarySettings();
  }, [refetchPayslips, refetchSummary, refetchSalarySettings]);

  // â”€â”€ Handlers â”€â”€
  const handleSavePositionSalarySettings = async () => {
    if (!selectedPosition) {
      showToast('Please select a role/position', 'error');
      return;
    }

    setSavingSalary(true);
    try {
      await api.put('/payroll/settings/frequency', {
        payrollFrequencyDays,
      });

      const baseSalary = Number(baseSalaryInput);
      const allowance = Number(allowanceInput || 0);
      if (!Number.isFinite(baseSalary) || baseSalary < 0) {
        throw new Error('Base salary must be a non-negative number');
      }
      if (!Number.isFinite(allowance) || allowance < 0) {
        throw new Error('Allowance must be a non-negative number');
      }

      await api.put(
        `/payroll/settings/positions/${encodeURIComponent(selectedPosition)}`,
        {
          baseSalary,
          allowance,
        },
      );

      showToast('Payroll settings saved', 'success');
      setShowSettingsDialog(false);
      refetchSalarySettings();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to save payroll settings', 'error');
    } finally {
      setSavingSalary(false);
    }
  };

  const handlePrintPayslip = async (payslipId: string) => {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      showToast('Unable to open print window. Allow pop-ups and try again.', 'error');
      return;
    }

    printWindow.document.open();
    printWindow.document.write('<html><head><title>Preparing payslip...</title></head><body style="font-family: Arial, sans-serif; margin: 24px;">Preparing payslip for printing...</body></html>');
    printWindow.document.close();

    try {
      const printable = await api.get(`/payroll/payslips/${payslipId}/printable`) as any;
      if (printWindow.closed) return;

      const title = `Payslip ${printable?.staffName || printable?.staffId || ''}`;
      printWindow.document.open();
      printWindow.document.write(`
        <html>
          <head>
            <title>${title}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
              h1, h2, h3 { margin: 0 0 8px; }
              .row { display: flex; justify-content: space-between; margin: 6px 0; }
              .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin: 12px 0; }
              .muted { color: #475569; font-size: 12px; }
              .strong { font-weight: 700; }
            </style>
          </head>
          <body>
            <h2>Payslip</h2>
            <p class="muted">Generated: ${new Date(printable.generatedAt).toLocaleString()}</p>
            <div class="card">
              <div class="row"><span>Staff</span><span class="strong">${printable.staffName || printable.staffId}</span></div>
              <div class="row"><span>Position</span><span>${printable.position || '-'}</span></div>
              <div class="row"><span>Period</span><span>${new Date(printable.periodStart).toLocaleDateString()} - ${new Date(printable.periodEnd).toLocaleDateString()}</span></div>
              <div class="row"><span>Status</span><span>${printable.status}</span></div>
            </div>
            <div class="card">
              <h3>Earnings</h3>
              <div class="row"><span>Base Salary</span><span>PHP ${Number(printable.baseSalary || 0).toFixed(2)}</span></div>
              <div class="row"><span>Overtime Pay</span><span>PHP ${Number(printable.overtimePay || 0).toFixed(2)}</span></div>
              <div class="row"><span>Allowances</span><span>PHP ${Number(printable.allowances || 0).toFixed(2)}</span></div>
              <div class="row"><span>Bonuses</span><span>PHP ${Number(printable.bonuses || 0).toFixed(2)}</span></div>
              <div class="row strong"><span>Gross Pay</span><span>PHP ${Number(printable.grossPay || 0).toFixed(2)}</span></div>
            </div>
            <div class="card">
              <h3>Deductions</h3>
              <div class="row"><span>Tax</span><span>PHP ${Number(printable.tax || 0).toFixed(2)}</span></div>
              <div class="row"><span>SSS</span><span>PHP ${Number(printable.sss || 0).toFixed(2)}</span></div>
              <div class="row"><span>PhilHealth</span><span>PHP ${Number(printable.philhealth || 0).toFixed(2)}</span></div>
              <div class="row"><span>Pag-IBIG</span><span>PHP ${Number(printable.pagibig || 0).toFixed(2)}</span></div>
              <div class="row"><span>Late Deductions</span><span>PHP ${Number(printable.lateDeductions || 0).toFixed(2)}</span></div>
              <div class="row"><span>Other Deductions</span><span>PHP ${Number(printable.otherDeductions || 0).toFixed(2)}</span></div>
              <div class="row strong"><span>Total Deductions</span><span>PHP ${Number(printable.totalDeductions || 0).toFixed(2)}</span></div>
            </div>
            <div class="card">
              <div class="row strong"><span>Net Pay</span><span>PHP ${Number(printable.netPay || 0).toFixed(2)}</span></div>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      window.setTimeout(() => {
        if (!printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 150);
    } catch (err: unknown) {
      printWindow.close();
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to print payslip', 'error');
    }
  };

  const handleApprove = async (payslipId: string) => {
    const confirm = await Swal.fire({
      title: 'Confirm Action',
      text: 'Approve this payslip for payment?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      await api.post(`/payroll/payslips/${payslipId}/approve`, {
        approvedBy: session?.user?.id || localStorage.getItem('user_id') || undefined,
      });
      showToast('Payslip approved', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to approve', 'error');
    }
  };

  const handleReject = async (payslipId: string) => {
    const confirm = await Swal.fire({
      title: 'Are you sure?',
      text: 'Reject this payslip?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      await api.post(`/payroll/payslips/${payslipId}/reject`, {
        rejectedBy: session?.user?.id || localStorage.getItem('user_id') || 'system',
      });
      showToast('Payslip rejected', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to reject', 'error');
    }
  };

  const viewPayslipDetail = (payslip: Payslip) => {
    setSelectedPayslip(payslip);
    setShowDetailDialog(true);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">Payroll Management</h1>
          <p className="text-[#6B655C] mt-1">Automated payroll based on base salary per role/position</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowSettingsDialog(true)}>
            <Settings className="w-4 h-4 mr-2" /> Payroll Settings
          </Button>
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl"><Banknote className="w-5 h-5" /></div>
                <div>
                  <p className="text-xl font-black">{formatCurrency(summaryView.totalGross)}</p>
                  <p className="text-emerald-200 text-xs">Total Gross</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-[#C9A05C] to-[#A07D40] text-white">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl"><Wallet className="w-5 h-5" /></div>
                <div>
                  <p className="text-xl font-black">{formatCurrency(summaryView.totalNet)}</p>
                  <p className="text-[#E5C88C] text-xs">Total Net Pay</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-100 rounded-xl"><Calculator className="w-5 h-5 text-rose-600" /></div>
                <div>
                  <p className="text-xl font-black text-[#EAE2D6]">{formatCurrency(summaryView.totalTax)}</p>
                  <p className="text-xs text-[#6B655C]">Withholding Tax</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-100 rounded-xl"><FileText className="w-5 h-5 text-sky-600" /></div>
                <div>
                  <p className="text-xl font-black text-[#EAE2D6]">{summaryView.payslipCount}</p>
                  <p className="text-xs text-[#6B655C]">Total Payslips</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs space-y-1">
                <div className="flex justify-between"><span className="text-[#6B655C]">SSS</span><span className="font-bold">{formatCurrency(summaryView.totalSSS)}</span></div>
                <div className="flex justify-between"><span className="text-[#6B655C]">PhilHealth</span><span className="font-bold">{formatCurrency(summaryView.totalPhilHealth)}</span></div>
                <div className="flex justify-between"><span className="text-[#6B655C]">Pag-IBIG</span><span className="font-bold">{formatCurrency(summaryView.totalPagIBIG)}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Payroll Settings Modal */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payroll Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#999186] uppercase tracking-wide">Payroll Frequency</label>
              <Select
                value={String(payrollFrequencyDays)}
                onValueChange={(value) =>
                  setPayrollFrequencyDays(value === '15' ? 15 : 30)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payroll frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">Every 15 days (semi-monthly)</SelectItem>
                  <SelectItem value="30">Every 30 days (monthly)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#999186] uppercase tracking-wide">Role/Position</label>
                <Select value={selectedPosition} onValueChange={setSelectedPosition}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role/position" />
                  </SelectTrigger>
                  <SelectContent>
                    {knownPositions.map((position) => (
                      <SelectItem key={position} value={position}>
                        {position}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#999186] uppercase tracking-wide">Base Salary</label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={baseSalaryInput}
                  onChange={(e) => setBaseSalaryInput(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#999186] uppercase tracking-wide">Allowance</label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={allowanceInput}
                  onChange={(e) => setAllowanceInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSavePositionSalarySettings}
                disabled={savingSalary || knownPositions.length === 0 || !selectedPosition}
              >
                {savingSalary ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save Payroll Settings
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-[#6B655C]" />
        <Select
          value={statusFilter || ALL_PAYROLL_STATUSES}
          onValueChange={(v) =>
            setStatusFilter(
              v === ALL_PAYROLL_STATUSES ? '' : (v as PayslipStatus),
            )
          }
        >
          <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PAYROLL_STATUSES}>All Statuses</SelectItem>
            {(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED'] as PayslipStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{humanizeStatus(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Payslips Table */}
      {payslipsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#C9A05C]" />
        </div>
      ) : payslipsError ? (
        <div className="flex items-center justify-center py-12">
          <AlertTriangle className="w-5 h-5 text-rose-500 mr-2" />
          <span className="text-rose-600">{payslipsError}</span>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payslips</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff ID</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslipList.map((ps) => {
                  const d = deductionsOf(ps);
                  return (
                    <TableRow key={ps.id} className="cursor-pointer hover:bg-[#1C1C26]" onClick={() => viewPayslipDetail(ps)}>
                      <TableCell className="text-xs font-medium">{staffMap[ps.staffId] || ps.staffId?.slice(0, 8) + '...'}</TableCell>
                      <TableCell className="text-xs">
                        {formatDate(ps.periodStart)} -- {formatDate(ps.periodEnd)}
                      </TableCell>
                      <TableCell>{ps.daysWorked}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(ps.grossPay)}</TableCell>
                      <TableCell className="text-right font-mono text-rose-600">{formatCurrency(d.total)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{formatCurrency(ps.netPay)}</TableCell>
                      <TableCell>
                        <Badge className={statusColor(ps.status)}>{humanizeStatus(ps.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {(ps.status === 'DRAFT' || ps.status === 'PENDING_APPROVAL') && (
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => handleApprove(ps.id)}>
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                            </Button>
                          )}
                          {ps.status !== 'PAID' && ps.status !== 'CANCELLED' && (
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => handleReject(ps.id)}>
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          )}
                          {ps.status === 'PAID' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => handlePrintPayslip(ps.id)}
                            >
                              <Printer className="w-3 h-3 mr-1" /> Print
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {payslipList.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-[#6B655C] py-8">No payslips found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payslip Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payslip Detail</DialogTitle>
          </DialogHeader>
          {selectedPayslip && (
            (() => {
              const d = deductionsOf(selectedPayslip);
              return (
            <div className="space-y-4 py-4">
              <div className="flex justify-between items-center">
                <Badge className={statusColor(selectedPayslip.status)}>
                  {humanizeStatus(selectedPayslip.status)}
                </Badge>
                <span className="text-sm text-[#6B655C]">
                  {formatDate(selectedPayslip.periodStart)} -- {formatDate(selectedPayslip.periodEnd)}
                </span>
              </div>

              {/* Earnings */}
              <div className="bg-emerald-50 rounded-xl p-4">
                <h4 className="font-bold text-emerald-800 mb-2 text-sm">Earnings</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>Base Salary</span><span className="font-mono">{formatCurrency(selectedPayslip.baseSalary)}</span></div>
                  <div className="flex justify-between"><span>Overtime ({selectedPayslip.overtime?.toFixed(1)}h)</span><span className="font-mono">{formatCurrency(selectedPayslip.overtimePay)}</span></div>
                  <div className="flex justify-between"><span>Allowances</span><span className="font-mono">{formatCurrency(selectedPayslip.allowances)}</span></div>
                  <div className="flex justify-between"><span>Bonuses</span><span className="font-mono">{formatCurrency(selectedPayslip.bonuses)}</span></div>
                  <div className="flex justify-between border-t pt-1 font-bold"><span>Gross Pay</span><span className="font-mono">{formatCurrency(selectedPayslip.grossPay)}</span></div>
                </div>
              </div>

              {/* Deductions */}
              <div className="bg-rose-50 rounded-xl p-4">
                <h4 className="font-bold text-rose-800 mb-2 text-sm">Deductions</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>SSS (4.5%)</span><span className="font-mono text-rose-600">{formatCurrency(d.sss)}</span></div>
                  <div className="flex justify-between"><span>PhilHealth (2.5%)</span><span className="font-mono text-rose-600">{formatCurrency(d.philhealth)}</span></div>
                  <div className="flex justify-between"><span>Pag-IBIG</span><span className="font-mono text-rose-600">{formatCurrency(d.pagibig)}</span></div>
                  <div className="flex justify-between"><span>Withholding Tax (TRAIN)</span><span className="font-mono text-rose-600">{formatCurrency(d.withholdingTax)}</span></div>
                  <div className="flex justify-between"><span>Late Deductions</span><span className="font-mono text-rose-600">{formatCurrency(d.late)}</span></div>
                  <div className="flex justify-between"><span>Absent Deductions</span><span className="font-mono text-rose-600">{formatCurrency(d.absent)}</span></div>
                  <div className="flex justify-between"><span>Other Deductions</span><span className="font-mono text-rose-600">{formatCurrency(d.other)}</span></div>
                  <div className="flex justify-between border-t pt-1 font-bold"><span>Total Deductions</span><span className="font-mono text-rose-700">{formatCurrency(d.total)}</span></div>
                </div>
              </div>

              {/* Net Pay */}
              <div className="bg-[#C9A05C]/10 rounded-xl p-4">
                <div className="flex justify-between items-center">
                  <span className="font-black text-[#C9A05C] text-lg">Net Pay</span>
                  <span className="font-mono font-black text-[#C9A05C] text-2xl">{formatCurrency(selectedPayslip.netPay)}</span>
                </div>
              </div>

              {/* Metadata */}
              <div className="text-xs text-[#6B655C] space-y-0.5">
                <p>Days Worked: {selectedPayslip.daysWorked} | Total Hours: {selectedPayslip.totalWorkHours?.toFixed(1)}</p>
                {selectedPayslip.approvedBy && <p>Approved by: {selectedPayslip.approvedBy} on {formatDate(selectedPayslip.approvedAt)}</p>}
                {selectedPayslip.paidBy && <p>Paid by: {selectedPayslip.paidBy} on {formatDate(selectedPayslip.paidAt)}</p>}
              </div>
              <div className="pt-2 flex justify-end">
                <Button size="sm" variant="outline" onClick={() => handlePrintPayslip(selectedPayslip.id)}>
                  <Printer className="w-4 h-4 mr-2" /> Print Payslip
                </Button>
              </div>
            </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PayrollManagement;
