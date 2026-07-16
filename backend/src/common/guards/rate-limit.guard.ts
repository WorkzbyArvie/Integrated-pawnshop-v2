import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  THROTTLE_TTL_KEY,
  THROTTLE_LIMIT_KEY,
} from '../decorators/throttle.decorator';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly store = new Map<string, RateLimitEntry>();

  private readonly DEFAULT_TTL = 60_000;
  private readonly DEFAULT_LIMIT = 60;

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const ttl =
      this.reflector.get<number>(THROTTLE_TTL_KEY, context.getHandler()) ??
      this.DEFAULT_TTL;
    const limit =
      this.reflector.get<number>(THROTTLE_LIMIT_KEY, context.getHandler()) ??
      this.DEFAULT_LIMIT;

    const request = context.switchToHttp().getRequest();
    const key = this.buildKey(request);

    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + ttl });
      return true;
    }

    if (entry.count >= limit) {
      this.logger.warn(
        `Rate limit exceeded for ${key}: ${entry.count}/${limit}`,
      );
      throw new HttpException(
        {
          success: false,
          message: 'Too many requests. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count++;
    return true;
  }

  private buildKey(request: any): string {
    const userId = request.user?.id;
    if (userId) return `user:${userId}`;
    const ip = request.ip || request.connection?.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }
}
