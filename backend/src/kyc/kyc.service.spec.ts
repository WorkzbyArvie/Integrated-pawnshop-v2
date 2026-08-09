import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { KycService } from './kyc.service';
import { PrismaService } from '../prisma.service';
import { UpsertCustomerKycDto } from './dto/upsert-customer-kyc.dto';

describe('KycService (KYC-01 / KYC-02)', () => {
  let service: KycService;
  let prisma: {
    customerKyc: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    customer: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    customerKyc: { upsert: jest.Mock; update: jest.Mock };
    customer: { update: jest.Mock };
  };

  const pendingKyc = {
    id: 'kyc_1',
    customerId: 'cust_1',
    pawnshopId: 'ps_1',
    status: 'PENDING',
    fullName: 'Juan Dela Cruz',
    contactNumber: '+639281234567',
    address: '123 Main St',
    idType: 'NATIONAL_ID',
    idNumber: '1234-5678-9012',
    idFrontUrl: 'https://example.com/front.jpg',
    idBackUrl: null,
    selfieUrl: null,
    verificationData: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    customer: { id: 'cust_1', fullName: 'Juan Dela Cruz' },
  };

  const upsertDto: UpsertCustomerKycDto = {
    customerId: 'cust_1',
    fullName: 'Juan Dela Cruz',
    contactNumber: '09281234567',
    address: '123 Main St',
    idType: 'NATIONAL_ID',
    idNumber: '1234-5678-9012',
    idFrontUrl: 'https://example.com/front.jpg',
  };

  beforeEach(async () => {
    prisma = {
      customerKyc: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    tx = {
      customerKyc: {
        upsert: jest.fn().mockResolvedValue(pendingKyc),
        update: jest.fn().mockResolvedValue({ ...pendingKyc, status: 'VERIFIED' }),
      },
      customer: { update: jest.fn().mockResolvedValue({ id: 'cust_1' }) },
    };

    const module = await Test.createTestingModule({
      providers: [KycService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(KycService);
  });

  describe('upsertCustomerKyc(dto, callerPawnshopId)', () => {
    it('writes CustomerKyc PENDING and Customer.kycStatus PENDING inside one interactive transaction', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust_1' });

      const result = await service.upsertCustomerKyc(upsertDto, 'ps_1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.customerKyc.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'cust_1' }),
          create: expect.objectContaining({
            customerId: 'cust_1',
            pawnshopId: 'ps_1',
            status: 'PENDING',
            fullName: 'Juan Dela Cruz',
            contactNumber: '+639281234567',
            idNumber: '1234-5678-9012',
            idFrontUrl: 'https://example.com/front.jpg',
          }),
          update: expect.objectContaining({
            pawnshopId: 'ps_1',
            status: 'PENDING',
          }),
        }),
      );
      expect(tx.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'cust_1' }),
          data: expect.objectContaining({ kycStatus: 'PENDING' }),
        }),
      );
      expect(prisma.customerKyc.upsert).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'kyc_1', status: 'PENDING' });
    });

    it('creates a customer when dto.customerId is absent and no match exists', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'cust_new' });
      const { customerId, ...walkInDto } = upsertDto;

      await service.upsertCustomerKyc(walkInDto, 'ps_1');

      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fullName: 'Juan Dela Cruz',
            contactNumber: '+639281234567',
          }),
        }),
      );
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fullName: 'Juan Dela Cruz',
            contactNumber: '+639281234567',
            pawnshopId: 'ps_1',
            kycStatus: 'NOT_SUBMITTED',
          }),
        }),
      );
      expect(tx.customerKyc.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'cust_new' }),
        }),
      );
    });

    it('reuses an existing customer resolved by fullName + contactNumber', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust_existing' });
      const { customerId, ...walkInDto } = upsertDto;

      await service.upsertCustomerKyc(walkInDto, 'ps_1');

      expect(prisma.customer.create).not.toHaveBeenCalled();
      expect(tx.customerKyc.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'cust_existing' }),
        }),
      );
    });

    it('throws NotFoundException when dto.customerId does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.upsertCustomerKyc(upsertDto, 'ps_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an invalid PH phone number', async () => {
      await expect(
        service.upsertCustomerKyc({ ...upsertDto, contactNumber: '12345' }, 'ps_1'),
      ).rejects.toThrow('Phone number must be a valid PH mobile number');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a non-12-digit National ID', async () => {
      await expect(
        service.upsertCustomerKyc({ ...upsertDto, idNumber: '1234567890123456' }, 'ps_1'),
      ).rejects.toThrow('National ID must contain exactly 12 digits');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a non-https document URL', async () => {
      await expect(
        service.upsertCustomerKyc(
          { ...upsertDto, idFrontUrl: 'ftp://example.com/front.jpg' },
          'ps_1',
        ),
      ).rejects.toThrow('ID front URL is invalid');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listCustomers(callerPawnshopId, status?)', () => {
    it('returns KYC records scoped to the caller pawnshop', async () => {
      prisma.customerKyc.findMany.mockResolvedValue([pendingKyc]);

      const result = await service.listCustomers('ps_1');

      expect(prisma.customerKyc.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pawnshopId: 'ps_1' },
          include: expect.objectContaining({ customer: true }),
          orderBy: expect.objectContaining({ createdAt: 'desc' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'kyc_1', status: 'PENDING' });
    });

    it('applies the status filter when provided', async () => {
      prisma.customerKyc.findMany.mockResolvedValue([]);

      await service.listCustomers('ps_1', 'PENDING');

      expect(prisma.customerKyc.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pawnshopId: 'ps_1', status: 'PENDING' }),
        }),
      );
    });
  });

  describe('review(id, dto, callerPawnshopId, reviewedBy, userRole)', () => {
    it('approves a PENDING record writing VERIFIED to both columns in one transaction', async () => {
      prisma.customerKyc.findUnique.mockResolvedValue(pendingKyc);

      const result = await service.review(
        'kyc_1',
        { decision: 'VERIFIED' },
        'ps_1',
        'mgr_1',
        'MANAGER',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.customerKyc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'kyc_1' }),
          data: expect.objectContaining({
            status: 'VERIFIED',
            reviewedBy: 'mgr_1',
            reviewedAt: expect.any(Date),
            rejectionReason: null,
          }),
        }),
      );
      expect(tx.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'cust_1' }),
          data: expect.objectContaining({ kycStatus: 'VERIFIED' }),
        }),
      );
      expect(prisma.customerKyc.update).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'kyc_1', status: 'VERIFIED' });
    });

    it('rejects a PENDING record persisting the rejection reason', async () => {
      prisma.customerKyc.findUnique.mockResolvedValue(pendingKyc);
      tx.customerKyc.update.mockResolvedValue({
        ...pendingKyc,
        status: 'REJECTED',
        rejectionReason: 'ID is blurry',
      });

      const result = await service.review(
        'kyc_1',
        { decision: 'REJECTED', rejectionReason: 'ID is blurry' },
        'ps_1',
        'mgr_1',
        'MANAGER',
      );

      expect(tx.customerKyc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'ID is blurry',
          }),
        }),
      );
      expect(tx.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kycStatus: 'REJECTED' }),
        }),
      );
      expect(result).toMatchObject({ status: 'REJECTED' });
    });

    it('requires a non-blank rejection reason when rejecting', async () => {
      prisma.customerKyc.findUnique.mockResolvedValue(pendingKyc);

      await expect(
        service.review('kyc_1', { decision: 'REJECTED' }, 'ps_1', 'mgr_1', 'MANAGER'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.review(
          'kyc_1',
          { decision: 'REJECTED', rejectionReason: '   ' },
          'ps_1',
          'mgr_1',
          'MANAGER',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('forbids reviewing an already-decided record', async () => {
      prisma.customerKyc.findUnique.mockResolvedValue({
        ...pendingKyc,
        status: 'VERIFIED',
      });

      await expect(
        service.review('kyc_1', { decision: 'VERIFIED' }, 'ps_1', 'mgr_1', 'MANAGER'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids cross-tenant review unless the caller is SUPER_ADMIN', async () => {
      prisma.customerKyc.findUnique.mockResolvedValue({
        ...pendingKyc,
        pawnshopId: 'ps_2',
      });

      await expect(
        service.review('kyc_1', { decision: 'VERIFIED' }, 'ps_1', 'mgr_1', 'MANAGER'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await service.review(
        'kyc_1',
        { decision: 'VERIFIED' },
        'ps_1',
        'sa_1',
        'SUPER_ADMIN',
      );
      expect(tx.customerKyc.update).toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing record', async () => {
      prisma.customerKyc.findUnique.mockResolvedValue(null);

      await expect(
        service.review('kyc_1', { decision: 'VERIFIED' }, 'ps_1', 'mgr_1', 'MANAGER'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
