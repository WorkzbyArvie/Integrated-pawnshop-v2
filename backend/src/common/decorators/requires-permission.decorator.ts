import { SetMetadata } from '@nestjs/common';

import type { PermissionName } from '../permissions/permissions.const';

export const PERMISSIONS_KEY = 'permissions';
export const RequiresPermission = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
