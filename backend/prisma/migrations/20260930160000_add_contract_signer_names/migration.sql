-- Capture the printed name of each signer at signing time.
--
-- The contract PDF printed a signature image and a role label, but no name, so
-- the document could not say who had signed it. Resolving the name at render
-- time was rejected: a staff record can be deleted or a customer can be
-- renamed, and the contract would then print a name other than the one signed.
-- A signed contract is evidence, so the name is a snapshot on the contract row.
--
-- Additive only. Existing contracts keep NULL and fall back to the borrower
-- name already in `contract_data`; the renderer handles an absent name.

-- The table is `loan_contracts` (plural). An earlier draft of this file said
-- `loan_contract` and failed on deploy with P3018 / 42P01, `relation
-- "loan_contract" does not exist`. The model is `LoanContract`, but `@@map`
-- renames the table and the model name is not the table name. Check
-- `schema.prisma` before writing a migration.

ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS customer_signer_name TEXT,
  ADD COLUMN IF NOT EXISTS staff_signer_name TEXT;

COMMENT ON COLUMN loan_contracts.customer_signer_name IS
  'Printed name of the borrower, captured at signing time. A snapshot, not a join.';
COMMENT ON COLUMN loan_contracts.staff_signer_name IS
  'Printed name of the staff signatory, captured at signing time. A snapshot, not a join.';
