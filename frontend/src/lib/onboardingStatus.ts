export type OnboardingOverall = 'INCOMPLETE' | 'PENDING_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED';

/**
 * Both comparisons below are case-insensitive over a raw database value, which
 * makes them the two places a status rename breaks *silently*.
 *
 * A stale literal does not throw. `rejectedDocumentCount` returns 0, the owner
 * dashboard stops showing that anything needs attention, and
 * `canApproveDocument` returns true for a document that was already denied -
 * which re-opens a finalized decision. The enum value is `DENIED`; these match
 * on it deliberately and are covered by onboardingStatus.test.ts.
 */
const DENIED_STATUSES = new Set(['DENIED', 'REJECTED']);

function isDeniedStatus(status: string | null | undefined): boolean {
  return DENIED_STATUSES.has((status ?? '').toUpperCase());
}

export function canApproveDocument(
  docStatus: string | null | undefined,
  serverViewed: boolean | null | undefined,
  viewedDocIds: Set<string>,
  documentId: string,
): boolean {
  const normalized = (docStatus ?? '').toUpperCase();
  if (normalized === 'VERIFIED' || isDeniedStatus(normalized)) {
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

export function deniedDocumentCount(docs: Array<{ status?: string | null }>): number {
  return docs.filter((d) => isDeniedStatus(d.status)).length;
}
