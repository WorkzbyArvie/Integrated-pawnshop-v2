import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';

export const OTHER_REASON = 'OTHER';

export type DeclineReason = { code: string; text: string } | null;

/**
 * Standard reason sets. A free-text box alone lets a reviewer type "no", and
 * the audit trail then carries a reason nobody can count or filter on. The
 * other option is the only escape hatch, and it is the only one that requires
 * typing.
 */
export const DECLINE_REASON_SETS = {
  APPRAISAL: [
    { code: 'UNVERIFIED_AUTHENTICITY', text: 'Authenticity cannot be verified' },
    { code: 'APPRAISAL_VALUE_TOO_HIGH', text: 'Appraised value too high' },
    { code: 'LOAN_AMOUNT_TOO_HIGH', text: 'Recommended loan too high' },
    { code: 'DOCUMENTS_INSUFFICIENT', text: 'Documents insufficient' },
    { code: 'ITEM_CONDITION_POOR', text: 'Item condition below standard' },
    { code: 'RISK_SCORE_TOO_HIGH', text: 'Risk score above tolerance' },
  ],
  REDEMPTION: [
    { code: 'IDENTITY_MISMATCH', text: 'Identity does not match the pawner' },
    { code: 'PAYMENT_INSUFFICIENT', text: 'Payment tendered is short' },
    { code: 'TICKET_NOT_FOUND', text: 'Ticket not found or already settled' },
    { code: 'BEYOND_GRACE_PERIOD', text: 'Beyond the grace period' },
    { code: 'OWNER_DISCRETION', text: 'Declined at owner discretion' },
  ],
  LISTING_EDIT: [
    { code: 'MISLEADING_DESCRIPTION', text: 'Description misrepresents the item' },
    { code: 'PROVENANCE_INSUFFICIENT', text: 'Provenance cannot be established' },
    { code: 'CONDITION_MISREPRESENTED', text: 'Condition misrepresented' },
    { code: 'DUPLICATE_LISTING', text: 'Duplicate listing' },
    { code: 'DISCLOSURE_INCOMPLETE', text: 'Required disclosure missing' },
  ],
  KYC: [
    { code: 'DOCUMENT_ILLEGIBLE', text: 'Document illegible or unreadable' },
    { code: 'DOCUMENT_EXPIRED', text: 'Document expired' },
    { code: 'DOCUMENT_TAMPERED', text: 'Document appears altered' },
    { code: 'NAME_MISMATCH', text: 'Name does not match the account' },
    { code: 'FACE_MISMATCH', text: 'Face does not match the ID' },
    { code: 'DOCUMENT_TYPE_INVALID', text: 'Unsupported document type' },
  ],
  COMPLIANCE_DOCUMENT: [
    { code: 'DOCUMENT_EXPIRED', text: 'Document expired' },
    { code: 'DOCUMENT_ILLEGIBLE', text: 'Document illegible or unreadable' },
    { code: 'WRONG_DOCUMENT_TYPE', text: 'Wrong document type submitted' },
    { code: 'REGISTRATION_MISMATCH', text: 'Registration details do not match' },
    { code: 'BUSINESS_DETAILS_INCOMPLETE', text: 'Business details incomplete' },
  ],
  OWNER_REGISTRATION: [
    { code: 'BUSINESS_NOT_REGISTERED', text: 'Business registration not verifiable' },
    { code: 'DOCUMENT_EXPIRED', text: 'Document expired' },
    { code: 'INSUFFICIENT_INFORMATION', text: 'Insufficient information submitted' },
    { code: 'POLICY_VIOLATION', text: 'Violates platform policy' },
  ],
} as const;

export type DeclineReasonSet = keyof typeof DECLINE_REASON_SETS;

export function formatDeclineReason(reason: DeclineReason): string {
  if (!reason) return '';
  if (reason.code === OTHER_REASON) return reason.text;
  for (const options of Object.values(DECLINE_REASON_SETS)) {
    const preset = (options as readonly { code: string; text: string }[]).find(
      (option) => option.code === reason.code,
    );
    // The label is resolved from the code, so a stored reason reads as prose
    // even if the label was later reworded. The picker's own `text` is the
    // same string, so appending it here only produced "X — X".
    if (preset) return preset.text;
  }
  return reason.text;
}

/** A decline is only submittable once a reason exists and, for "other", a typed explanation. */
export function isDeclineReasonComplete(reason: DeclineReason): boolean {
  if (!reason) return false;
  return reason.text.trim().length > 0;
}

export function DeclineReasonPicker({
  value,
  onChange,
  options,
  id = 'decline-reason',
  disabled = false,
}: {
  value: DeclineReason;
  onChange: (reason: DeclineReason) => void;
  options: readonly { code: string; text: string }[];
  id?: string;
  disabled?: boolean;
}) {
  const isOther = value?.code === OTHER_REASON;

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-[10px] font-black uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        Reason (required)
      </label>
      <Select
        value={value?.code ?? ''}
        onValueChange={(code) => {
          if (code === OTHER_REASON) {
            onChange({ code: OTHER_REASON, text: value?.code === OTHER_REASON ? value.text : '' });
            return;
          }
          const preset = options.find((option) => option.code === code);
          onChange({ code, text: preset?.text ?? '' });
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          data-testid={`${id}-trigger`}
          className="w-full bg-[#1C1C26] border-[rgba(217,69,69,0.25)] text-[#F5F0E8] text-xs focus:ring-2 focus:ring-[#D44545]/40"
        >
          <SelectValue placeholder="Select a reason…" />
        </SelectTrigger>
        <SelectContent className="bg-[#1C1C26] border-[rgba(201,160,92,0.2)]">
          {options.map((option) => (
            <SelectItem
              key={option.code}
              value={option.code}
              className="text-xs text-[#F5F0E8] focus:bg-[#C9A05C]/15"
            >
              {option.text}
            </SelectItem>
          ))}
          <SelectItem
            value={OTHER_REASON}
            className="text-xs text-[#F5F0E8] focus:bg-[#C9A05C]/15"
          >
            Other (specify below)
          </SelectItem>
        </SelectContent>
      </Select>
      {isOther && (
        <Textarea
          data-testid={`${id}-custom`}
          value={value.text}
          onChange={(event) => onChange({ code: OTHER_REASON, text: event.target.value })}
          placeholder="Explain the reason (required)"
          rows={2}
          disabled={disabled}
          className="bg-[#1C1C26] border-[rgba(217,69,69,0.25)] text-[#F5F0E8] placeholder:text-[#8A8279] focus:ring-2 focus:ring-[#D44545]/40 text-xs"
        />
      )}
    </div>
  );
}

export default DeclineReasonPicker;
