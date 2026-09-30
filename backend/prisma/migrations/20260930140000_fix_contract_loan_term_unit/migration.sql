-- The loan contract printed "Loan Term: 30 days months".
--
-- `loan-contract.service.ts` sets `loanTerm` to `${toTermDays(...)} days`, so the
-- value already carries its unit, and the template appended a second one. The
-- default in `contract-template.service.ts` is corrected, but that service only
-- seeds when the table is empty (`if (count > 0) return`), so the row already in
-- every live environment still renders the stray "months".
--
-- A targeted string replacement, not a content overwrite: `ensureDefaultTemplates`
-- never overwrites an existing template, so shops that have customised their
-- wording keep it. Only the duplicated unit is removed.

UPDATE contract_templates
SET content = replace(content, '{{loanTerm}} months', '{{loanTerm}}'),
    "updated_at" = now()
WHERE type = 'LOAN_CONTRACT'
  AND content LIKE '%{{loanTerm}} months%';
