/**
 * Shared TypeScript enums & interfaces matching the NestJS backend.
 * Keep these in sync with the Prisma schema / backend DTOs.
 */

// ── Queue ────────────────────────────
export type QueueStatus = 'WAITING' | 'SERVING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type QueueType = 'PAWNING' | 'RENEWAL' | 'REDEMPTION' | 'AUCTION_INQUIRY' | 'GENERAL';

export interface QueueTicket {
  id: string;
  pawnshopId: string;
  branchId?: number;
  customerId: string;
  queueNumber: string;
  queueType: QueueType;
  status: QueueStatus;
  priority: number;
  estimatedWaitMinutes?: number;
  assignedStaffId?: string;
  counterNumber?: string;
  notes?: string;
  calledAt?: string;
  servedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; full_name?: string; email?: string };
}

export interface QueueStatistics {
  totalToday: number;
  waiting: number;
  serving: number;
  completed: number;
  noShow: number;
  cancelled: number;
  averageWaitMinutes: number;
  averageServiceMinutes: number;
  byType: Record<string, number>;
}

// ── Finance ──────────────────────────
export type LedgerEntryType = 'CREDIT' | 'DEBIT';
export type LedgerCategory =
  | 'LOAN_DISBURSEMENT'
  | 'LOAN_REPAYMENT'
  | 'AUCTION_PAYMENT'
  | 'AUCTION_REFUND'
  | 'PENALTY_COLLECTION'
  | 'FEE_COLLECTION'
  | 'OPERATIONAL_EXPENSE'
  | 'SALARY_PAYMENT'
  | 'SUBSCRIPTION_PAYMENT'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'ADJUSTMENT';

export interface LedgerEntry {
  id: string;
  pawnshopId: string;
  branchId?: number;
  entryNumber: string;
  entryType: LedgerEntryType;
  category: LedgerCategory;
  amount: number;
  balanceAfter: number;
  description: string;
  performedBy: string;
  referenceType?: string;
  referenceId?: string;
  counterparty?: string;
  paymentMethod?: string;
  receiptNumber?: string;
  createdAt: string;
}

export interface FinanceSummary {
  totalCredits: number;
  totalDebits: number;
  netFlow: number;
  byCategory: Array<{
    category: string;
    _sum: { amount: number };
    _count: number;
  }>;
}

export interface DailyReconciliation {
  id: string;
  date: string;
  openingBalance: number;
  totalCredits: number;
  totalDebits: number;
  closingBalance: number;
  physicalCash?: number;
  discrepancy?: number;
  status: string;
  reconciledBy?: string;
  completedAt?: string;
  createdAt: string;
}

// ── Attendance ───────────────────────
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE';
export type LeaveType = 'SICK' | 'VACATION' | 'EMERGENCY' | 'MATERNITY' | 'PATERNITY' | 'BEREAVEMENT' | 'OTHER';

export interface AttendanceRecord {
  id: string;
  pawnshopId: string;
  branchId?: number;
  staffId: string;
  date: string;
  status: AttendanceStatus;
  clockIn?: string;
  clockOut?: string;
  workHours?: number;
  overtime?: number;
  lateMinutes?: number;
  leaveType?: LeaveType;
  leaveReason?: string;
  leaveApprovedBy?: string;
  clockInLocation?: string;
  clockOutLocation?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  staff?: { id: string; full_name?: string; email?: string };
}

export interface AttendanceStatistics {
  totalDays: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  halfDay: number;
  totalWorkHours: number;
  totalOvertime: number;
  averageWorkHours: number;
  attendanceRate: number;
  punctualityRate: number;
}

// ── Payroll ──────────────────────────
export type PayslipStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | 'CANCELLED';

export interface Payslip {
  id: string;
  pawnshopId: string;
  branchId?: number;
  staffId: string;
  periodStart: string;
  periodEnd: string;
  baseSalary: number;
  daysWorked: number;
  totalWorkHours: number;
  overtime: number;
  overtimePay: number;
  lateDeductions: number;
  absentDeductions: number;
  grossPay: number;
  totalDeductions?: number;
  sssDeduction: number;
  philhealthDeduction: number;
  pagibigDeduction: number;
  withholdingTax: number;
  tax?: number;
  sss?: number;
  philhealth?: number;
  pagibig?: number;
  otherDeductions: number;
  allowances: number;
  bonuses: number;
  netPay: number;
  status: PayslipStatus;
  approvedBy?: string;
  approvedAt?: string;
  paidBy?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  staff?: { id: string; full_name?: string; email?: string };
}

export interface PayrollSummary {
  totalGross: number;
  totalNet: number;
  totalTax: number;
  totalSSS: number;
  totalPhilHealth: number;
  totalPagIBIG: number;
  payslipCount: number;
  approvedCount: number;
  paidCount: number;
  draftCount: number;
}

// ── Compliance ───────────────────────
export type ComplianceStatus =
  | 'PENDING_COMPLIANCE'
  | 'COMPLIED'
  | 'READY_FOR_RELEASE'
  | 'RELEASED'
  | 'EXPIRED';

export interface ComplianceAccessLogEntry {
  userId?: string;
  accessedBy?: string;
  action?: string;
  accessType?: string;
  accessedAt?: string;
  timestamp?: string;
  previousWinnerId?: string;
  newWinnerId?: string;
}

export interface AuctionWinnerCompliance {
  id: string;
  pawnshopId: string;
  auctionListingId: number;
  winnerId: string;
  winnerFullName?: string;
  winnerPhone?: string;
  winnerEmail?: string;
  winningBidAmount: number;
  complianceDeadline: string;
  paymentProofUrl?: string;
  paymentReference?: string;
  paidAmount?: number;
  status: ComplianceStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  releasedBy?: string;
  releasedAt?: string;
  releaseNotes?: string;
  accessLog?: ComplianceAccessLogEntry[];
  createdAt: string;
  updatedAt: string;
  listing?: { id: number; ticketId: string; ticket?: { itemName?: string } };
}

export interface ComplianceStatistics {
  total: number;
  pending: number;
  complied: number;
  readyForRelease: number;
  released: number;
  expired: number;
  averageComplianceHours: number;
}

// ── Notifications ────────────────────
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';
export type NotificationType =
  | 'AUCTION_OUTBID'
  | 'AUCTION_WON'
  | 'AUCTION_ENDING'
  | 'COMPLIANCE_REMINDER'
  | 'COMPLIANCE_DEADLINE'
  | 'PAYMENT_RECEIVED'
  | 'SYSTEM_ALERT'
  | 'GENERAL';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Notification {
  id: string;
  recipientId: string;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  status: NotificationStatus;
  scheduledFor?: string;
  sentAt?: string;
  readAt?: string;
  expiresAt?: string;
  createdAt: string;
}

// ── Subscriptions ────────────────────
export type SubscriptionTier = 'FREE' | 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

export interface Subscription {
  id: string;
  pawnshopId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPrice: number;
  autoRenew: boolean;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt?: string;
  billingEmail?: string;
  checkoutUrl?: string;
  canChangeTier?: boolean;
  canCompletePayment?: boolean;
  completePaymentReason?: string | null;
  createdAt: string;
  updatedAt: string;
  payments?: SubscriptionPayment[];
}

export interface SubscriptionPayment {
  id: string;
  amount: number;
  status: string;
  paidAt?: string;
  createdAt: string;
}

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  name: string;
  monthlyPrice: number;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  description?: string;
}

export interface SubscriptionLimits {
  tier: SubscriptionTier;
  limits: Record<string, number | null>;
  usage: Record<string, number>;
  withinLimits: boolean;
  exceededLimits: string[];
}
