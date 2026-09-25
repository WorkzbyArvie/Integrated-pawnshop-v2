import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import {
  THROTTLE_LIMIT_KEY,
  THROTTLE_TTL_KEY,
} from '../common/decorators/throttle.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SecurityController } from './security.controller';

type Handler = (...args: any[]) => unknown;

const read = (key: string, handler: Handler) => Reflect.getMetadata(key, handler);

describe('SecurityController', () => {
  let securityService: {
    getCredentialStatus: jest.Mock;
    changeMyPassword: jest.Mock;
    completeRecovery: jest.Mock;
    getMyActivity: jest.Mock;
    getMyActivityLog: jest.Mock;
  };
  let authUserService: { getUserIdFromAuthHeader: jest.Mock };
  let controller: SecurityController;

  const bearer = 'Bearer profile-token';
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
    };
    authUserService = { getUserIdFromAuthHeader: jest.fn().mockResolvedValue('profile-1') };
    controller = new SecurityController(securityService as never, authUserService as never);
  });

  describe('route metadata', () => {
    it.each([
      ['getMyCredentialStatus', 'credential-status', RequestMethod.GET],
      ['changeMyPassword', 'change-password', RequestMethod.POST],
      ['completeRecovery', 'recovery/complete', RequestMethod.POST],
      ['getMyActivity', 'activity', RequestMethod.GET],
      ['getMyActivityLog', 'activity-log', RequestMethod.GET],
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
});
