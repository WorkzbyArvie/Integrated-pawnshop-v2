import { Test } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';

import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { UpsertCustomerKycDto } from './dto/upsert-customer-kyc.dto';
import { PERMISSIONS_KEY } from '../common/decorators/requires-permission.decorator';

describe('KycController (KYC-02 endpoint surface)', () => {
  let controller: KycController;
  const kycService = {
    upsertCustomerKyc: jest.fn(),
    listCustomers: jest.fn(),
    review: jest.fn(),
  };

  const caller: any = { id: 'mgr_1', pawnshopId: 'ps_1', role: 'MANAGER' };

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
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [KycController],
      providers: [{ provide: KycService, useValue: kycService }],
    }).compile();

    controller = module.get(KycController);
  });

  it('POST /kyc/customers delegates to upsertCustomerKyc with the caller pawnshopId', async () => {
    kycService.upsertCustomerKyc.mockResolvedValue({ id: 'kyc_1', status: 'PENDING' });

    await controller.upsert(upsertDto, caller);

    expect(kycService.upsertCustomerKyc).toHaveBeenCalledWith(upsertDto, 'ps_1');
  });

  it('GET /kyc/customers delegates to listCustomers(pawnshopId)', async () => {
    kycService.listCustomers.mockResolvedValue([]);

    await controller.list(undefined, caller);

    expect(kycService.listCustomers).toHaveBeenCalledWith('ps_1', undefined);
  });

  it('GET /kyc/customers forwards the status query filter', async () => {
    kycService.listCustomers.mockResolvedValue([]);

    await controller.list('PENDING', caller);

    expect(kycService.listCustomers).toHaveBeenCalledWith('ps_1', 'PENDING');
  });

  it('PATCH /kyc/customers/:id/review delegates with id, dto, pawnshopId, user id and role', async () => {
    kycService.review.mockResolvedValue({ id: 'kyc_1', status: 'VERIFIED' });

    await controller.review('kyc_1', { decision: 'VERIFIED' }, caller);

    expect(kycService.review).toHaveBeenCalledWith(
      'kyc_1',
      { decision: 'VERIFIED' },
      'ps_1',
      'mgr_1',
      'MANAGER',
    );
  });

  it('falls back to the pawnshop-id header when the request user has no pawnshopId', async () => {
    kycService.listCustomers.mockResolvedValue([]);

    await controller.list(undefined, { headers: { 'pawnshop-id': 'ps_9' } } as any);

    expect(kycService.listCustomers).toHaveBeenCalledWith('ps_9', undefined);
  });

  it('exposes the controller under the /kyc path', () => {
    expect(Reflect.getMetadata('path', KycController)).toBe('kyc');
  });

  it('exposes POST /kyc/customers ungated (no PERMISSIONS_KEY metadata)', () => {
    const handler = KycController.prototype.upsert;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('path', handler)).toBe('customers');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it('exposes GET /kyc/customers guarded by kyc.view', () => {
    const handler = KycController.prototype.list;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('path', handler)).toBe('customers');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['kyc.view']);
  });

  it('exposes PATCH /kyc/customers/:id/review guarded by kyc.verify', () => {
    const handler = KycController.prototype.review;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata('path', handler)).toBe('customers/:id/review');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['kyc.verify']);
  });
});
