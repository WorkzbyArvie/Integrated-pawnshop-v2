import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log';
export const AUDIT_ACTION_KEY = 'audit_action';

export const AuditLog = (action: string) => {
  return SetMetadata(AUDIT_ACTION_KEY, action);
};
