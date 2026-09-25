import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AccountSecurityGuard } from './account-security.guard';
import { CredentialStateService } from '../credential-state.service';

describe('AccountSecurityGuard', () => {
  let request: {
    method: string;
    path: string;
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
});
