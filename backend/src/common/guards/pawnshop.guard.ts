import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class PawnshopGuard implements CanActivate {
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
    '/tenant-governance/audit',
    '/tenant-governance/support-access',
    '/tenant-governance/onboarding',
    '/analytics/branch/',
    '/analytics/branch-stats',
    '/notifications',
    '/pawn-tickets/pending-approval',
    '/approval-queue',
    '/pawnshops',
    '/security',
    '/profile',
    '/reviews',
  ];

  constructor(private reflector: Reflector) {}

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

    /*
     * SUPER_ADMIN is platform-scoped and belongs to no tenant, so it sends no
     * `pawnshop-id` — `App.tsx` explicitly clears `active_pawnshop_id` for that
     * role. Requiring one here made the entire platform surface unusable for the
     * only role that operates it: every call answered 400 "Missing pawnshop-id
     * header", and the compliance and tenant-governance tabs rendered blank.
     *
     * This is not a new exemption. The tenant middleware in `main.ts` has
     * already made exactly this decision, before the header check and before the
     * cross-tenant comparison that follows it:
     *
     *     if (normalizedRole === 'SUPER_ADMIN') { next(); return; }
     *
     * The guard was simply stricter than the middleware in front of it, which
     * made the two disagree about who may use the platform. Tenant isolation is
     * still enforced where it matters — RBAC on every route, and the service
     * layer's own tenant resolution — and this guard only ever validated header
     * presence and format.
     */
    const actorRole = String(
      (request as any).actor?.role ?? (request as any).user?.role ?? '',
    )
      .toUpperCase()
      // Same normalisation `main.ts` applies before it makes the same decision,
      // so the two agree on what `Super Admin`, `super_admin` and `SUPER-ADMIN`
      // all mean. Without the replace, a hyphenated role reached the platform
      // as one identity and the guard rejected it as another.
      .replace(/[\s-]+/g, '_');

    if (actorRole === 'SUPER_ADMIN') {
      return true;
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
