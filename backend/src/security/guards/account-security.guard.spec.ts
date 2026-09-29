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
import { AuthUserService } from '../../common/auth-user.service';
import { MfaAssertionService } from '../mfa-assertion.service';

const COMPLIANT = { mustChangePassword: false, mfaEnabled: false };
const FORCED = { mustChangePassword: true, mfaEnabled: false };
const MFA_ENABLED = { mustChangePassword: false, mfaEnabled: true };
const FORCED_AND_MFA = { mustChangePassword: true, mfaEnabled: true };
const CURRENT_SESSION = { userId: 'profile-1', sessionId: 'session-current' };

describe('AccountSecurityGuard', () => {
  let request: {
    method: string;
    path: string;
    originalUrl?: string;
    user?: { id: string };
    headers?: Record<string, string | string[]>;
  };
  let metadata: Record<string, unknown>;
  let credentialState: { getRequired: jest.Mock };
  let authUser: { getAuthContextFromAuthHeader: jest.Mock };
  let assertions: { validate: jest.Mock };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };

  beforeEach(() => {
    request = {
      method: 'GET',
      path: '/analytics/summary',
      user: { id: 'profile-1' },
      headers: { authorization: 'Bearer session-token' },
    };
    metadata = {};
    credentialState = { getRequired: jest.fn() };
    authUser = { getAuthContextFromAuthHeader: jest.fn() };
    assertions = { validate: jest.fn() };
    authUser.getAuthContextFromAuthHeader.mockResolvedValue(CURRENT_SESSION);
    assertions.validate.mockResolvedValue(false);
  });

  const buildGuard = () =>
    new AccountSecurityGuard(
      reflector,
      credentialState as unknown as CredentialStateService,
      authUser as unknown as AuthUserService,
      assertions as unknown as MfaAssertionService,
    );

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
    credentialState.getRequired.mockResolvedValue(FORCED);

    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(credentialState.getRequired).not.toHaveBeenCalled();
  });

  it('denies a protected route with PASSWORD_CHANGE_REQUIRED', async () => {
    credentialState.getRequired.mockResolvedValue(FORCED);

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
    request.path = '/security/mfa/enable';
    credentialState.getRequired.mockResolvedValue(FORCED);

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
      ['GET', '/security/mfa/enable-challenge'],
      ['GET', '/security/mfa/login-challenge'],
      ['PUT', '/security/mfa/disable'],
      ['DELETE', '/security/mfa/verify'],
      ['POST', '/security/mfa/verify/extra'],
      ['POST', '/security/mfa/enable'],
      ['GET', '/security/credential-status/extra'],
      ['GET', '/analytics/summary'],
    ])('denies %s %s because the method and path must both match', async (method, path) => {
      request.method = method;
      request.path = path;
      credentialState.getRequired.mockResolvedValue(FORCED);

      await expect(buildGuard().canActivate(context as never)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('tolerates a trailing slash on an allowlisted read', async () => {
      request.method = 'GET';
      request.path = '/security/credential-status/';
      credentialState.getRequired.mockResolvedValue(FORCED);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });

    it('ignores the query string when matching the path', async () => {
      request.method = 'GET';
      request.path = '/security/activity?page=2';
      credentialState.getRequired.mockResolvedValue(FORCED);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });

    it('falls back to the raw url when express has not resolved a path yet', async () => {
      request.method = 'GET';
      request.path = '';
      request.originalUrl = '/security/activity?page=2';
      credentialState.getRequired.mockResolvedValue(FORCED);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    });

    it.each([
      ['GET', '/auth/credential-status'],
      ['POST', '/auth/logout'],
      ['POST', '/auth/sign-out'],
    ])('keeps the sign-out and status infrastructure path %s %s reachable', async (method, path) => {
      request.method = method;
      request.path = path;
      credentialState.getRequired.mockResolvedValue(FORCED);

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

    it.each([
      ['a state row without the MFA flag', { mustChangePassword: false }],
      ['a state row with a non-boolean MFA flag', {
        mustChangePassword: false,
        mfaEnabled: 'false',
      }],
      ['a state row with a null MFA flag', { mustChangePassword: false, mfaEnabled: null }],
    ])('denies %s rather than guessing that MFA is off', async (_label, state) => {
      credentialState.getRequired.mockResolvedValue(state);

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'CREDENTIAL_STATE_UNAVAILABLE' }),
      });
      expect(authUser.getAuthContextFromAuthHeader).not.toHaveBeenCalled();
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('denies a state read that times out', async () => {
      credentialState.getRequired.mockRejectedValue(new Error('query timeout'));

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'CREDENTIAL_STATE_UNAVAILABLE' }),
      });
    });

    it('allows a compliant state through', async () => {
      credentialState.getRequired.mockResolvedValue(COMPLIANT);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
      expect(credentialState.getRequired).toHaveBeenCalledWith('profile-1');
      expect(assertions.validate).not.toHaveBeenCalled();
    });
  });

  describe('session-bound MFA enforcement', () => {
    it('allows a protected operation with a valid current-session assertion', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'valid-assertion',
      };
      assertions.validate.mockResolvedValue(true);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
      expect(authUser.getAuthContextFromAuthHeader).toHaveBeenCalledWith(
        'Bearer session-token',
      );
      expect(assertions.validate).toHaveBeenCalledWith(
        'profile-1',
        'session-current',
        'valid-assertion',
      );
    });

    it('denies an MFA-enabled account with no assertion header', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'MFA_VERIFICATION_REQUIRED',
          reason: 'assertion',
        }),
      });
      expect(assertions.validate).toHaveBeenCalledWith(
        'profile-1',
        'session-current',
        undefined,
      );
    });

    it('distinguishes an unresolvable session from a rejected assertion', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      authUser.getAuthContextFromAuthHeader.mockRejectedValue(
        new Error('no session'),
      );

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'MFA_VERIFICATION_REQUIRED',
          reason: 'session',
        }),
      });
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('denies an assertion that was issued for another session', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'replayed-assertion',
      };
      assertions.validate.mockResolvedValue(false);

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'MFA_VERIFICATION_REQUIRED' }),
      });
      expect(assertions.validate).toHaveBeenCalledWith(
        'profile-1',
        'session-current',
        'replayed-assertion',
      );
    });

    it('denies an expired assertion', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'expired-assertion',
      };
      assertions.validate.mockResolvedValue(false);

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'MFA_VERIFICATION_REQUIRED' }),
      });
    });

    it('reads the assertion header case-insensitively', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'X-MFA-Assertion': 'valid-assertion',
      };
      assertions.validate.mockResolvedValue(true);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
      expect(assertions.validate).toHaveBeenCalledWith(
        'profile-1',
        'session-current',
        'valid-assertion',
      );
    });

    it('denies a repeated assertion header instead of guessing', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': ['first', 'second'],
      };

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'MFA_VERIFICATION_REQUIRED' }),
      });
    });

    it('denies when the session context cannot be validated', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'valid-assertion',
      };
      authUser.getAuthContextFromAuthHeader.mockRejectedValue(
        new Error('Token is not bound to an active session'),
      );

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'MFA_VERIFICATION_REQUIRED' }),
      });
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('fails closed when assertion validation throws', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'valid-assertion',
      };
      assertions.validate.mockRejectedValue(new Error('database unavailable'));

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'MFA_VERIFICATION_REQUIRED' }),
      });
    });

    it('keeps forced-change precedence ahead of the MFA decision', async () => {
      credentialState.getRequired.mockResolvedValue(FORCED_AND_MFA);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'valid-assertion',
      };

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'PASSWORD_CHANGE_REQUIRED' }),
      });
      expect(authUser.getAuthContextFromAuthHeader).not.toHaveBeenCalled();
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('never puts the presented assertion in the denial payload', async () => {
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);
      request.headers = {
        authorization: 'Bearer session-token',
        'x-mfa-assertion': 'secret-assertion-value',
      };
      assertions.validate.mockResolvedValue(false);

      const denial = await buildGuard()
        .canActivate(context as never)
        .then(() => null)
        .catch((error: { response: unknown }) => error.response);

      expect(JSON.stringify(denial)).not.toContain('secret-assertion-value');
    });

    it.each([
      ['POST', '/security/mfa/enable-challenge'],
      ['POST', '/security/mfa/verify'],
      ['POST', '/security/mfa/login-challenge'],
      ['POST', '/security/mfa/disable'],
    ])('keeps the MFA recovery path %s %s reachable while MFA is on', async (method, path) => {
      request.method = method;
      request.path = path;
      credentialState.getRequired.mockResolvedValue(MFA_ENABLED);

      await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
      expect(credentialState.getRequired).not.toHaveBeenCalled();
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('keeps the whole MFA lifecycle reachable while forced and MFA-enabled', async () => {
      credentialState.getRequired.mockResolvedValue(FORCED_AND_MFA);

      for (const [method, path] of [
        ['POST', '/security/mfa/enable-challenge'],
        ['POST', '/security/mfa/verify'],
        ['POST', '/security/mfa/login-challenge'],
        ['POST', '/security/mfa/disable'],
      ] as const) {
        request.method = method;
        request.path = path;

        await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
      }

      expect(credentialState.getRequired).not.toHaveBeenCalled();
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('still denies every other route with the forced error before the MFA error', async () => {
      credentialState.getRequired.mockResolvedValue(FORCED_AND_MFA);

      await expect(buildGuard().canActivate(context as never)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'PASSWORD_CHANGE_REQUIRED' }),
      });
      expect(assertions.validate).not.toHaveBeenCalled();
    });

    it('reports credential state unavailability ahead of both credential errors', async () => {
      request.user = undefined;

      const denial = await buildGuard()
        .canActivate(context as never)
        .then(() => null)
        .catch((error: { response: unknown }) => error.response);

      expect(denial).toMatchObject({
        error: 'CREDENTIAL_STATE_UNAVAILABLE',
      });
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
