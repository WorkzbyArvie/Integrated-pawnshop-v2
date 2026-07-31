import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PermissionName } from './permissions.const';

@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEffectivePermissions(
    role: string,
    staffType?: string | null,
  ): Promise<Set<PermissionName>> {
    const roles = staffType ? [role, staffType] : [role];
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { in: roles } },
      select: { permission: { select: { name: true } } },
    });
    return new Set<PermissionName>(
      rows.map((row) => row.permission.name as PermissionName),
    );
  }
}
