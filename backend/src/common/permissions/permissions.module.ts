import { Module, Global } from '@nestjs/common';
import { PermissionService } from './permissions.service';

@Global()
@Module({
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionsModule {}
