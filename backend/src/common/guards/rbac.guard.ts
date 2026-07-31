import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';
import { AuthUserService } from '../auth-user.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/requires-permission.decorator';
import { PermissionService } from '../permissions/permissions.service';

const SUPER_ADMIN = 'SUPER_ADMIN';
const LEGACY_ROLES = new Set([
  'CASHIER_TELLER',
  'APPRAISER',
  'INVENTORY_CUSTODIAN',
  'AUDITOR',
]);

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private authUser: AuthUserService,
    private permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;

    let userId: string;
    try {
      userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
    } catch {
      throw new UnauthorizedException(
        'Invalid or missing authentication token',
      );
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true, staffType: true, pawnshopId: true },
    });

    if (!profile) {
      throw new UnauthorizedException('User profile not found');
    }

    const userRole = profile.role;
    const legacyRole = LEGACY_ROLES.has(userRole);
    const effectiveStaffType = legacyRole
      ? profile.staffType ?? userRole
      : profile.staffType;
    const baseRole = legacyRole ? 'STAFF' : userRole;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const setUser = () => {
      request.user = {
        id: userId,
        role: userRole,
        staffType: effectiveStaffType,
        pawnshopId: profile.pawnshopId,
      };
    };

    if ((!requiredRoles || requiredRoles.length === 0) &&
        (!requiredPermissions || requiredPermissions.length === 0)) {
      setUser();
      return true;
    }

    if (userRole === SUPER_ADMIN) {
      setUser();
      return true;
    }

    if (requiredPermissions && requiredPermissions.length > 0) {
      const effective =
        await this.permissionService.resolveEffectivePermissions(
          baseRole,
          effectiveStaffType,
        );
      if (requiredPermissions.every((permission) => effective.has(permission as never))) {
        setUser();
        return true;
      }
    }

    if (requiredRoles && requiredRoles.includes(userRole)) {
      setUser();
      return true;
    }

    throw new ForbiddenException(
      `Access denied. Required role(s): ${requiredRoles?.join(', ') ?? 'none'}. ` +
        `Required permission(s): ${requiredPermissions?.join(', ') ?? 'none'}. Your role: ${userRole}`,
    );
  }
}
