import { describe, it, expect } from 'vitest';

import {
  DECLINE_REASON_SETS,
  OTHER_REASON,
  formatDeclineReason,
  isDeclineReasonComplete,
} from '../DeclineReasonPicker';

describe('decline reasons', () => {
  it('refuses a decline with no reason at all', () => {
    expect(isDeclineReasonComplete(null)).toBe(false);
  });

  it('refuses a reason whose text is only whitespace', () => {
    expect(isDeclineReasonComplete({ code: 'DOCUMENT_EXPIRED', text: '   ' })).toBe(false);
  });

  it('accepts a chosen preset', () => {
    expect(
      isDeclineReasonComplete({ code: 'DOCUMENT_EXPIRED', text: 'Document expired' }),
    ).toBe(true);
  });

  it('refuses "other" until something is actually typed', () => {
    // Choosing "Other" and confirming immediately is the loophole: it would
    // record a decline with no explanation behind it.
    expect(isDeclineReasonComplete({ code: OTHER_REASON, text: '' })).toBe(false);
    expect(isDeclineReasonComplete({ code: OTHER_REASON, text: 'Permit is for a different entity' })).toBe(true);
  });

  it('gives every reason set a unique code within itself', () => {
    for (const [name, options] of Object.entries(DECLINE_REASON_SETS)) {
      const codes = options.map((option) => option.code);
      expect(new Set(codes).size, `${name} has duplicate codes`).toBe(codes.length);
    }
  });

  it('gives every reason set non-empty labels', () => {
    for (const [name, options] of Object.entries(DECLINE_REASON_SETS)) {
      for (const option of options) {
        expect(option.text.trim(), `${name}.${option.code} has no label`).not.toBe('');
      }
    }
  });

  it('never offers a bare "other" code that could collide with a preset', () => {
    for (const [name, options] of Object.entries(DECLINE_REASON_SETS)) {
      const codes: readonly string[] = options.map((option) => option.code);
      expect(
        codes.includes(OTHER_REASON),
        `${name} defines a code colliding with OTHER`,
      ).toBe(false);
    }
  });

  it('resolves a stored code back to its human label, not the raw code', () => {
    // The audit log is read by a panel. A row reading "DOCUMENT_EXPIRED" is
    // not an explanation.
    const formatted = formatDeclineReason({
      code: 'DOCUMENT_EXPIRED',
      text: 'Document expired',
    });
    expect(formatted).toBe('Document expired');
    expect(formatted).not.toBe('DOCUMENT_EXPIRED');
  });

  it('does not repeat the label when the picker text matches it', () => {
    // The obvious implementation joins label and text, which prints
    // "Documents insufficient — Documents insufficient".
    expect(
      formatDeclineReason({ code: 'DOCUMENTS_INSUFFICIENT', text: 'Documents insufficient' }),
    ).toBe('Documents insufficient');
  });

  it('resolves a code that appears in more than one reason set', () => {
    // DOCUMENT_EXPIRED is offered by both KYC and COMPLIANCE_DOCUMENT.
    expect(formatDeclineReason({ code: 'DOCUMENT_EXPIRED', text: 'x' })).toBe('Document expired');
  });

  it('passes a custom reason through verbatim', () => {
    expect(formatDeclineReason({ code: OTHER_REASON, text: 'Replica, not real silver' })).toBe(
      'Replica, not real silver',
    );
  });
});
