import { LoanContractService } from './loan-contract.service';

/**
 * `GET /loan/contracts/:contractId/pdf` renders the signed loan contract - the
 * document offered as proof of the whole transaction. It was reachable by any
 * authenticated profile, and the lookup was a bare primary-key read with no
 * tenant check, so one shop's manager could render another shop's signed
 * contract by guessing an id.
 *
 * A permission answers "may this role read a contract". It does not answer
 * "whose". These tests pin the second half.
 */
const prismaFor = (contract: unknown) => ({
  loanContract: { findUnique: jest.fn().mockResolvedValue(contract) },
});

const contractFor = (shopId: string | null) => ({
  id: 'ctr-1',
  contractNumber: 'CTR-MUNJDK96-D0253C4B',
  contractData: { renderedHtml: '<p>contract</p>' },
  customerSignature: 'sig',
  customerSignedAt: new Date('2026-09-30T11:00:00.000Z'),
  staffSignature: 'sig',
  staffSignedAt: new Date('2026-09-30T11:05:00.000Z'),
  application: { pawnshopId: shopId },
});

const rendererFor = () => ({
  renderPdfOnly: jest.fn().mockResolvedValue({ pdfBuffer: Buffer.from('pdf') }),
});

const sectionsFor = () => ({ getCustomContractSections: jest.fn().mockResolvedValue([]) });

describe('downloadContractPdf tenant scoping', () => {
  const build = (shopId: string | null) => {
    const prisma = prismaFor(contractFor(shopId));
    const service = Object.create(LoanContractService.prototype) as LoanContractService;
    (service as any).prisma = prisma;
    (service as any).contractRenderer = rendererFor();
    (service as any).getCustomContractSections = sectionsFor().getCustomContractSections;
    return service;
  };

  it('serves a contract belonging to the caller own shop', async () => {
    const service = build('shop-a');

    const result = await service.downloadContractPdf('ctr-1', 'shop-a', 'MANAGER');

    expect(result.contractNumber).toBe('CTR-MUNJDK96-D0253C4B');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
  });

  it('refuses a contract from another shop', async () => {
    // The defect: a bare `findUnique({ where: { id } })` with no tenant check.
    const service = build('shop-b');

    // 404 rather than 403 - a 403 would confirm the id exists, which is itself
    // a disclosure about another shop's records.
    await expect(service.downloadContractPdf('ctr-1', 'shop-a', 'MANAGER')).rejects.toThrow(
      'Contract not found',
    );
  });

  it('renders nothing when it refuses', async () => {
    const service = build('shop-b');

    await expect(service.downloadContractPdf('ctr-1', 'shop-a', 'MANAGER')).rejects.toThrow();

    expect((service as any).contractRenderer.renderPdfOnly).not.toHaveBeenCalled();
  });

  it('refuses when the caller has no tenant at all', async () => {
    const service = build('shop-a');

    await expect(service.downloadContractPdf('ctr-1', null, 'MANAGER')).rejects.toThrow(
      'Contract not found',
    );
  });

  it('refuses when the contract has no owning shop', async () => {
    const service = build(null);

    await expect(service.downloadContractPdf('ctr-1', 'shop-a', 'MANAGER')).rejects.toThrow(
      'Contract not found',
    );
  });

  it('lets a super admin read across tenants at the service layer', async () => {
    // Defence in depth, and note this is NOT reachable over HTTP:
    // `RbacGuard` holds super admin to an allowlist and `/loan` is not a
    // governance prefix, so the guard refuses before the service runs. The
    // exemption matters only if this service is ever called from a non-HTTP
    // path. Cross-tenant support access is delivered by a separate mechanism
    // (`/tenant-governance/request-support-access`), not by widening this route.
    const service = build('shop-b');

    const result = await service.downloadContractPdf('ctr-1', 'shop-a', 'SUPER_ADMIN');

    expect(result.contractNumber).toBe('CTR-MUNJDK96-D0253C4B');
  });

  it('still 404s an id that does not exist', async () => {
    const prisma = prismaFor(null);
    const service = Object.create(LoanContractService.prototype) as LoanContractService;
    (service as any).prisma = prisma;
    (service as any).contractRenderer = rendererFor();
    (service as any).getCustomContractSections = jest.fn();

    await expect(service.downloadContractPdf('missing', 'shop-a', 'MANAGER')).rejects.toThrow(
      'Contract not found',
    );
  });
});
