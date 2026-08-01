import { Test } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';

import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { PERMISSIONS_KEY } from '../common/decorators/requires-permission.decorator';

describe('ApprovalController (RBAC-05 endpoint surface)', () => {
  let controller: ApprovalController;
  const approvalService = {
    getQueue: jest.fn(),
    decideApproval: jest.fn(),
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

  it('GET /approval-queue delegates to ApprovalService.getQueue(query, callerPawnshopId)', async () => {
    approvalService.getQueue.mockResolvedValue([]);

    await controller.getQueue({ targetType: 'APPRAISAL' }, caller);

    expect(approvalService.getQueue).toHaveBeenCalledWith(
      { targetType: 'APPRAISAL' },
      'ps_1',
    );
  });

  it('POST /approval-queue/:id/approve delegates to decideApproval with approve=true', async () => {
    approvalService.decideApproval.mockResolvedValue({ id: 1, status: 'APPROVED' });

    await controller.approve('1', { decisionComment: 'ok' }, caller);

    expect(approvalService.decideApproval).toHaveBeenCalledWith(
      '1',
      { decisionComment: 'ok' },
      'mgr_1',
      'MANAGER',
      true,
      'ps_1',
    );
  });

  it('POST /approval-queue/:id/reject delegates to decideApproval with approve=false', async () => {
    approvalService.decideApproval.mockResolvedValue({ id: 1, status: 'REJECTED' });

    await controller.reject('1', { decisionComment: 'needs rework' }, caller);

    expect(approvalService.decideApproval).toHaveBeenCalledWith(
      '1',
      { decisionComment: 'needs rework' },
      'mgr_1',
      'MANAGER',
      false,
      'ps_1',
    );
  });

  it('exposes the controller under the /approval-queue path', () => {
    expect(Reflect.getMetadata('path', ApprovalController)).toBe('approval-queue');
  });

  it('exposes GET /approval-queue guarded by approval.view_queue', () => {
    const handler = ApprovalController.prototype.getQueue;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('path', handler)).toBe('');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'approval.view_queue',
    ]);
  });

  it('exposes POST /approval-queue/:id/approve guarded by approval.approve_appraisal', () => {
    const handler = ApprovalController.prototype.approve;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('path', handler)).toBe(':id/approve');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'approval.approve_appraisal',
    ]);
  });

  it('exposes POST /approval-queue/:id/reject guarded by approval.approve_appraisal', () => {
    const handler = ApprovalController.prototype.reject;

    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('path', handler)).toBe(':id/reject');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'approval.approve_appraisal',
    ]);
  });
});
