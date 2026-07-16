/**
 * FinanceTreasury â€“ Unified Finance & Treasury dashboard.
 *
 * Shows the integrated view of:
 *   - Cash balance & cash flow
 *   - Payroll expenses (from payslips)
 *   - Attendance impact on payroll
 *   - Recent ledger transactions
 *   - Breakdown by category (loans, salary, fees, etc.)
 */
import { useState, useMemo } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Clock,
  Receipt,
  Banknote,
  AlertTriangle,
  DollarSign,
  PieChart,
  Building2,
  TrendingUp,
  Package,
  Landmark,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import useApi from '@/lib/useApi';
import { formatCurrency, formatDateTime } from '@/lib/formatters';

interface FinanceTreasuryProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface TreasuryDashboard {
  currentBalance: number;
  period: { from: string; to: string };
  cashFlow: { totalInflow: number; totalOutflow: number; net: number };
  byCategory: Record<string, { inflow: number; outflow: number; count: number }>;
  payroll: {
    totalGrossPay: number;
    totalNetPay: number;
    totalDeductions: number;
    totalTax: number;
    totalSSS: number;
    totalPhilhealth: number;
    totalPagibig: number;
    totalLateDeductions: number;
    totalOvertimePay: number;
    payslipCount: number;
    paidCount: number;
    pendingCount: number;
  };
  attendance: {
    totalRecords: number;
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    totalWorkHours: number;
    totalOvertimeHours: number;
    totalLateMinutes: number;
  };
  recentTransactions: Array<{
    id: string;
    entryNumber: string;
    entryType: string;
    category: string;
    amount: number;
    balanceAfter: number;
    description: string;
    counterparty?: string;
    referenceType?: string;
    referenceId?: string;
    transactionDate: string;
  }>;
  transactionCount: number;
  loanStats: {
    totalDisbursed: number;
    totalInterest: number;
    activeLoans: number;
    totalLoans: number;
  };
  inventory: {
    activeTicketCount: number;
    totalPawnValue: number;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  LOAN_DISBURSEMENT: 'Loan Disbursements',
  LOAN_REPAYMENT: 'Loan Repayments',
  AUCTION_PAYMENT: 'Auction Payments',
  AUCTION_REFUND: 'Auction Refunds',
  PENALTY_COLLECTION: 'Penalties',
  FEE_COLLECTION: 'Fees',
  OPERATIONAL_EXPENSE: 'Operations',
  SALARY_PAYMENT: 'Salary Payments',
  SUBSCRIPTION_PAYMENT: 'Subscriptions',
  CASH_IN: 'Cash In',
  CASH_OUT: 'Cash Out',
  ADJUSTMENT: 'Adjustments',
};

export function FinanceTreasury({ branchId: _branchId, activeBranchId }: FinanceTreasuryProps) {
  const normalizedBranchId =
    Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
      ? Number(activeBranchId)
      : undefined;
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0],
  );

  const dashboardQuery: Record<string, string | number | boolean | undefined> = {
    dateFrom,
    dateTo,
  };
  if (Number.isFinite(normalizedBranchId)) {
    dashboardQuery.branchId = normalizedBranchId;
  }

  const {
    data: dashboard,
    loading,
    error,
    refetch,
  } = useApi<TreasuryDashboard>('/finance/treasury-dashboard', dashboardQuery, [dateFrom, dateTo, normalizedBranchId]);

  const d = dashboard as TreasuryDashboard | null;

  // Sort categories by total amount descending
  const categoryBreakdown = useMemo(() => {
    if (!d?.byCategory) return [];
    return Object.entries(d.byCategory)
      .map(([cat, vals]) => ({ category: cat, ...vals, total: vals.inflow + vals.outflow }))
      .sort((a, b) => b.total - a.total);
  }, [d]);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tighter uppercase italic">
            Finance <span className="text-[#C9A05C]">&amp;</span> Treasury
          </h2>
          <p className="text-[#6B655C] font-medium uppercase text-[10px] tracking-widest">
            Attendance &bull; Payroll &bull; Cash Flow â€” Integrated View
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 text-xs" />
          <span className="text-[#6B655C] text-xs font-bold">to</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 text-xs" />
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700 text-sm">
          <AlertTriangle className="w-5 h-5" /> {String(error)}
        </div>
      )}

      {/* â•â•â• TOP ROW: Balance + Cash Flow + Payroll Expense â•â•â• */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Treasury Balance */}
        <div className="lg:col-span-1 bg-[#030213] text-white p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
          <Building2 className="absolute right-[-10px] bottom-[-10px] w-40 h-40 opacity-5 rotate-12" />
          <div className="relative z-10">
            <p className="text-blue-400 font-black uppercase tracking-[0.2em] text-[10px] mb-1">Current Balance</p>
            <h3 className="text-4xl font-black tracking-tighter mb-4">
              {loading ? <span className="animate-pulse">---</span> : formatCurrency(d?.currentBalance ?? 0)}
            </h3>
            <div className="flex gap-3 text-xs">
              <span className="bg-emerald-500/15 text-emerald-400 px-3 py-1 rounded-lg font-bold flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3" /> {formatCurrency(d?.cashFlow?.totalInflow ?? 0)}
              </span>
              <span className="bg-rose-500/15 text-rose-400 px-3 py-1 rounded-lg font-bold flex items-center gap-1">
                <ArrowDownRight className="w-3 h-3" /> {formatCurrency(d?.cashFlow?.totalOutflow ?? 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Cash Flow Net */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Net Cash Flow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-black tracking-tight ${(d?.cashFlow?.net ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {loading ? '---' : formatCurrency(d?.cashFlow?.net ?? 0)}
            </p>
            <p className="text-xs text-[#6B655C] mt-1">{d?.transactionCount ?? 0} transactions this period</p>
          </CardContent>
        </Card>

        {/* Payroll Expense */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Banknote className="w-4 h-4" /> Payroll Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-black tracking-tight text-rose-600">
              {loading ? '---' : formatCurrency(d?.payroll?.totalNetPay ?? 0)}
            </p>
            <p className="text-xs text-[#6B655C] mt-1">
              {d?.payroll?.payslipCount ?? 0} payslips &bull; {d?.payroll?.paidCount ?? 0} paid &bull; {d?.payroll?.pendingCount ?? 0} pending
            </p>
          </CardContent>
        </Card>
      </div>

      {/* â•â•â• SECOND ROW: Attendance Impact + Payroll Breakdown + Category Breakdown â•â•â• */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Impact */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Clock className="w-4 h-4" /> Attendance Impact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="Present" value={d?.attendance?.present ?? 0} color="emerald" />
              <StatBox label="Absent" value={d?.attendance?.absent ?? 0} color="rose" />
              <StatBox label="Late" value={d?.attendance?.late ?? 0} color="amber" />
              <StatBox label="On Leave" value={d?.attendance?.onLeave ?? 0} color="blue" />
            </div>
            <div className="pt-2 border-t space-y-1 text-xs text-[#999186]">
              <div className="flex justify-between"><span>Total Work Hours</span><span className="font-bold">{(d?.attendance?.totalWorkHours ?? 0).toFixed(1)}h</span></div>
              <div className="flex justify-between"><span>Overtime Hours</span><span className="font-bold text-[#C9A05C]">{(d?.attendance?.totalOvertimeHours ?? 0).toFixed(1)}h</span></div>
              <div className="flex justify-between"><span>Late Minutes</span><span className="font-bold text-amber-600">{d?.attendance?.totalLateMinutes ?? 0} min</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Payroll Breakdown */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Receipt className="w-4 h-4" /> Payroll Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <PayrollRow label="Gross Pay" value={d?.payroll?.totalGrossPay ?? 0} bold />
            <PayrollRow label="Overtime Pay" value={d?.payroll?.totalOvertimePay ?? 0} color="blue" />
            <div className="border-t my-1" />
            <PayrollRow label="Income Tax" value={d?.payroll?.totalTax ?? 0} negative />
            <PayrollRow label="SSS" value={d?.payroll?.totalSSS ?? 0} negative />
            <PayrollRow label="PhilHealth" value={d?.payroll?.totalPhilhealth ?? 0} negative />
            <PayrollRow label="Pag-IBIG" value={d?.payroll?.totalPagibig ?? 0} negative />
            <PayrollRow label="Late Deductions" value={d?.payroll?.totalLateDeductions ?? 0} negative />
            <div className="border-t my-1" />
            <PayrollRow label="Total Deductions" value={d?.payroll?.totalDeductions ?? 0} negative bold />
            <PayrollRow label="Net Pay (Disbursed)" value={d?.payroll?.totalNetPay ?? 0} bold color="emerald" />
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <PieChart className="w-4 h-4" /> By Category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs max-h-80 overflow-y-auto">
            {categoryBreakdown.length === 0 && !loading && (
              <p className="text-[#6B655C] text-center py-4">No transactions</p>
            )}
            {categoryBreakdown.map(c => (
              <div key={c.category} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <div>
                  <span className="font-bold text-[#6B655C]">{CATEGORY_LABELS[c.category] || c.category}</span>
                  <span className="text-[#6B655C] ml-1">({c.count})</span>
                </div>
                <div className="flex gap-3">
                  {c.inflow > 0 && <span className="text-emerald-600 font-bold">+{formatCurrency(c.inflow)}</span>}
                  {c.outflow > 0 && <span className="text-rose-600 font-bold">-{formatCurrency(c.outflow)}</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* â•â•â• LOAN & INVENTORY ROW â•â•â• */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Loan Stats */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Landmark className="w-4 h-4" /> Loan Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(d?.loanStats?.totalDisbursed ?? 0)}</p>
                <p className="text-[10px] text-[#6B655C] font-bold uppercase tracking-wider">Total Disbursed</p>
              </div>
              <div>
                <p className="text-2xl font-black text-emerald-600">{formatCurrency(d?.loanStats?.totalInterest ?? 0)}</p>
                <p className="text-[10px] text-[#6B655C] font-bold uppercase tracking-wider">Interest Earned</p>
              </div>
              <div>
                <p className="text-2xl font-black text-[#C9A05C]">{d?.loanStats?.activeLoans ?? 0}</p>
                <p className="text-[10px] text-[#6B655C] font-bold uppercase tracking-wider">Active Loans</p>
              </div>
              <div>
                <p className="text-2xl font-black text-[#999186]">{d?.loanStats?.totalLoans ?? 0}</p>
                <p className="text-[10px] text-[#6B655C] font-bold uppercase tracking-wider">Total This Period</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inventory / Active Pawns */}
        <Card className="rounded-2xl shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Package className="w-4 h-4" /> Pawned Inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-3xl font-black text-[#EAE2D6]">{d?.inventory?.activeTicketCount ?? 0}</p>
                <p className="text-[10px] text-[#6B655C] font-bold uppercase tracking-wider">Active Tickets</p>
              </div>
              <div>
                <p className="text-3xl font-black text-[#C9A05C]">{formatCurrency(d?.inventory?.totalPawnValue ?? 0)}</p>
                <p className="text-[10px] text-[#6B655C] font-bold uppercase tracking-wider">Total Pawn Value</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* â•â•â• THIRD ROW: Recent Transactions â•â•â• */}
      <Card className="rounded-2xl shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Recent Transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] font-black uppercase">Entry #</TableHead>
                  <TableHead className="text-[10px] font-black uppercase">Date</TableHead>
                  <TableHead className="text-[10px] font-black uppercase">Type</TableHead>
                  <TableHead className="text-[10px] font-black uppercase">Category</TableHead>
                  <TableHead className="text-[10px] font-black uppercase">Description</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-right">Amount</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!d?.recentTransactions || d.recentTransactions.length === 0) && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-[#6B655C] py-8">
                      No transactions for this period
                    </TableCell>
                  </TableRow>
                )}
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-[#6B655C] py-8">
                      <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading...
                    </TableCell>
                  </TableRow>
                )}
                {d?.recentTransactions?.map(tx => (
                  <TableRow key={tx.id} className="text-xs">
                    <TableCell className="font-mono text-[10px] text-[#6B655C]">{tx.entryNumber}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(tx.transactionDate)}</TableCell>
                    <TableCell>
                      <Badge variant={tx.entryType === 'CREDIT' ? 'default' : 'destructive'} className="text-[10px]">
                        {tx.entryType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{CATEGORY_LABELS[tx.category] || tx.category}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={tx.description}>{tx.description}</TableCell>
                    <TableCell className={`text-right font-bold ${tx.entryType === 'CREDIT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.entryType === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[#999186]">{formatCurrency(tx.balanceAfter)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* â”€â”€ Small helper components â”€â”€ */

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-[#C9A05C]/10 text-[#C9A05C] border-[rgba(201,160,92,0.2)]',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${colorMap[color] || 'bg-[#1C1C26] text-[#6B655C] border-[rgba(201,160,92,0.12)]'}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
    </div>
  );
}

function PayrollRow({
  label,
  value,
  negative,
  bold,
  color,
}: {
  label: string;
  value: number;
  negative?: boolean;
  bold?: boolean;
  color?: string;
}) {
  const colorClass = color === 'emerald' ? 'text-emerald-600' : color === 'blue' ? 'text-[#C9A05C]' : negative ? 'text-rose-600' : 'text-[#6B655C]';
  return (
    <div className="flex justify-between items-center">
      <span className={`text-[#999186] ${bold ? 'font-bold' : ''}`}>{label}</span>
      <span className={`${colorClass} ${bold ? 'font-black' : 'font-semibold'}`}>
        {negative && value > 0 ? '-' : ''}{formatCurrency(value)}
      </span>
    </div>
  );
}

export default FinanceTreasury;