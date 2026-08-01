import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma.service';
import { AuthUserService } from '../auth-user.service';

@Injectable()
export class PawnshopGuard implements CanActivate {
  private readonly logger = new Logger(PawnshopGuard.name);

  private readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private readonly EXEMPT_PREFIXES = [
    '/auction/listings',
    '/auction/bidders/tos-status',
    '/auction/bidders/accept-tos',
    '/auction/bidders/my-bids',
    '/auction/bidders/my-winnings',
    '/auction/bidders/me/',
    '/contracts',
    '/auth',
    '/branding',
    '/compliance',
    '/subscriptions/plans',
    '/subscriptions/webhook',
    '/tenant-governance/client-registrations',
    '/tenant-governance/branding',
    '/tenant-governance/pawnshops',
    '/tenant-governance/branches',
    '/tenant-governance/support-chat',
    '/tenant-governance/analytics',
    '/tenant-governance/invitations',
    '/tenant-governance/subscriptions',
    '/analytics/branch/',
    '/analytics/branch-stats',
    '/notifications/user/',
    '/pawn-tickets/pending-approval',
    '/pawnshops',
    '/security',
    '/profile',
  ];

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private authUser: AuthUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const pathName = request.path || '';

    if (request.method === 'OPTIONS') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.EXEMPT_PREFIXES.some((prefix) => pathName.startsWith(prefix))) {
      return true;
    }

    const authHeader = request.headers?.authorization as string | undefined;
    try {
      const userId = await this.authUser.getUserIdFromAuthHeader(authHeader);
      const profile = await this.prisma.profile.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (profile && profile.role === 'SUPER_ADMIN') {
        return true;
      }
    } catch {
      // If auth fails, fall through to pawnshop-id check below
    }

    const pawnshopId = request.headers['pawnshop-id'] as string;

    if (!pawnshopId) {
      throw new BadRequestException(
        'Missing pawnshop-id header. All requests must include a valid pawnshop-id.',
      );
    }

    if (!this.UUID_REGEX.test(pawnshopId)) {
      throw new BadRequestException(
        'Invalid pawnshop-id header. Must be a valid UUID.',
      );
    }

    return true;
  }
}
