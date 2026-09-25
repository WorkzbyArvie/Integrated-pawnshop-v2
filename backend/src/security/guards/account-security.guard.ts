import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { CredentialStateService } from '../credential-state.service';

const CREDENTIAL_STATE_UNAVAILABLE = 'CREDENTIAL_STATE_UNAVAILABLE';

@Injectable()
export class AccountSecurityGuard implements CanActivate {
  private static readonly ALLOWED_ROUTES = new Set([
    'GET /security/credential-status',
    'POST /security/change-password',
    'POST /security/recovery/complete',
    'GET /security/activity',
    'GET /security/activity-log',
    'GET /auth/credential-status',
    'POST /auth/logout',
    'POST /auth/sign-out',
  ]);

  constructor(
    private readonly reflector: Reflector,
    private readonly credentialState: CredentialStateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const route = this.getRouteKey(request);
    if (AccountSecurityGuard.ALLOWED_ROUTES.has(route)) return true;

    const userId = request.user?.id;
    if (!userId) {
      throw new ServiceUnavailableException({
        success: false,
        error: CREDENTIAL_STATE_UNAVAILABLE,
        message: 'Credential state is unavailable',
      });
    }

    try {
      const state = await this.credentialState.getRequired(userId);
      if (!state) {
        throw new Error('Credential state is unavailable');
      }
      if (state.mustChangePassword) {
        throw new ForbiddenException({
          success: false,
          error: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must set a new password before continuing.',
        });
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException({
        success: false,
        error: CREDENTIAL_STATE_UNAVAILABLE,
        message: 'Credential state is unavailable',
      });
    }
  }

  private getRouteKey(request: {
    method?: string;
    path?: string;
    originalUrl?: string;
    url?: string;
  }): string {
    const method = String(request.method || '').toUpperCase();
    const path = String(
      request.path || request.originalUrl || request.url || '',
    ).split('?')[0];
    const normalizedPath = path.length > 1 ? path.replace(/\/$/, '') : path;
    return `${method} ${normalizedPath}`;
  }
}
