-- Guard GET /loan/contracts/:contractId/pdf with the new `contract.view`
-- permission.
--
-- The permission was added to `permissions.const.ts` and to the baseline
-- migration, but the baseline has already been applied in every live
-- environment, so editing it changed nothing there. `PermissionService`
-- resolves effective permissions from the `role_permissions` table, so an
-- owner with no row for `contract.view` was refused with:
--
--   Access denied. Required permission(s): contract.view. Your role: OWNER
--
-- This is the same shape as 20260910100000_add_review_permissions, which
-- exists for the same reason. Fresh installs get the row from the baseline too;
-- this makes it idempotent for everyone else.
--
-- Granted to exactly the roles that already hold `contract.sign`: whoever may
-- sign a contract may read the document they signed.

INSERT INTO permissions (name, "group")
VALUES ('contract.view', 'contract')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT v.role, p.id
FROM (VALUES
  ('OWNER', 'contract.view'),
  ('MANAGER', 'contract.view'),
  ('STAFF', 'contract.view'),
  ('CASHIER_TELLER', 'contract.view'),
  ('APPRAISER', 'contract.view')
) AS v(role, permission_name)
JOIN permissions p ON p.name = v.permission_name
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role = v.role AND rp.permission_id = p.id
);
