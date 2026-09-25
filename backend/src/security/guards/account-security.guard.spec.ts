import 'reflect-metadata';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppModule } from '../../app.module';
import { ComplianceGuard } from '../../common/guards/compliance.guard';
import { PawnshopGuard } from '../../common/guards/pawnshop.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { SecurityModule } from '../security.module';
import { AccountSecurityGuard } from './account-security.guard';
import { CredentialStateService } from '../credential-state.service';

describe('AccountSecurityGuard', () => {
  let request: {
    method: string;
    path: string;
    originalUrl?: string;
    user?: { id: string };
  };
  let metadata: Record<string, unknown>;
  let credentialState: { getRequired: jest.Mock };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };

  beforeEach(() => {
    request = { method: 'GET', path: '/analytics/summary', user: { id: 'profile-1' } };
    metadata = {};
    credentialState = { getRequired: jest.fn() };
  });

  const buildGuard = () =>
    new AccountSecurityGuard(reflector, credentialState as unknown as CredentialStateService);

  it('allows public routes without reading state', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(credentialState.getRequired).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/security/credential-status'],
    ['POST', '/security/change-password'],
    ['POST', '/security/recovery/complete'],
    ['GET', '/security/activity'],
    ['GET', '/security/activity-log'],
  ])('allows the exact %s %s escape path while forced', async (method, path) => {
    request.method = method;
    request.path = path;
    credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(credentialState.getRequired).not.toHaveBeenCalled();
  });

  it('denies a protected route with PASSWORD_CHANGE_REQUIRED', async () => {
    credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

    await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'PASSWORD_CHANGE_REQUIRED' }),
    });
  });

  it.each([
    ['missing row', null],
    ['dependency failure', new Error('database unavailable')],
  ])('denies state %s with CREDENTIAL_STATE_UNAVAILABLE', async (_label, result) => {
    if (result instanceof Error) {
      credentialState.getRequired.mockRejectedValue(result);
    } else {
      credentialState.getRequired.mockResolvedValue(result);
    }

    await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'CREDENTIAL_STATE_UNAVAILABLE' }),
    });
  });

  it('denies a request without a resolved profile instead of assuming compliance', async () => {
    request.user = undefined;

    await expect(buildGuard().canActivate(context as never)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(credentialState.getRequired).not.toHaveBeenCalled();
  });

  it('does not allow a non-allowlisted security write', async () => {
    request.method = 'POST';
    request.path = '/security/mfa/enable-challenge';
    credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

    await expect(buildGuard().canActivate(context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('exact allowlist matching', () => {
    it.each([
      ['POST', '/security/activity'],
      ['DELETE', '/security/credential-status'],
      ['PUT', '/security/change-password'],
      ['GET', '/security/mfa/verify'],
      ['GET', '/security/credential-status/extra'],
      ['GET', '/analytics/summary'],
    ])('denies %s %s because the method and path must both match', async (method, path) => {
      request.method = method;
      request.path = path;
      credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

      await expect(buildGuard().canActivate(context as never)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('tolerates a trailing slash on an allowlisted read', async () => {
      request.method = 'GET';
      request.path = '/security/credential-status/';
      credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });

    it('ignores the query string when matching the path', async () => {
      request.method = 'GET';
      request.path = '/security/activity?page=2';
      credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });

    it('falls back to the raw url when express has not resolved a path yet', async () => {
      request.method = 'GET';
      request.path = '';
      request.originalUrl = '/security/activity?page=2';
      credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });

    it.each([
      ['GET', '/auth/credential-status'],
      ['POST', '/auth/logout'],
      ['POST', '/auth/sign-out'],
    ])('keeps the sign-out and status infrastructure path %s %s reachable', async (method, path) => {
      request.method = method;
      request.path = path;
      credentialState.getRequired.mockResolvedValue({ mustChangePassword: true });

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });
  });

  describe('fail-closed state evaluation', () => {
    it.each([
      ['a state row without the flag', {}],
      ['a state row with a non-boolean flag', { mustChangePassword: 'false' }],
      ['an undefined state', undefined],
    ])('denies %s instead of assuming compliance', async (_label, state) => {
      credentialState.getRequired.mockResolvedValue(state);

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'CREDENTIAL_STATE_UNAVAILABLE' }),
      });
    });

    it('denies a state read that times out', async () => {
      credentialState.getRequired.mockRejectedValue(new Error('query timeout'));

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'CREDENTIAL_STATE_UNAVAILABLE' }),
      });
    });

    it('allows a compliant state through', async () => {
      credentialState.getRequired.mockResolvedValue({ mustChangePassword: false });

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
      expect(credentialState.getRequired).toHaveBeenCalledWith('profile-1');
    });
  });

  describe('global registration order', () => {
    it('runs after RbacGuard and before RateLimitGuard and ComplianceGuard', () => {
      const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as {
        provide?: unknown;
        useClass?: unknown;
      }[];
      const guardOrder = providers
        .filter((provider) => provider?.provide === APP_GUARD)
        .map((provider) => provider.useClass);

      expect(guardOrder).toEqual([
        PawnshopGuard,
        RbacGuard,
        AccountSecurityGuard,
        RateLimitGuard,
        ComplianceGuard,
      ]);
    });

    it('keeps the credential state provider available to the global guard', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule)).toContain(
        SecurityModule,
      );
    });
  });
});
