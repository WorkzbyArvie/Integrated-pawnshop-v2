import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class PawnshopGuard implements CanActivate {
  private readonly logger = new Logger(PawnshopGuard.name);

  private readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private readonly EXEMPT_PREFIXES = [
    '/auction/listings',
    '/auction/payments/webhook',
    '/auth',
    '/branding',
    '/subscriptions/plans',
    '/subscriptions/webhook',
    '/tenant-governance/client-registrations',
    '/tenant-governance/branding',
    '/notifications/user/',
  ];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const pathName = request.path || '';

    if (request.method === 'OPTIONS') return true;

    if (this.EXEMPT_PREFIXES.some((prefix) => pathName.startsWith(prefix))) {
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
