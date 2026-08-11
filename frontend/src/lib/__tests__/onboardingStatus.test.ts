import { describe, it, expect } from 'vitest';

import {
  canApproveDocument,
  overallLabel,
  overallTone,
  rejectedDocumentCount,
} from '../onboardingStatus';

describe('canApproveDocument', () => {
  it('returns false for VERIFIED docs even when already viewed', () => {
    expect(canApproveDocument('VERIFIED', true, new Set(['doc-1']), 'doc-1')).toBe(false);
  });

  it('returns false for REJECTED docs even when already viewed', () => {
    expect(canApproveDocument('REJECTED', true, new Set(['doc-1']), 'doc-1')).toBe(false);
  });

  it('treats status case-insensitively for finalized docs', () => {
    expect(canApproveDocument('verified', true, new Set(['doc-1']), 'doc-1')).toBe(false);
    expect(canApproveDocument('rejected', true, new Set(['doc-1']), 'doc-1')).toBe(false);
  });

  it('returns true when the server reports has_viewed', () => {
    expect(canApproveDocument('UPLOADED', true, new Set(), 'doc-1')).toBe(true);
  });

  it('returns true when the document id is in the session viewed set', () => {
    expect(canApproveDocument('UPLOADED', false, new Set(['doc-1']), 'doc-1')).toBe(true);
  });

  it('returns false when neither server state nor session view apply', () => {
    expect(canApproveDocument('UPLOADED', false, new Set(), 'doc-1')).toBe(false);
  });

  it('handles null and undefined statuses as non-finalized', () => {
    expect(canApproveDocument(null, true, new Set(), 'doc-1')).toBe(true);
    expect(canApproveDocument(undefined, false, new Set(['doc-1']), 'doc-1')).toBe(true);
  });

  it('handles null server state and undefined viewed set membership', () => {
    expect(canApproveDocument('UNDER_REVIEW', null, new Set(), 'doc-1')).toBe(false);
    expect(canApproveDocument('UNDER_REVIEW', undefined, new Set(['other-doc']), 'doc-1')).toBe(false);
  });
});

describe('overallTone', () => {
  it('maps APPROVED to the emerald tone classes', () => {
    expect(overallTone('APPROVED')).toBe('border-emerald-200 bg-emerald-50 text-emerald-700');
  });

  it('maps ACTION_REQUIRED to the rose tone classes', () => {
    expect(overallTone('ACTION_REQUIRED')).toBe('border-rose-200 bg-rose-50 text-rose-700');
  });

  it('maps PENDING_REVIEW to the amber tone classes', () => {
    expect(overallTone('PENDING_REVIEW')).toBe('border-amber-200 bg-amber-50 text-amber-700');
  });

  it('falls back to amber for INCOMPLETE', () => {
    expect(overallTone('INCOMPLETE')).toBe('border-amber-200 bg-amber-50 text-amber-700');
  });

  it('falls back to amber for unknown and undefined values', () => {
    expect(overallTone('WEIRD')).toBe('border-amber-200 bg-amber-50 text-amber-700');
    expect(overallTone(null)).toBe('border-amber-200 bg-amber-50 text-amber-700');
    expect(overallTone(undefined)).toBe('border-amber-200 bg-amber-50 text-amber-700');
  });

  it('handles lowercase input', () => {
    expect(overallTone('approved')).toBe('border-emerald-200 bg-emerald-50 text-emerald-700');
    expect(overallTone('action_required')).toBe('border-rose-200 bg-rose-50 text-rose-700');
  });
});

describe('overallLabel', () => {
  it('maps APPROVED to Approved', () => {
    expect(overallLabel('APPROVED')).toBe('Approved');
  });

  it('maps ACTION_REQUIRED to Action Required', () => {
    expect(overallLabel('ACTION_REQUIRED')).toBe('Action Required');
  });

  it('maps PENDING_REVIEW to Under Review', () => {
    expect(overallLabel('PENDING_REVIEW')).toBe('Under Review');
  });

  it('falls back to Incomplete for INCOMPLETE', () => {
    expect(overallLabel('INCOMPLETE')).toBe('Incomplete');
  });

  it('falls back to Incomplete for unknown and undefined values', () => {
    expect(overallLabel('WEIRD')).toBe('Incomplete');
    expect(overallLabel(null)).toBe('Incomplete');
    expect(overallLabel(undefined)).toBe('Incomplete');
  });

  it('handles lowercase input', () => {
    expect(overallLabel('approved')).toBe('Approved');
    expect(overallLabel('action_required')).toBe('Action Required');
    expect(overallLabel('pending_review')).toBe('Under Review');
  });
});

describe('rejectedDocumentCount', () => {
  it('counts only REJECTED documents case-insensitively', () => {
    const docs = [
      { status: 'REJECTED' },
      { status: 'VERIFIED' },
      { status: 'rejected' },
      { status: 'UPLOADED' },
      { status: 'Rejected' },
    ];
    expect(rejectedDocumentCount(docs)).toBe(3);
  });

  it('returns 0 for an empty array', () => {
    expect(rejectedDocumentCount([])).toBe(0);
  });

  it('returns 0 when statuses are null or undefined', () => {
    expect(rejectedDocumentCount([{ status: null }, { status: undefined }, {}])).toBe(0);
  });
});
