import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMyPaymentMethods(userId: string) {
    return this.prisma.customerPaymentMethod.findMany({
      where: { profileId: userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async addMyPaymentMethod(
    userId: string,
    data: {
      type: string;
      label?: string;
      last4?: string;
      cardBrand?: string;
      expiryMonth?: number;
      expiryYear?: number;
      bankName?: string;
      walletPhone?: string;
      isDefault?: boolean;
    },
  ) {
    const type = String(data.type || '').toUpperCase();
    const allowed = ['CARD', 'GCASH', 'PAYMAYA', 'BANK_ACCOUNT'];
    if (!allowed.includes(type)) {
      throw new Error('Invalid payment type');
    }

    if (data.last4 && !/^\d{4}$/.test(String(data.last4))) {
      throw new Error('last4 must be exactly 4 numeric digits');
    }

    if (type === 'CARD') {
      if (!data.last4) {
        throw new Error('Card payment method requires last4 digits');
      }
      if (!data.cardBrand) {
        throw new Error('Card payment method requires cardBrand');
      }
    }

    if ((type === 'GCASH' || type === 'PAYMAYA') && !data.walletPhone) {
      throw new Error(`${type} payment method requires walletPhone`);
    }

    if (type === 'BANK_ACCOUNT' && !data.bankName) {
      throw new Error('BANK_ACCOUNT payment method requires bankName');
    }

    if (data.isDefault) {
      await this.prisma.customerPaymentMethod.updateMany({
        where: { profileId: userId },
        data: { isDefault: false },
      });
    }

    return this.prisma.customerPaymentMethod.create({
      data: {
        profileId: userId,
        type,
        label: data.label || null,
        last4: data.last4 || null,
        cardBrand: data.cardBrand || null,
        expiryMonth: data.expiryMonth || null,
        expiryYear: data.expiryYear || null,
        bankName: data.bankName || null,
        walletPhone: data.walletPhone || null,
        isDefault: !!data.isDefault,
      },
    });
  }

  async setDefaultPaymentMethod(userId: string, paymentMethodId: string) {
    const current = await this.prisma.customerPaymentMethod.findFirst({
      where: { id: paymentMethodId, profileId: userId },
      select: { id: true },
    });
    if (!current) throw new Error('Payment method not found');

    await this.prisma.customerPaymentMethod.updateMany({
      where: { profileId: userId },
      data: { isDefault: false },
    });

    return this.prisma.customerPaymentMethod.update({
      where: { id: paymentMethodId },
      data: { isDefault: true },
    });
  }

  async removeMyPaymentMethod(userId: string, paymentMethodId: string) {
    const current = await this.prisma.customerPaymentMethod.findFirst({
      where: { id: paymentMethodId, profileId: userId },
      select: { id: true },
    });
    if (!current) throw new Error('Payment method not found');

    return this.prisma.customerPaymentMethod.delete({
      where: { id: paymentMethodId },
    });
  }
}
