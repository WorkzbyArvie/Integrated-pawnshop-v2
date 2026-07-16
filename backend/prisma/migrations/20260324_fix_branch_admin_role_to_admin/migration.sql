-- Ensure legacy branch-admin role labels map to ADMIN (not OWNER).

UPDATE "public"."profiles"
SET "role" = 'ADMIN'
WHERE UPPER(COALESCE("role", '')) IN ('BRANCH_ADMIN', 'BRANCH ADMIN', 'BRANCHADMIN');

UPDATE "public"."admin_invites"
SET "role" = 'ADMIN'
WHERE UPPER(COALESCE("role", '')) IN ('BRANCH_ADMIN', 'BRANCH ADMIN', 'BRANCHADMIN');
