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

const SUPER_ADMIN = 'SUPER_ADMIN';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private authUser: AuthUserService,
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
      select: { role: true, pawnshopId: true },
    });

    if (!profile) {
      throw new UnauthorizedException('User profile not found');
    }

    const userRole = profile.role;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      request.user = {
        id: userId,
        role: userRole,
        pawnshopId: profile.pawnshopId,
      };
      return true;
    }

    if (userRole === SUPER_ADMIN) {
      request.user = {
        id: userId,
        role: userRole,
        pawnshopId: profile.pawnshopId,
      };
      return true;
    }

    if (requiredRoles.includes(userRole)) {
      request.user = {
        id: userId,
        role: userRole,
        pawnshopId: profile.pawnshopId,
      };
      return true;
    }

    throw new ForbiddenException(
      `Access denied. Required role(s): ${requiredRoles.join(', ')}. Your role: ${userRole}`,
    );
  }
}
