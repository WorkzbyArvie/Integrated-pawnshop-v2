import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LoanContractService } from './loan-contract.service';
import { PrismaService } from '../prisma.service';
import { LegalProofService } from './legal-proof.service';
import { ContractRendererService } from '../contract/contract-renderer.service';
import { StateMachineService } from '../common/state-machine/state-machine.service';

describe('LoanContractService', () => {
  let service: LoanContractService;
  let prisma: Record<string, any>;
  let legalProofService: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      loanContract: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      loanApplication: {
        findUnique: jest.fn(),
      },
      loan: {
        findUnique: jest.fn(),
      },
      ticket: {
        update: jest.fn(),
      },
    };

    legalProofService = {
      createProof: jest.fn(),
      listByContract: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanContractService,
        { provide: PrismaService, useValue: prisma },
        { provide: LegalProofService, useValue: legalProofService },
        { provide: ContractRendererService, useValue: {} },
        { provide: StateMachineService, useValue: { transition: jest.fn() } },
      ],
    }).compile();

    service = module.get<LoanContractService>(LoanContractService);
  });

  it('rejects contract generation when the application has no linked loan', async () => {
    prisma.loanApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      status: 'APPROVED',
      loanAmount: 5000,
      loanType: 'PERSONAL',
      termMonths: 6,
      purpose: 'Test item',
      customer: {
        fullName: 'Test Customer',
        address: 'Test Address',
      },
      pawnshopId: 'pawnshop-1',
      pawnshop: {
        legalEntity: null,
        name: 'Pawnshop One',
      },
      loan: null,
    });

    await expect(service.generateContractForApplication('app-1', 'staff-1')).rejects.toThrow(
      'Approved application must have a linked loan before contract generation',
    );
    expect(prisma.loanContract?.create).toBeUndefined();
  });

  it('rejects staff signing before the customer signs', async () => {
    prisma.loanContract.findUnique.mockResolvedValue({
      id: 'contract-1',
      applicationId: 'app-1',
      contractNumber: 'CTR-TEST-001',
      signedByCustomer: false,
      signedByStaff: false,
      application: {
        pawnshopId: 'pawnshop-1',
        loan: {
          ticket: {
            id: 11,
            lifecycleStatus: 'OFFER_MADE',
          },
        },
      },
    });

    await expect(service.signByStaff('app-1', 'staff-1', 'signature')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.loanContract.update).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(legalProofService.createProof).not.toHaveBeenCalled();
  });

  it('advances the ticket lifecycle after both signatures are present', async () => {
    const signedAt = new Date('2026-07-05T00:00:00.000Z');

    prisma.loanContract.findUnique.mockResolvedValue({
      id: 'contract-1',
      applicationId: 'app-1',
      contractNumber: 'CTR-TEST-001',
      signedByCustomer: true,
      signedByStaff: false,
      application: {
        pawnshopId: 'pawnshop-1',
        loan: {
          ticket: {
            id: 11,
            lifecycleStatus: 'OFFER_MADE',
          },
        },
      },
    });
    prisma.loanContract.update.mockResolvedValue({
      id: 'contract-1',
      contractNumber: 'CTR-TEST-001',
      staffSignedAt: signedAt,
    });
    prisma.ticket.update.mockResolvedValue({ id: 11, lifecycleStatus: 'CONTRACT_SIGNED' });

    const result = await service.signByStaff('app-1', 'staff-1', 'signature');

    expect(result).toEqual({
      id: 'contract-1',
      contractNumber: 'CTR-TEST-001',
      staffSignedAt: signedAt,
    });
    expect(prisma.loanContract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: {
        staffSignature: 'signature',
        staffSignedAt: expect.any(Date),
        signedByStaff: true,
        staffId: 'staff-1',
      },
    });
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: {
        lifecycleStatus: 'CONTRACT_SIGNED',
        contractId: 'contract-1',
      },
    });
    expect(legalProofService.createProof).toHaveBeenCalledWith(expect.objectContaining({
      pawnshopId: 'pawnshop-1',
      recordType: 'CONTRACT_PROOF',
      createdBy: 'staff-1',
      applicationId: 'app-1',
      contractId: 'contract-1',
    }));
  });
});
