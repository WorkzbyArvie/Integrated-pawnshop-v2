import { Test } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';

import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { PERMISSIONS_KEY } from '../common/decorators/requires-permission.decorator';

describe('ApprovalController (RBAC-05 endpoint surface)', () => {
  let controller: ApprovalController;
  const approvalService = {
    getQueue: jest.fn(),
    decide: jest.fn(),
  };

  const caller = { id: 'mgr_1', pawnshopId: 'ps_1', role: 'MANAGER' };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [ApprovalController],
      providers: [{ provide: ApprovalService, useValue: approvalService }],
    }).compile();

    controller = module.get(ApprovalController);
  });

  it('GET handler delegates to ApprovalService.getQueue with the caller pawnshopId', async () => {
    approvalService.getQueue.mockResolvedValue({ records: [], total: 0 });

    await controller.getQueue({ targetType: 'APPRAISAL' }, caller);

    expect(approvalService.getQueue).toHaveBeenCalledWith('ps_1', {
      targetType: 'APPRAISAL',
    });
  });

  it('approve delegates to ApprovalService.decide with approve=true', async () => {
    approvalService.decide.mockResolvedValue({ id: 1, status: 'APPROVED' });

    await controller.approve(1, { decisionComment: 'ok' }, caller);

    expect(approvalService.decide).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ approve: true, decisionComment: 'ok' }),
      caller,
    );
  });

  it('reject delegates to ApprovalService.decide with approve=false', async () => {
    approvalService.decide.mockResolvedValue({ id: 1, status: 'REJECTED' });

    await controller.reject(1, { decisionComment: 'needs rework' }, caller);

    expect(approvalService.decide).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ approve: false, decisionComment: 'needs rework' }),
      caller,
    );
  });

  it('exposes GET /approvals guarded by approval.view_queue', () => {
    const handler = ApprovalController.prototype.getQueue;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('path', handler)).toBe('');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'approval.view_queue',
    ]);
  });

  it('exposes POST /approvals/:id/approve guarded by the approval approve permissions', () => {
    const handler = ApprovalController.prototype.approve;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('path', handler)).toBe(':id/approve');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'approval.approve_appraisal',
      'approval.approve_redemption',
    ]);
  });

  it('exposes POST /approvals/:id/reject guarded by the approval approve permissions', () => {
    const handler = ApprovalController.prototype.reject;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('path', handler)).toBe(':id/reject');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'approval.approve_appraisal',
      'approval.approve_redemption',
    ]);
  });
});
