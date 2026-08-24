-- AddApproverRole: dedicated approver for loans + redemptions
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'APPROVER';

INSERT INTO role_permissions (role, permission_id)
SELECT 'APPROVER', p.id
FROM permissions p
WHERE p.name IN (
  'pawn_ticket.view',
  'pawn_ticket.approve',
  'pawn_ticket.decline',
  'approval.view_queue',
  'approval.approve_appraisal',
  'approval.approve_redemption'
)
ON CONFLICT DO NOTHING;
