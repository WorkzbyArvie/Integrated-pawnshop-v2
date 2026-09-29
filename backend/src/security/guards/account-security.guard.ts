import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthUserService } from '../../common/auth-user.service';
import { CREDENTIAL_ERROR_CODES } from '../security.service';
import {
  CredentialStateService,
  CredentialStateUnavailableError,
  CredentialStateView,
} from '../credential-state.service';
import {
  MFA_ASSERTION_ERROR_CODES,
  MFA_ASSERTION_HEADER,
  MfaAssertionService,
} from '../mfa-assertion.service';

const CREDENTIAL_STATE_UNAVAILABLE = CREDENTIAL_ERROR_CODES.STATE_UNAVAILABLE;

@Injectable()
export class AccountSecurityGuard implements CanActivate {
  private readonly logger = new Logger(AccountSecurityGuard.name);

  private static readonly ALLOWED_ROUTES = new Set([
    'GET /security/credential-status',
    'POST /security/change-password',
    'POST /security/recovery/complete',
    'GET /security/activity',
    'GET /security/activity-log',
    'GET /auth/credential-status',
    'POST /auth/logout',
    'POST /auth/sign-out',
    'POST /security/mfa/enable-challenge',
    'POST /security/mfa/verify',
    'POST /security/mfa/login-challenge',
    'POST /security/mfa/disable',
  ]);

  constructor(
    private readonly reflector: Reflector,
    private readonly credentialState: CredentialStateService,
    private readonly authUser: AuthUserService,
    private readonly mfaAssertions: MfaAssertionService,
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
      this.logger.warn('Credential state read skipped: request profile is unresolved');
      throw this.unavailable();
    }

    const state = await this.readRequiredState(userId);

    if (state.mustChangePassword) {
      throw new ForbiddenException({
        success: false,
        error: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must set a new password before continuing.',
      });
    }

    if (state.mfaEnabled) {
      await this.requireSessionAssertion(request, userId);
    }

    return true;
  }

  private async readRequiredState(userId: string): Promise<CredentialStateView> {
    try {
      const state = await this.credentialState.getRequired(userId);
      if (
        !state ||
        typeof state.mustChangePassword !== 'boolean' ||
        typeof state.mfaEnabled !== 'boolean'
      ) {
        throw new CredentialStateUnavailableError('missing');
      }
      return state;
    } catch (error) {
      const kind =
        error instanceof CredentialStateUnavailableError
          ? error.kind
          : 'dependency';
      this.logger.warn(
        `Credential state ${kind} for profile ${userId}; denying request`,
      );
      throw this.unavailable();
    }
  }

  private async requireSessionAssertion(
    request: {
      headers?: Record<string, string | string[] | undefined>;
    },
    userId: string,
  ): Promise<void> {
    const presented = this.readAssertionHeader(request);

    let sessionId = '';
    try {
      const context = await this.authUser.getAuthContextFromAuthHeader(
        request.headers?.authorization as string | undefined,
      );
      sessionId = context.sessionId;
    } catch {
      this.logger.warn(
        `MFA session context unavailable for profile ${userId}; denying request`,
      );
      throw this.mfaRequired('session');
    }

    let valid = false;
    try {
      valid = await this.mfaAssertions.validate(userId, sessionId, presented);
    } catch {
      valid = false;
    }

    if (!valid) {
      this.logger.warn(
        `MFA assertion rejected for profile ${userId}; denying request`,
      );
      throw this.mfaRequired('assertion');
    }
  }

  private readAssertionHeader(request: {
    headers?: Record<string, string | string[] | undefined>;
  }): string | undefined {
    const headers = request.headers || {};
    const entry = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === MFA_ASSERTION_HEADER,
    );
    const value = entry?.[1];
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private mfaRequired(reason: 'session' | 'assertion'): ForbiddenException {
    return new ForbiddenException({
      success: false,
      error: MFA_ASSERTION_ERROR_CODES.VERIFICATION_REQUIRED,
      reason,
      message:
        reason === 'session'
          ? 'Your session could not be verified. Sign in again.'
          : 'Multi-factor verification is required for this account.',
    });
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      success: false,
      error: CREDENTIAL_STATE_UNAVAILABLE,
      message: 'Credential state is unavailable',
    });
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
