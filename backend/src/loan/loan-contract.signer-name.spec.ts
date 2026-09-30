import { LoanContractService } from './loan-contract.service';

/**
 * The contract PDF printed a signature and a role but no name, so the document
 * could not say who had signed it.
 *
 * The name is snapshotted onto the contract row at signing time rather than
 * joined at render time. That distinction is the whole point: a staff record can
 * be deleted and a customer can be renamed, and a signed contract is evidence,
 * so it must keep saying the name that was signed. These tests pin the snapshot,
 * not just the rendering.
 */
const CONTRACT_ID = 'contract-1';
const APPLICATION_ID = 'app-1';
const STAFF_ID = 'staff-1';

const buildService = (
  options: {
    signedByCustomer?: boolean;
    signedByStaff?: boolean;
    customerFullName?: string | null;
    staffFullName?: string | null;
  } = {},
) => {
  const customerFullName = options.customerFullName ?? 'Juan Dela Cruz';
  const staffFullName = options.staffFullName === undefined ? 'Maria Santos' : options.staffFullName;

  const contract = {
    id: CONTRACT_ID,
    contractNumber: 'CTR-TEST-001',
    customerSignature: 'sig',
    customerSignedAt: new Date('2026-09-30T11:00:00.000Z'),
    customerSignerName: null as string | null,
    staffSignature: null as string | null,
    staffSignedAt: null as Date | null,
    staffId: null as string | null,
    staffSignerName: null as string | null,
    signedByCustomer: options.signedByCustomer ?? false,
    signedByStaff: options.signedByStaff ?? false,
    application: {
      pawnshopId: 'shop-1',
      customerId: 'cust-1',
      customer: { fullName: customerFullName },
      loan: { ticket: { id: 7, lifecycleStatus: 'CONTRACT_GENERATED' } },
    },
  };

  const prisma = {
    loanContract: {
      findUnique: jest.fn().mockResolvedValue(contract),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(contract, data);
        return Promise.resolve(contract);
      }),
    },
    staff: { findUnique: jest.fn().mockResolvedValue(staffFullName ? { fullName: staffFullName } : null) },
    ticket: { update: jest.fn().mockResolvedValue({}) },
  };

  const service = Object.create(LoanContractService.prototype) as LoanContractService;
  (service as any).prisma = prisma;
  (service as any).legalProofService = { createProof: jest.fn().mockResolvedValue({}) };
  (service as any).stateMachine = { transition: jest.fn().mockResolvedValue(undefined) };
  // `Object.create` skips class field initialisers, so the logger the service
  // declares in the field is absent here. NestJS runs it in production.
  (service as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

  return { service, prisma, contract };
};

describe('signByCustomer', () => {
  it('snapshots the borrower name onto the contract', async () => {
    const { service, prisma, contract } = buildService();

    await service.signByCustomer(APPLICATION_ID, 'signature-data');

    expect(prisma.loanContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONTRACT_ID },
        data: expect.objectContaining({ customerSignerName: 'Juan Dela Cruz' }),
      }),
    );
    expect(contract.customerSignerName).toBe('Juan Dela Cruz');
  });

  it('records the name in the legal proof too', async () => {
    const { service } = buildService();
    const createProof = (service as any).legalProofService.createProof;

    await service.signByCustomer(APPLICATION_ID, 'signature-data');

    // The audit trail must name the signer, not just say "the customer".
    expect(createProof).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ customerSignerName: 'Juan Dela Cruz' }),
      }),
    );
  });

  it('names the signer in the proof summary', async () => {
    const { service } = buildService();
    const createProof = (service as any).legalProofService.createProof;

    await service.signByCustomer(APPLICATION_ID, 'signature-data');

    expect(createProof.mock.calls[0][0].summary).toContain('Juan Dela Cruz');
  });

  it('does not overwrite a name on a re-signed contract', async () => {
    // It refuses, so the original name is untouched.
    const { service, contract } = buildService({ signedByCustomer: true });
    contract.customerSignerName = 'Original Name';

    await expect(service.signByCustomer(APPLICATION_ID, 'sig')).rejects.toThrow(
      /already signed/i,
    );
    expect(contract.customerSignerName).toBe('Original Name');
  });

  it('tolerates a customer record with no name', async () => {
    const { service } = buildService({ customerFullName: null });

    await expect(service.signByCustomer(APPLICATION_ID, 'sig')).resolves.toBeDefined();
  });
});

describe('signByStaff', () => {
  it('snapshots the staff name onto the contract', async () => {
    const { service, prisma, contract } = buildService({ signedByCustomer: true });

    await service.signByStaff(APPLICATION_ID, STAFF_ID, 'signature-data', 'OWNER');

    expect(prisma.loanContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ staffSignerName: 'Maria Santos' }),
      }),
    );
    expect(contract.staffSignerName).toBe('Maria Santos');
  });

  it('resolves the name from the staff record at signing time', async () => {
    const { service, prisma } = buildService({ signedByCustomer: true });

    await service.signByStaff(APPLICATION_ID, STAFF_ID, 'sig', 'OWNER');

    expect(prisma.staff.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STAFF_ID } }),
    );
  });

  it('still signs when the staff record no longer exists', async () => {
    // A deleted account must not block a signing that has already legally
    // happened. The contract signs without a printed name instead of failing.
    const { service, contract } = buildService({
      signedByCustomer: true,
      staffFullName: null,
    });

    await expect(
      service.signByStaff(APPLICATION_ID, STAFF_ID, 'sig', 'OWNER'),
    ).resolves.toBeDefined();

    expect(contract.signedByStaff).toBe(true);
    expect(contract.staffSignerName).toBeNull();
  });

  it('records the name in the legal proof', async () => {
    const { service } = buildService({ signedByCustomer: true });
    const createProof = (service as any).legalProofService.createProof;

    await service.signByStaff(APPLICATION_ID, STAFF_ID, 'sig', 'OWNER');

    expect(createProof.mock.calls[0][0].payload.staffSignerName).toBe('Maria Santos');
  });

  it('refuses to sign before the customer has', async () => {
    const { service } = buildService({ signedByCustomer: false });

    await expect(service.signByStaff(APPLICATION_ID, STAFF_ID, 'sig', 'OWNER')).rejects.toThrow(
      /before staff signing/i,
    );
  });
});

/**
 * The PDF for an *already signed* contract, which was signed before the
 * snapshot columns existed.
 *
 * This is the case the operator actually hit: a contract signed and stored, then
 * the download rendering a signature with no name against it. The borrower has a
 * fallback because their name is in `contract_data`; the staff did not, so every
 * existing contract printed a nameless staff signature. `staff_id` is on the row
 * and is real evidence of who signed, so it is the right thing to reconstruct
 * from.
 */
describe('downloadContractPdf name fallbacks', () => {
  const build = (contractOverrides: Record<string, unknown>, staffRow: unknown) => {
    const contract = {
      id: CONTRACT_ID,
      contractNumber: 'CTR-EXISTING',
      contractData: { customerName: 'Juan Dela Cruz', loanAmount: '440.00' },
      application: { pawnshopId: 'shop-1' },
      customerSignature: 'sig',
      customerSignedAt: new Date('2026-09-30T11:00:00.000Z'),
      customerSignerName: null,
      staffSignature: 'sig',
      staffSignedAt: new Date('2026-09-30T11:05:00.000Z'),
      staffId: null as string | null,
      staffSignerName: null as string | null,
      ...contractOverrides,
    };

    const renderPdfOnly = jest.fn().mockResolvedValue({
      pdfBuffer: Buffer.from('pdf'),
      htmlContent: '<p>x</p>',
    });
    const staffFindUnique = jest.fn().mockResolvedValue(staffRow);

    const service = Object.create(LoanContractService.prototype) as LoanContractService;
    (service as any).prisma = {
      loanContract: { findUnique: jest.fn().mockResolvedValue(contract) },
      staff: { findUnique: staffFindUnique },
    };
    (service as any).contractRenderer = { renderPdfOnly };
    (service as any).getCustomContractSections = jest.fn().mockResolvedValue([]);
    (service as any).logger = { warn: jest.fn(), error: jest.fn() };

    return { service, renderPdfOnly, staffFindUnique };
  };

  const signaturesOf = (renderPdfOnly: jest.Mock) => renderPdfOnly.mock.calls[0][2];

  it('falls back to contract_data for a borrower signed before the snapshot', async () => {
    const { service, renderPdfOnly } = build({ staffId: null }, null);

    await service.downloadContractPdf(CONTRACT_ID, 'shop-1', 'OWNER');

    expect(signaturesOf(renderPdfOnly).customerName).toBe('Juan Dela Cruz');
  });

  it('reconstructs the staff name from staff_id for a pre-snapshot contract', async () => {
    const { service, renderPdfOnly } = build(
      { staffId: STAFF_ID },
      { fullName: 'Maria Santos' },
    );

    await service.downloadContractPdf(CONTRACT_ID, 'shop-1', 'OWNER');

    expect(signaturesOf(renderPdfOnly).staffName).toBe('Maria Santos');
  });

  it('prefers the snapshot over the join when both exist', async () => {
    // A renamed staff member must not change what a signed contract says. The
    // snapshot wins; the join is only for the past.
    const { service, renderPdfOnly, staffFindUnique } = build(
      { staffId: STAFF_ID, staffSignerName: 'Name At Signing' },
      { fullName: 'Renamed Later' },
    );

    await service.downloadContractPdf(CONTRACT_ID, 'shop-1', 'OWNER');

    expect(signaturesOf(renderPdfOnly).staffName).toBe('Name At Signing');
    expect(staffFindUnique).not.toHaveBeenCalled();
  });

  it('does not query for a staff record when none was recorded', async () => {
    const { service, staffFindUnique } = build({ staffId: null }, { fullName: 'X' });

    await service.downloadContractPdf(CONTRACT_ID, 'shop-1', 'OWNER');

    expect(staffFindUnique).not.toHaveBeenCalled();
  });

  it('leaves the name null when the staff record has since been deleted', async () => {
    // No crash and no invented name - the block degrades to its placeholder.
    const { service, renderPdfOnly } = build({ staffId: STAFF_ID }, null);

    await service.downloadContractPdf(CONTRACT_ID, 'shop-1', 'OWNER');

    expect(signaturesOf(renderPdfOnly).staffName).toBeNull();
  });
});
