-- Add review permissions for existing environments where the baseline
-- migration was already applied before review.* entries were added.
-- Fresh installs already get these via 20260731120000_v2_schema_baseline.

INSERT INTO permissions (name, "group")
VALUES
  ('review.create', 'review'),
  ('review.view', 'review'),
  ('review.moderate', 'review')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT v.role, p.id
FROM (VALUES
  ('SUPER_ADMIN', 'review.moderate'),
  ('OWNER', 'review.create'),
  ('OWNER', 'review.view')
) AS v(role, permission_name)
JOIN permissions p ON p.name = v.permission_name
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role = v.role AND rp.permission_id = p.id
);