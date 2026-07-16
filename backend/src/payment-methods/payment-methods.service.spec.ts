import { PaymentMethodsService } from './payment-methods.service';
import { PrismaService } from '../prisma.service';

type PaymentMethodDelegateMock = {
  findMany: jest.Mock;
  updateMany: jest.Mock;
  create: jest.Mock;
  findFirst: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

describe('PaymentMethodsService', () => {
  const prismaMock: { customerPaymentMethod: PaymentMethodDelegateMock } = {
    customerPaymentMethod: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  let service: PaymentMethodsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentMethodsService(prismaMock as unknown as PrismaService);
  });

  it('rejects invalid payment type', async () => {
    await expect(
      service.addMyPaymentMethod('user-1', { type: 'CRYPTO' }),
    ).rejects.toThrow('Invalid payment type');
  });

  it('sets previous methods non-default before adding default method', async () => {
    prismaMock.customerPaymentMethod.create.mockResolvedValue({
      id: 'pm-1',
      isDefault: true,
    });

    await service.addMyPaymentMethod('user-1', {
      type: 'CARD',
      label: 'Primary',
      last4: '1234',
      cardBrand: 'VISA',
      isDefault: true,
    });

    expect(prismaMock.customerPaymentMethod.updateMany).toHaveBeenCalledWith({
      where: { profileId: 'user-1' },
      data: { isDefault: false },
    });
    expect(prismaMock.customerPaymentMethod.create).toHaveBeenCalled();
  });

  it('throws if default target method does not belong to user', async () => {
    prismaMock.customerPaymentMethod.findFirst.mockResolvedValue(null);

    await expect(
      service.setDefaultPaymentMethod('user-1', 'pm-404'),
    ).rejects.toThrow('Payment method not found');
  });
});
