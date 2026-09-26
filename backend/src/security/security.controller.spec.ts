import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import {
  THROTTLE_LIMIT_KEY,
  THROTTLE_TTL_KEY,
} from '../common/decorators/throttle.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SecurityController } from './security.controller';

const MAIN_TS = readFileSync(path.resolve(__dirname, '..', 'main.ts'), 'utf8');

type Handler = (...args: any[]) => unknown;

const read = (key: string, handler: Handler) => Reflect.getMetadata(key, handler);

describe('SecurityController', () => {
  let securityService: {
    getCredentialStatus: jest.Mock;
    changeMyPassword: jest.Mock;
    completeRecovery: jest.Mock;
    getMyActivity: jest.Mock;
    getMyActivityLog: jest.Mock;
    startMfaEnrollment: jest.Mock;
    startMfaLoginChallenge: jest.Mock;
    verifyMfaChallenge: jest.Mock;
    disableMfa: jest.Mock;
  };
  let authUserService: {
    getUserIdFromAuthHeader: jest.Mock;
    getAuthContextFromAuthHeader: jest.Mock;
  };
  let controller: SecurityController;

  const bearer = 'Bearer profile-token';
  const challengeView = {
    challengeId: '11111111-2222-4333-8444-555555555555',
    expiresAt: new Date('2026-09-10T08:10:00.000Z'),
    maskedEmail: 'ju••••@example.com',
  };
  const assertionView = {
    assertion: 'issued-assertion-value',
    expiresAt: new Date('2026-09-10T08:15:00.000Z'),
  };
  const changeBody = {
    currentPassword: 'Legacy!Passw0rd',
    newPassword: 'Str0ng!Passw0rd',
    confirmPassword: 'Str0ng!Passw0rd',
  };

  beforeEach(() => {
    securityService = {
      getCredentialStatus: jest.fn().mockResolvedValue({ mustChangePassword: false }),
      changeMyPassword: jest.fn().mockResolvedValue({ changed: true, mustChangePassword: false }),
      completeRecovery: jest.fn().mockResolvedValue({ changed: true, mustChangePassword: false }),
      getMyActivity: jest.fn().mockResolvedValue({ events: [] }),
      getMyActivityLog: jest.fn().mockResolvedValue([]),
      startMfaEnrollment: jest.fn().mockResolvedValue(challengeView),
      startMfaLoginChallenge: jest.fn().mockResolvedValue(challengeView),
      verifyMfaChallenge: jest.fn().mockResolvedValue(assertionView),
      disableMfa: jest.fn().mockResolvedValue({ disabled: true }),
    };
    authUserService = {
      getUserIdFromAuthHeader: jest.fn().mockResolvedValue('profile-1'),
      getAuthContextFromAuthHeader: jest.fn().mockResolvedValue({
        userId: 'profile-1',
        sessionId: 'session-1',
      }),
    };
    controller = new SecurityController(securityService as never, authUserService as never);
  });

  describe('route metadata', () => {
    it.each([
      ['getMyCredentialStatus', 'credential-status', RequestMethod.GET],
      ['changeMyPassword', 'change-password', RequestMethod.POST],
      ['completeRecovery', 'recovery/complete', RequestMethod.POST],
      ['getMyActivity', 'activity', RequestMethod.GET],
      ['getMyActivityLog', 'activity-log', RequestMethod.GET],
      ['startMfaEnrollment', 'mfa/enable-challenge', RequestMethod.POST],
      ['startMfaLoginChallenge', 'mfa/login-challenge', RequestMethod.POST],
      ['verifyMfaChallenge', 'mfa/verify', RequestMethod.POST],
      ['disableMfa', 'mfa/disable', RequestMethod.POST],
    ])('exposes %s at %s %s', (handler, path, method) => {
      const fn = (SecurityController.prototype as never as Record<string, Handler>)[handler];
      expect(read(PATH_METADATA, fn)).toBe(path);
      expect(read(METHOD_METADATA, fn)).toBe(method);
    });

    it('lives under the /security controller path', () => {
      expect(Reflect.getMetadata(PATH_METADATA, SecurityController)).toBe('security');
    });
  });

  describe('throttle budgets', () => {
    it.each([
      ['changeMyPassword', 60_000, 5],
      ['completeRecovery', 60_000, 5],
      ['startMfaEnrollment', 60_000, 3],
      ['verifyMfaChallenge', 60_000, 10],
      ['startMfaLoginChallenge', 60_000, 5],
      ['disableMfa', 60_000, 5],
    ])('throttles %s to %i per %i ms', (handler, ttl, limit) => {
      const fn = (SecurityController.prototype as never as Record<string, Handler>)[handler];
      expect(read(THROTTLE_TTL_KEY, fn)).toBe(ttl);
      expect(read(THROTTLE_LIMIT_KEY, fn)).toBe(limit);
    });

    it.each(['getMyCredentialStatus', 'getMyActivity', 'getMyActivityLog'])(
      'leaves the read-only %s route on the default limiter',
      (handler) => {
        const fn = (SecurityController.prototype as never as Record<string, Handler>)[handler];
        expect(read(THROTTLE_TTL_KEY, fn)).toBeUndefined();
        expect(read(THROTTLE_LIMIT_KEY, fn)).toBeUndefined();
      },
    );
  });

  describe('profile scoping', () => {
    it('derives the credential-status profile from the bearer only', async () => {
      await controller.getMyCredentialStatus(bearer);
      expect(authUserService.getUserIdFromAuthHeader).toHaveBeenCalledWith(bearer);
      expect(securityService.getCredentialStatus).toHaveBeenCalledWith('profile-1');
    });

    it('ignores any client-supplied target profile on status', async () => {
      const loose = controller.getMyCredentialStatus as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await loose.call(controller, bearer, { profileId: 'profile-2' });
      expect(securityService.getCredentialStatus).toHaveBeenCalledWith('profile-1');
    });

    it('derives the activity profile from the bearer only', async () => {
      const loose = controller.getMyActivity as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await loose.call(controller, bearer, { profileId: 'profile-2' });
      expect(securityService.getMyActivity).toHaveBeenCalledWith('profile-1');
    });

    it('serves activity-log as a legacy-shape alias for the existing mobile client', async () => {
      const events = [{ id: 'log-1', action: 'PASSWORD_CHANGED', success: true, createdAt: '2026-09-10T08:00:00.000Z' }];
      securityService.getMyActivityLog.mockResolvedValue(events);

      const viaAlias = await controller.getMyActivityLog(bearer);

      expect(viaAlias).toEqual(events);
      expect(securityService.getMyActivity).not.toHaveBeenCalled();
      expect(securityService.getMyActivityLog).toHaveBeenCalledWith('profile-1');
    });

    it('serves the canonical activity route in the success/data envelope', async () => {
      securityService.getMyActivity.mockResolvedValue({ events: [{ id: 'log-1' }] });

      await expect(controller.getMyActivity(bearer)).resolves.toEqual({
        success: true,
        data: { events: [{ id: 'log-1' }] },
      });
    });
  });

  describe('body forwarding', () => {
    it('forwards the typed change-password body unchanged', async () => {
      await controller.changeMyPassword(bearer, changeBody);
      expect(securityService.changeMyPassword).toHaveBeenCalledWith('profile-1', changeBody);
    });

    it('forwards the typed recovery body without a current password', async () => {
      await controller.completeRecovery(bearer, {
        newPassword: changeBody.newPassword,
        confirmPassword: changeBody.confirmPassword,
      });
      const [profileId, body] = securityService.completeRecovery.mock.calls[0];
      expect(profileId).toBe('profile-1');
      expect(body).toEqual({
        newPassword: changeBody.newPassword,
        confirmPassword: changeBody.confirmPassword,
      });
      expect(body).not.toHaveProperty('currentPassword');
    });
  });

  describe('secret-free responses', () => {
    it.each([
      ['getMyCredentialStatus', () => controller.getMyCredentialStatus(bearer)],
      [
        'changeMyPassword',
        () => controller.changeMyPassword(bearer, changeBody),
      ],
      [
        'completeRecovery',
        () =>
          controller.completeRecovery(bearer, {
            newPassword: changeBody.newPassword,
            confirmPassword: changeBody.confirmPassword,
          }),
      ],
      ['getMyActivity', () => controller.getMyActivity(bearer)],
      ['getMyActivityLog', () => controller.getMyActivityLog(bearer)],
    ])('%s never serializes a password or token', async (_label, call) => {
      const serialized = JSON.stringify(await call());
      expect(serialized).not.toContain(changeBody.newPassword);
      expect(serialized).not.toContain(changeBody.currentPassword);
      expect(serialized).not.toContain('profile-token');
      expect(serialized).not.toMatch(/\b\d{6}\b/);
    });
  });

  describe('DTOs', () => {
    const propertiesOf = (errors: ValidationError[]) => errors.map((e) => e.property);

    it('requires current, new and confirmation on the change DTO', () => {
      const missing = validateSync(plainToInstance(ChangePasswordDto, {}));
      expect(propertiesOf(missing)).toEqual(
        expect.arrayContaining(['currentPassword', 'newPassword', 'confirmPassword']),
      );
      expect(missing).toHaveLength(3);
    });

    it('rejects a blank current password on the change DTO', () => {
      const invalid = validateSync(
        plainToInstance(ChangePasswordDto, { ...changeBody, currentPassword: '' }),
      );
      expect(propertiesOf(invalid)).toEqual(['currentPassword']);
    });

    it('accepts a complete change body', () => {
      expect(validateSync(plainToInstance(ChangePasswordDto, changeBody))).toHaveLength(0);
    });

    it('requires new and confirmation but no current password on the recovery DTO', () => {
      const missing = validateSync(plainToInstance(ResetPasswordDto, {}));
      expect(propertiesOf(missing)).toEqual(
        expect.arrayContaining(['newPassword', 'confirmPassword']),
      );
      expect(missing).toHaveLength(2);
    });

    it('rejects a recovery body that smuggles a current password through extra fields', () => {
      const dto = plainToInstance(ResetPasswordDto, {
        newPassword: changeBody.newPassword,
        confirmPassword: changeBody.confirmPassword,
        currentPassword: 'Legacy!Passw0rd',
      });
      expect(validateSync(dto, { whitelist: true })).toHaveLength(0);
      expect(Object.keys(dto)).toEqual(['newPassword', 'confirmPassword']);
    });
  });

  describe('MFA route auth contract', () => {
    const handlerFor = (name: string) =>
      (SecurityController.prototype as never as Record<string, Handler>)[name];

    it('marks only the pre-session login challenge route public', () => {
      expect(read(IS_PUBLIC_KEY, handlerFor('startMfaLoginChallenge'))).toBe(true);
      for (const handler of [
        'startMfaEnrollment',
        'verifyMfaChallenge',
        'disableMfa',
      ]) {
        expect(read(IS_PUBLIC_KEY, handlerFor(handler))).toBeUndefined();
      }
    });

    it('leaves the global limiter deferring to the decorator for the public login route', () => {
      expect(MAIN_TS).toMatch(/\/security\/mfa\/login-challenge/);
    });

    it('never reads the authorization header on the public login challenge', async () => {
      await controller.startMfaLoginChallenge({ email: 'juan@example.com' });

      expect(authUserService.getAuthContextFromAuthHeader).not.toHaveBeenCalled();
      expect(authUserService.getUserIdFromAuthHeader).not.toHaveBeenCalled();
    });

    it.each([
      ['startMfaEnrollment', { currentPassword: changeBody.currentPassword }],
      ['verifyMfaChallenge', { challengeId: 'challenge-1', code: '123456' }],
      ['disableMfa', { currentPassword: changeBody.currentPassword }],
    ])('resolves the validated profile and session for %s', async (handler, body) => {
      const loose = controller[handler as 'startMfaEnrollment'] as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await loose.call(controller, bearer, body);

      expect(authUserService.getAuthContextFromAuthHeader).toHaveBeenCalledWith(bearer);
    });

    it('forwards the enrollment body to the profile the token resolves to', async () => {
      const body = { currentPassword: changeBody.currentPassword };
      await controller.startMfaEnrollment(bearer, body);

      expect(securityService.startMfaEnrollment).toHaveBeenCalledWith(
        'profile-1',
        'session-1',
        body,
      );
    });

    it('ignores a client-supplied profile on the verify route', async () => {
      const loose = controller.verifyMfaChallenge as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await loose.call(controller, bearer, {
        challengeId: 'challenge-1',
        code: '123456',
        profileId: 'profile-2',
      });

      expect(securityService.verifyMfaChallenge).toHaveBeenCalledWith(
        'profile-1',
        'session-1',
        expect.objectContaining({ challengeId: 'challenge-1' }),
      );
    });

    it('forwards only the typed email on the public login challenge', async () => {
      const loose = controller.startMfaLoginChallenge as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await loose.call(controller, {
        email: 'juan@example.com',
        purpose: 'MFA_DISABLE',
      });

      expect(securityService.startMfaLoginChallenge).toHaveBeenCalledWith(
        'juan@example.com',
      );
    });
  });

  describe('MFA response projections', () => {
    it('wraps the enrollment challenge in the success/data envelope', async () => {
      await expect(
        controller.startMfaEnrollment(bearer, {
          currentPassword: changeBody.currentPassword,
        }),
      ).resolves.toEqual({ success: true, data: challengeView });
    });

    it('wraps the login challenge in the success/data envelope', async () => {
      await expect(
        controller.startMfaLoginChallenge({ email: 'juan@example.com' }),
      ).resolves.toEqual({ success: true, data: challengeView });
    });

    it('returns only the freshly issued assertion and expiry on verify', async () => {
      const response = (await controller.verifyMfaChallenge(bearer, {
        challengeId: 'challenge-1',
        code: '123456',
      })) as unknown as { success: boolean; data: Record<string, unknown> };

      expect(response.success).toBe(true);
      expect(Object.keys(response.data).sort()).toEqual([
        'assertion',
        'expiresAt',
      ]);
    });

    it('forwards both disable phases through the same service entry point', async () => {
      securityService.disableMfa.mockResolvedValueOnce({ disabled: true });

      await expect(
        controller.disableMfa(bearer, { currentPassword: changeBody.currentPassword }),
      ).resolves.toEqual({ success: true, data: { disabled: true } });

      expect(securityService.disableMfa).toHaveBeenCalledWith(
        'profile-1',
        'session-1',
        { currentPassword: changeBody.currentPassword },
      );
    });

    it('returns the masked challenge when the first disable phase completes', async () => {
      securityService.disableMfa.mockResolvedValueOnce(challengeView);

      await expect(
        controller.disableMfa(bearer, { currentPassword: changeBody.currentPassword }),
      ).resolves.toEqual({ success: true, data: challengeView });
    });

    it('forwards the second disable phase with the challenge id and code intact', async () => {
      const body = {
        currentPassword: changeBody.currentPassword,
        challengeId: '11111111-2222-4333-8444-555555555555',
        code: '123456',
      };
      securityService.disableMfa.mockResolvedValueOnce({ disabled: true });

      await controller.disableMfa(bearer, body);

      expect(securityService.disableMfa).toHaveBeenCalledWith(
        'profile-1',
        'session-1',
        body,
      );
    });

    it.each([
      [
        'startMfaEnrollment',
        () =>
          controller.startMfaEnrollment(bearer, {
            currentPassword: changeBody.currentPassword,
          }),
      ],
      [
        'startMfaLoginChallenge',
        () => controller.startMfaLoginChallenge({ email: 'juan@example.com' }),
      ],
      [
        'verifyMfaChallenge',
        () =>
          controller.verifyMfaChallenge(bearer, {
            challengeId: 'challenge-1',
            code: '123456',
          }),
      ],
      [
        'disableMfa',
        () =>
          controller.disableMfa(bearer, {
            currentPassword: changeBody.currentPassword,
          }),
      ],
    ])('%s never serializes a password, a code, or the bearer token', async (_label, call) => {
      const serialized = JSON.stringify(await call());

      expect(serialized).not.toContain(changeBody.currentPassword);
      expect(serialized).not.toContain('profile-token');
      expect(serialized).not.toContain('juan@example.com');
      expect(serialized).not.toMatch(/\b\d{6}\b/);
    });
  });
});
