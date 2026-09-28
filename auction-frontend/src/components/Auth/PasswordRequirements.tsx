import type { PasswordRuleKey } from '../../lib/passwordPolicy';
import {
  PASSWORD_REQUIREMENTS_HEADING,
  PASSWORD_REQUIREMENTS_MET,
  PASSWORD_RULE_LABELS,
  PASSWORD_RULE_ORDER,
  evaluatePasswordRules,
} from '../../lib/passwordPolicy';
import { CheckCircle, Circle } from '@phosphor-icons/react';

export interface PasswordRequirementsProps {
  value: string;
  id: string;
}

/**
 * Accessible per-rule password checklist.
 *
 * This is a requirements list, not a strength score: it states which server
 * policy rules are currently met and never implies a password is secure beyond
 * that policy (D-01). Every rule is exposed as text, not icon alone.
 */
export function PasswordRequirements({ value, id }: PasswordRequirementsProps) {
  const results = evaluatePasswordRules(value);
  const allMet = PASSWORD_RULE_ORDER.every((key) => results[key]);
  const touched = value.length > 0;

  return (
    <div className="flex flex-col gap-2" id={id}>
      <p
        className="text-[12px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {PASSWORD_REQUIREMENTS_HEADING}
      </p>
      <ul className="flex flex-col gap-1.5" aria-live="polite">
        {PASSWORD_RULE_ORDER.map((key: PasswordRuleKey) => {
          const met = results[key];
          return (
            <li
              key={key}
              className="flex items-center gap-2 text-[13px]"
              style={{ color: met ? 'var(--green)' : 'var(--text-muted)' }}
              data-rule={key}
              data-met={met ? 'true' : 'false'}
            >
              {met ? (
                <CheckCircle size={14} aria-hidden="true" className="shrink-0" />
              ) : (
                <Circle size={14} aria-hidden="true" className="shrink-0" />
              )}
              <span>{PASSWORD_RULE_LABELS[key]}</span>
            </li>
          );
        })}
      </ul>
      {touched && allMet && (
        <p role="status" className="text-[13px]" style={{ color: 'var(--green)' }}>
          {PASSWORD_REQUIREMENTS_MET}
        </p>
      )}
    </div>
  );
}

export default PasswordRequirements;
