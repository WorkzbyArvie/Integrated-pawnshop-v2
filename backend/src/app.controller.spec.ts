import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getMetadataStorage } from 'class-validator';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StorageService } from './common/storage/storage.service';
import { PERMISSIONS } from './common/permissions/permissions.const';
import { PERMISSIONS_KEY } from './common/decorators/requires-permission.decorator';
import {
  THROTTLE_LIMIT_KEY,
  THROTTLE_TTL_KEY,
} from './common/decorators/throttle.decorator';
import { StaffPasswordDto } from './security/dto/staff-password.dto';

const TEMP_PASSWORD = 'Temporary#Pass1';

describe('AppController', () => {
  let appController: AppController;
  let appService: jest.Mocked<AppService>;

  const buildAppServiceMock = () =>
    ({
      localLogin: jest.fn(),
      createBranchAdmin: jest.fn(),
      createTicket: jest.fn(),
      getAllTickets: jest.fn(),
      deleteTicket: jest.fn(),
      getAllCustomers: jest.fn(),
      getCustomerById: jest.fn(),
      createCustomer: jest.fn(),
      getUserIdFromToken: jest.fn(),
      changeStaffPassword: jest.fn(),
      requireAdmin: jest.fn(),
    }) as unknown as jest.Mocked<AppService>;

  beforeEach(async () => {
    const appServiceMock = buildAppServiceMock();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: appServiceMock },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get(AppService);
  });

  it('delegates localLogin to AppService', async () => {
    const body = { email: 'user@example.com', password: 'password123' };
    const result: Awaited<ReturnType<AppService['localLogin']>> = {
      success: true,
      message: 'Local auth succeeded (test)',
      profile: {
        role: 'BRANCH_ADMIN',
        full_name: 'Test User',
        pawnshop_id: null,
      },
    };

    appService.localLogin.mockResolvedValue(result);

    await expect(appController.localLogin(body)).resolves.toEqual(result);
    expect(appService.localLogin).toHaveBeenCalledWith(body);
  });

  it('delegates createTicket to AppService', async () => {
    const body = { customerId: 'customer-1' };
    const result = { id: 1 } as Awaited<ReturnType<AppService['createTicket']>>;

    appService.createTicket.mockResolvedValue(result);

    await expect(appController.createTicket(body)).resolves.toEqual(result);
    expect(appService.createTicket).toHaveBeenCalledWith(body);
  });

  describe('administrative staff reset route', () => {
    it('carries the reused user.manage_staff permission metadata', () => {
      const metadata = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AppController.prototype.changeStaffPassword,
      );

      expect(metadata).toEqual([PERMISSIONS['user.manage_staff']]);
    });

    it('applies a tight route throttle', () => {
      const target = AppController.prototype.changeStaffPassword;

      expect(Reflect.getMetadata(THROTTLE_TTL_KEY, target)).toBe(60_000);
      expect(Reflect.getMetadata(THROTTLE_LIMIT_KEY, target)).toBe(10);
    });

    it('declares a decorated body metatype so the global pipe can validate it', () => {
      const paramTypes = Reflect.getMetadata(
        'design:paramtypes',
        AppController.prototype,
        'changeStaffPassword',
      ) as unknown[];

      expect(paramTypes[2]).toBe(StaffPasswordDto);

      const validated = getMetadataStorage()
        .getTargetValidationMetadatas(StaffPasswordDto, '', true, false)
        .filter((metadata) => metadata.propertyName);

      expect(new Set(validated.map((metadata) => metadata.propertyName))).toEqual(
        new Set(['newPassword']),
      );
    });

    it('resolves the target from the authorized route and forwards only the new password', async () => {
      appService.getUserIdFromToken.mockResolvedValue('actor-1');
      appService.changeStaffPassword.mockResolvedValue({
        changed: true,
        mustChangePassword: true,
      } as Awaited<ReturnType<AppService['changeStaffPassword']>>);

      await appController.changeStaffPassword('staff-from-route', 'Bearer token', {
        newPassword: TEMP_PASSWORD,
        profileId: 'attacker-chosen-target',
        mustChangePassword: false,
        pawnshopId: 'shop-from-browser',
      } as unknown as StaffPasswordDto);

      expect(appService.changeStaffPassword).toHaveBeenCalledTimes(1);
      const [actorId, targetId, forwardedPassword] =
        appService.changeStaffPassword.mock.calls[0];
      expect(actorId).toBe('actor-1');
      expect(targetId).toBe('staff-from-route');
      expect(forwardedPassword).toBe(TEMP_PASSWORD);
      expect(appService.changeStaffPassword.mock.calls[0]).toHaveLength(3);
    });

    it('returns the changed flag without ever echoing the temporary password', async () => {
      appService.getUserIdFromToken.mockResolvedValue('actor-1');
      appService.changeStaffPassword.mockResolvedValue({
        changed: true,
        mustChangePassword: true,
      } as Awaited<ReturnType<AppService['changeStaffPassword']>>);

      const result = await appController.changeStaffPassword(
        'staff-1',
        'Bearer token',
        { newPassword: TEMP_PASSWORD },
      );

      expect(result).toEqual({ changed: true, mustChangePassword: true });
      expect(JSON.stringify(result)).not.toContain(TEMP_PASSWORD);
    });

    it('surfaces a safe generic error that never repeats the temporary password', async () => {
      appService.getUserIdFromToken.mockResolvedValue('actor-1');
      appService.changeStaffPassword.mockRejectedValue(
        new Error(`supabase rejected ${TEMP_PASSWORD}`),
      );

      await expect(
        appController.changeStaffPassword('staff-1', 'Bearer token', {
          newPassword: TEMP_PASSWORD,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ message: 'Failed to reset staff password' }),
      });

      await appController
        .changeStaffPassword('staff-1', 'Bearer token', {
          newPassword: TEMP_PASSWORD,
        })
        .catch((error: { getResponse?: () => unknown }) => {
          expect(JSON.stringify(error.getResponse?.())).not.toContain(TEMP_PASSWORD);
        });
    });
  });

  describe('administrative staff reset validation boundary', () => {
    let httpApp: INestApplication;

    beforeEach(async () => {
      const appServiceMock = buildAppServiceMock();
      appServiceMock.getUserIdFromToken.mockResolvedValue('actor-1');
      appServiceMock.changeStaffPassword.mockResolvedValue({
        changed: true,
        mustChangePassword: true,
      } as Awaited<ReturnType<AppService['changeStaffPassword']>>);
      appService = appServiceMock;

      const moduleRef = await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          { provide: AppService, useValue: appServiceMock },
          { provide: StorageService, useValue: {} },
        ],
      }).compile();

      httpApp = moduleRef.createNestApplication();
      httpApp.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await httpApp.init();
    });

    afterEach(async () => {
      await httpApp.close();
    });

    it('rejects a malformed body before the service is reached', async () => {
      const response = await request(httpApp.getHttpServer())
        .post('/staff/staff-1/password')
        .send({ password: TEMP_PASSWORD });

      expect(response.status).toBe(400);
      expect(appService.changeStaffPassword).not.toHaveBeenCalled();
    });

    it('rejects unknown fields so a browser cannot steer the forced state', async () => {
      const response = await request(httpApp.getHttpServer())
        .post('/staff/staff-1/password')
        .send({ newPassword: TEMP_PASSWORD, mustChangePassword: false });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('mustChangePassword'),
        ]),
      );
      expect(appService.changeStaffPassword).not.toHaveBeenCalled();
    });

    it('rejects a non-string password before the service is reached', async () => {
      const response = await request(httpApp.getHttpServer())
        .post('/staff/staff-1/password')
        .send({ newPassword: { $ne: null } });

      expect(response.status).toBe(400);
      expect(appService.changeStaffPassword).not.toHaveBeenCalled();
    });

    it('forwards a well-formed body to the service exactly once', async () => {
      const response = await request(httpApp.getHttpServer())
        .post('/staff/staff-1/password')
        .set('authorization', 'Bearer token')
        .send({ newPassword: TEMP_PASSWORD });

      expect(response.status).toBe(201);
      expect(appService.changeStaffPassword).toHaveBeenCalledWith(
        'actor-1',
        'staff-1',
        TEMP_PASSWORD,
      );
      expect(JSON.stringify(response.body)).not.toContain(TEMP_PASSWORD);
      expect(response.body).toEqual({
        changed: true,
        mustChangePassword: true,
      });
    });
  });
});
