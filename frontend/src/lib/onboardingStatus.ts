export type OnboardingOverall = 'INCOMPLETE' | 'PENDING_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED';

export function canApproveDocument(
  docStatus: string | null | undefined,
  serverViewed: boolean | null | undefined,
  viewedDocIds: Set<string>,
  documentId: string,
): boolean {
  const normalized = (docStatus ?? '').toUpperCase();
  if (normalized === 'VERIFIED' || normalized === 'REJECTED') {
    return false;
  }
  return Boolean(serverViewed) || viewedDocIds.has(documentId);
}

export function overallTone(overall: string | null | undefined): string {
  const normalized = (overall ?? '').toUpperCase();
  if (normalized === 'APPROVED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized === 'ACTION_REQUIRED') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

export function overallLabel(overall: string | null | undefined): string {
  const normalized = (overall ?? '').toUpperCase();
  if (normalized === 'APPROVED') return 'Approved';
  if (normalized === 'ACTION_REQUIRED') return 'Action Required';
  if (normalized === 'PENDING_REVIEW') return 'Under Review';
  return 'Incomplete';
}

export function rejectedDocumentCount(docs: Array<{ status?: string | null }>): number {
  return docs.filter((d) => (d.status ?? '').toUpperCase() === 'REJECTED').length;
}
