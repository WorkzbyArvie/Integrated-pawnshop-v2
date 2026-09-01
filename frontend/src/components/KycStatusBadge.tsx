import { CheckCircle, Clock, ShieldAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export interface KycStatusPalette {
  label: string;
  className: string;
  testId: string;
  icon: ReactNode;
}

export const KYC_STATUS_PALETTE: Record<string, KycStatusPalette> = {
  VERIFIED: {
    label: 'Verified',
    className: 'bg-emerald-500/10 text-emerald-400',
    testId: 'kyc-icon-verified',
    icon: <CheckCircle className="h-3 w-3" />,
  },
  PENDING: {
    label: 'Pending',
    className: 'bg-[rgba(201,160,92,0.1)] text-[#C9A05C]',
    testId: 'kyc-icon-pending',
    icon: <Clock className="h-3 w-3" />,
  },
  REJECTED: {
    label: 'Rejected',
    className: 'bg-red-500/10 text-red-400',
    testId: 'kyc-icon-rejected',
    icon: <XCircle className="h-3 w-3" />,
  },
  NOT_SUBMITTED: {
    label: 'Not Submitted',
    className: 'bg-[#1C1C26] text-[#8A8279]',
    testId: 'kyc-icon-not-submitted',
    icon: <ShieldAlert className="h-3 w-3" />,
  },
};

interface KycStatusBadgeProps {
  status: string | null | undefined;
}

export default function KycStatusBadge({ status }: KycStatusBadgeProps) {
  const palette = KYC_STATUS_PALETTE[status ?? ''] ?? KYC_STATUS_PALETTE.NOT_SUBMITTED;
  return (
    <span
      aria-label={`KYC status: ${palette.label}`}
      data-testid="kyc-status-badge"
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${palette.className}`}
    >
      <span data-testid={palette.testId}>{palette.icon}</span>
      {palette.label}
    </span>
  );
}
