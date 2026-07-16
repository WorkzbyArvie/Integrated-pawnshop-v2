/** Shared formatting utilities for the pawnshop frontend. */

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '₱0.00';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null) return '0';
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function classifyStatus(status: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  const s = status.toUpperCase();
  if (['COMPLETED', 'APPROVED', 'PAID', 'ACTIVE', 'RELEASED', 'PRESENT', 'VERIFIED', 'COMPLIED', 'READY_FOR_RELEASE'].includes(s)) return 'success';
  if (['WAITING', 'PENDING', 'DRAFT', 'PENDING_COMPLIANCE', 'TRIAL', 'CALLED', 'HALF_DAY'].includes(s)) return 'warning';
  if (['CANCELLED', 'EXPIRED', 'FAILED', 'ABSENT', 'NO_SHOW', 'PAST_DUE'].includes(s)) return 'danger';
  if (['SERVING', 'SENT', 'DELIVERED', 'ON_LEAVE'].includes(s)) return 'info';
  return 'default';
}

export function statusColor(status: string): string {
  const classification = classifyStatus(status);
  switch (classification) {
    case 'success':
      return 'bg-emerald-100 text-emerald-800';
    case 'warning':
      return 'bg-amber-100 text-amber-800';
    case 'danger':
      return 'bg-rose-100 text-rose-800';
    case 'info':
      return 'bg-sky-100 text-sky-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

/** Returns a human-friendly label from a SCREAMING_SNAKE status string. */
export function humanizeStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
