import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: jest.Mocked<AppService>;

  beforeEach(async () => {
    const appServiceMock = {
      localLogin: jest.fn(),
      createBranchAdmin: jest.fn(),
      createTicket: jest.fn(),
      getAllTickets: jest.fn(),
      deleteTicket: jest.fn(),
      getAllCustomers: jest.fn(),
      getCustomerById: jest.fn(),
      createCustomer: jest.fn(),
    } as unknown as jest.Mocked<AppService>;

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appServiceMock }],
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
});
