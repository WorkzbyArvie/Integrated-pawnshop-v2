import { PublicAppraisalService, RESERVATION_WINDOW_HOURS } from './public-appraisal.service';

/**
 * An online application is a quote and a booking, never a loan.
 *
 * Three properties are load-bearing and each has been a defect class in this
 * codebase before:
 *   1. Only shops that can actually transact are listed, so nobody travels to be
 *      refused.
 *   2. The recorded figures are the server's own arithmetic, not the applicant's.
 *   3. Identity documents are captured, not "verified" - no automated check is
 *      performed, so none is claimed.
 */
const COMPLIANT_SHOP = {
  id: 'shop-1',
  name: 'Cebuana',
  address: 'Dasmarinas',
  latitude: 14.4,
  longitude: 120.9,
  contactPhone: '0917',
  settings: null as unknown,
};

const ALL_VERIFIED = [
  'DTI_SEC', 'MAYORS_PERMIT', 'BIR_CERTIFICATE', 'BSP_LICENSE',
  'AMLC_REGISTRATION', 'VALID_GOVT_ID', 'PROOF_OF_BUSINESS',
].map((documentType) => ({
  documentType,
  status: 'VERIFIED',
  expiryDate: null as Date | null,
  createdAt: new Date('2026-01-01'),
}));

const build = (
  options: {
    documents?: typeof ALL_VERIFIED;
    pawnshop?: typeof COMPLIANT_SHOP | null;
  } = {},
) => {
  const created: any[] = [];
  const prisma = {
    pawnshop: {
      findMany: jest.fn().mockResolvedValue([COMPLIANT_SHOP]),
      findUnique: jest.fn().mockResolvedValue(options.pawnshop === undefined ? COMPLIANT_SHOP : options.pawnshop),
    },
    branch: {
      findMany: jest.fn().mockResolvedValue([
        { id: 3, name: 'Main', location: 'Dasmarinas', pawnshopId: 'shop-1' },
      ]),
    },
    pawnshopDocument: {
      findMany: jest.fn().mockResolvedValue(options.documents ?? ALL_VERIFIED),
    },
    pawnReservation: {
      create: jest.fn().mockImplementation(({ data }: { data: any }) => {
        // Prisma applies the column defaults; the mock has to as well, or
        // `present` reads an undefined `createdAt` and throws on a row that
        // would exist in production.
        const row = {
          id: 'res-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          status: 'PENDING',
          kycStatus: 'PENDING',
          rejectionReason: null,
          ...data,
        };
        created.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };

  const service = Object.create(PublicAppraisalService.prototype) as PublicAppraisalService;
  (service as any).prisma = prisma;
  (service as any).storage = { uploadImage: jest.fn().mockResolvedValue('https://cdn.test/x.jpg') };
  (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return { service, prisma, created, storage: (service as any).storage };
};

const quoteDto = {
  pawnshopId: 'shop-1',
  itemCategory: 'Silver Jewelry',
  weight: 10,
};

const applicationDto = {
  pawnshopId: 'shop-1',
  customerName: 'Juan Dela Cruz',
  contactNumber: '09171234567',
  address: 'Imus, Cavite',
  itemCategory: 'Silver Jewelry',
  weight: 10,
};

describe('listBranches', () => {
  it('lists a shop whose documents are all verified', async () => {
    const { service } = build();
    const branches = await service.listBranches();

    expect(branches).toHaveLength(1);
    expect(branches[0].pawnshopName).toBe('Cebuana');
    expect(branches[0].branches[0].id).toBe(3);
  });

  it('hides a shop that is missing a document', async () => {
    const { service } = build({
      documents: ALL_VERIFIED.filter((d) => d.documentType !== 'BSP_LICENSE'),
    });

    expect(await service.listBranches()).toEqual([]);
  });

  it('hides a shop with an unverified document', async () => {
    const { service } = build({
      documents: ALL_VERIFIED.map((d) =>
        d.documentType === 'MAYORS_PERMIT' ? { ...d, status: 'PENDING' } : d,
      ),
    });

    expect(await service.listBranches()).toEqual([]);
  });

  it('hides a shop with an expired document', async () => {
    const { service } = build({
      documents: ALL_VERIFIED.map((d) =>
        d.documentType === 'BIR_CERTIFICATE'
          ? { ...d, expiryDate: new Date('2020-01-01') }
          : d,
      ),
    });

    expect(await service.listBranches()).toEqual([]);
  });

  it('judges the latest upload, not a stale verified one underneath', async () => {
    const { service } = build({
      documents: [
        { documentType: 'DTI_SEC', status: 'VERIFIED', expiryDate: null, createdAt: new Date('2026-01-01') },
        { documentType: 'DTI_SEC', status: 'DENIED', expiryDate: null, createdAt: new Date('2026-06-01') },
        ...ALL_VERIFIED.filter((d) => d.documentType !== 'DTI_SEC'),
      ],
    });

    expect(await service.listBranches()).toEqual([]);
  });
});

describe('quote', () => {
  it('prices from the shop rate table and records both figures', async () => {
    const { service } = build();
    const quote = await service.quote(quoteDto);

    expect(quote.appraisedValue).toBe(800);
    expect(quote.recommendedLoanAmount).toBe(440);
    // The whole point: they are different numbers.
    expect(quote.appraisedValue).not.toBe(quote.recommendedLoanAmount);
  });

  it('states a 90-day grace period and a 30-day term', async () => {
    const { service } = build();
    const quote = await service.quote(quoteDto);

    expect(quote.termDays).toBe(30);
    expect(quote.gracePeriodDays).toBe(90);
  });

  it('refuses a branch that cannot transact', async () => {
    const { service } = build({ documents: [] });

    await expect(service.quote(quoteDto)).rejects.toThrow(/cannot accept pawns/i);
  });

  it('demands a branch', async () => {
    const { service } = build();

    await expect(service.quote({ ...quoteDto, pawnshopId: '' })).rejects.toThrow(
      /choose a branch/i,
    );
  });

  it('scores a remote quote as not assessed, never as failed', async () => {
    const { service } = build();
    const quote = await service.quote(quoteDto);

    // Nobody has inspected the item or the applicant, and the quote must not
    // claim either failed. This is the defect that made every POS quote 85%.
    expect(quote.risk.factors).toContain('ID not assessed');
    expect(quote.risk.factors).toContain('KYC not assessed');
    expect(quote.risk.factors).not.toContain('ID not verified');
    expect(quote.risk.score).toBeLessThan(70);
  });

  it('never blocks on a remote quote', async () => {
    const { service } = build();
    const quote = await service.quote(quoteDto);

    // Only a physical inspection can establish a counterfeit, and that has not
    // happened yet. Blocking here would refuse every application.
    expect(quote.risk.blocking).toBe(false);
  });
});

describe('create', () => {
  it('stores the reference, the expiry and the quote', async () => {
    const { service, prisma } = build();

    const result = await service.create(applicationDto as never);

    expect(result.reference).toMatch(/^RSV-[0-9A-Z]{5}-[0-9A-Z]{4}$/);
    expect(prisma.pawnReservation.create).toHaveBeenCalled();
    expect(result.expiresAt).toBeDefined();
  });

  it('holds the quoted rate for the window, not indefinitely', async () => {
    const { service } = build();
    const before = Date.now();

    const result = await service.create(applicationDto as never);

    const expires = new Date(result.expiresAt).getTime();
    const expected = before + RESERVATION_WINDOW_HOURS * 60 * 60 * 1000;
    expect(Math.abs(expires - expected)).toBeLessThan(5_000);
  });

  it('records the valuation and the loan as different figures', async () => {
    const { service } = build();

    const result = await service.create(applicationDto as never);

    expect(result.appraisedValue).toBe(800);
    expect(result.recommendedLoanAmount).toBe(440);
  });

  it('records identity evidence as PENDING, never VERIFIED', async () => {
    const { service } = build();

    const result = await service.create({
      ...applicationDto,
      idType: 'NATIONAL_ID',
      idNumber: '1234-5678-9012-3456',
      idFrontUrl: 'https://example.test/id-front.jpg',
      selfieUrl: 'https://example.test/selfie.jpg',
    } as never);

    // Receiving a photograph of an ID is not verification of the person in it.
    // A reviewer adjudicates and stamps who and when.
    expect(result.kycStatus).toBe('PENDING');
  });

  it('claims no automated check it did not perform', async () => {
    const { service, prisma } = build();

    await service.create({
      ...applicationDto,
      idFrontUrl: 'https://example.test/id-front.jpg',
      selfieUrl: 'https://example.test/selfie.jpg',
    } as never);

    const data = prisma.pawnReservation.create.mock.calls[0][0].data;
    const verification = data.verificationData as any;

    expect(verification.automatedChecksPerformed).toEqual([]);
    expect(verification.evidence.idFrontUrl).toBe(true);
    expect(verification.evidence.selfieUrl).toBe(true);
  });

  it('accepts no client assertion that a face matched', async () => {
    const { service, prisma } = build();

    // A caller sending `faceMatched: true` must not be able to influence what is
    // recorded. The DTO has no such field and the service reads none.
    await service.create({
      ...applicationDto,
      idFrontUrl: 'https://example.test/id-front.jpg',
      faceMatched: true,
      ocrNameMatch: true,
    } as never);

    const verification =
      prisma.pawnReservation.create.mock.calls[0][0].data.verificationData as any;

    expect(verification.face).toBeUndefined();
    expect(verification.ocr).toBeUndefined();
  });

  it('refuses a reservation at a shop that cannot transact', async () => {
    const { service, prisma } = build({ documents: [] });

    await expect(service.create(applicationDto as never)).rejects.toThrow(
      /cannot accept pawns/i,
    );
    expect(prisma.pawnReservation.create).not.toHaveBeenCalled();
  });

  it('never returns the identity document URLs to the applicant', async () => {
    const { service } = build();

    const result = await service.create({
      ...applicationDto,
      idFrontUrl: 'https://example.test/id-front.jpg',
      idBackUrl: 'https://example.test/id-back.jpg',
      selfieUrl: 'https://example.test/selfie.jpg',
    } as never);

    // The reference is an unauthenticated capability, so it must not be a way to
    // read someone's ID photographs.
    expect(JSON.stringify(result)).not.toContain('id-front.jpg');
    expect(JSON.stringify(result)).not.toContain('selfie.jpg');
  });
});

describe('storeApplicantUpload', () => {
  const png = (extra: Record<string, unknown> = {}) => ({
    buffer: Buffer.from('fake-bytes'),
    mimetype: 'image/png',
    size: 1024,
    ...extra,
  });

  it('never lets the client choose where the file is written', async () => {
    const { service, storage } = build();

    await service.storeApplicantUpload(
      png({ originalname: 'passport.png', folder: 'kyc-documents' }) as never,
      'id-front',
    );

    const [buffer, bucket, fileName] = storage.uploadImage.mock.calls[0];

    // `auth/kyc/upload` takes a client `folder` and builds the name from the
    // client's filename. Behind a session that is fine; on an open route it is
    // an arbitrary-write primitive — a caller could aim at `kyc-documents` and
    // overwrite an existing identity document.
    expect(String(fileName)).not.toContain('passport');
    expect(String(fileName)).not.toContain('kyc-documents');
    expect(String(fileName)).toMatch(
      /^applicant\/id-front\/[0-9a-f-]{36}\.png$/,
    );
    expect(buffer).toBeInstanceOf(Buffer);
    void bucket;
  });

  it('takes the extension from the declared type, not the filename', async () => {
    const { service, storage } = build();

    // A caller naming a file `.html` must not get an `.html` in the bucket.
    await service.storeApplicantUpload(
      png({ originalname: 'id.html', mimetype: 'image/png' }) as never,
      'id-front',
    );

    expect(storage.uploadImage.mock.calls[0][2]).toMatch(/\.png$/);
  });

  it('refuses a type that is not a photograph', async () => {
    const { service, storage } = build();

    await expect(
      service.storeApplicantUpload(png({ mimetype: 'text/html' }) as never, 'item'),
    ).rejects.toThrow(/JPEG, PNG, WebP or HEIC/i);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('refuses an SVG, which is a script vector', async () => {
    const { service } = build();

    await expect(
      service.storeApplicantUpload(png({ mimetype: 'image/svg+xml' }) as never, 'item'),
    ).rejects.toThrow();
  });

  it('refuses an oversized upload', async () => {
    const { service, storage } = build();

    await expect(
      service.storeApplicantUpload(png({ size: 9 * 1024 * 1024 }) as never, 'item'),
    ).rejects.toThrow(/larger than 5 MB/i);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('falls back to a neutral folder for an unrecognised kind', async () => {
    const { service, storage } = build();

    // A caller cannot ask for an arbitrary subfolder; anything unrecognised
    // lands in `other` rather than being honoured.
    await service.storeApplicantUpload(png() as never, '../../kyc-documents');

    expect(storage.uploadImage.mock.calls[0][2]).toMatch(
      /^applicant\/other\/[0-9a-f-]{36}\.png$/,
    );
  });

  it('gives every upload its own unguessable name', async () => {
    const { service, storage } = build();

    await service.storeApplicantUpload(png() as never, 'item');
    await service.storeApplicantUpload(png() as never, 'item');

    const [first, second] = storage.uploadImage.mock.calls.map((c) => c[2]);
    expect(first).not.toBe(second);
  });
});

describe('findByReference', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'res-1',
    reference: 'RSV-ABCDE-1234',
    status: 'PENDING',
    pawnshopId: 'shop-1',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    customerName: 'Juan Dela Cruz',
    contactNumber: '0917',
    address: 'Imus',
    itemCategory: 'Silver Jewelry',
    itemDescription: null,
    weightGrams: 10,
    purityPercent: null,
    photoUrls: [],
    appraisedValue: 800,
    recommendedLoanAmount: 440,
    gramRate: 80,
    ltvRatio: 0.55,
    termDays: 30,
    maturityDate: new Date(),
    gracePeriodDays: 90,
    belowStatutoryMinimum: false,
    riskScore: 40,
    riskBand: 'HIGH',
    kycStatus: 'PENDING',
    rejectionReason: null,
    ...overrides,
  });

  it('finds an application by its reference', async () => {
    const { service, prisma } = build();
    prisma.pawnReservation.findUnique.mockResolvedValue(stored());

    const result = await service.findByReference('RSV-ABCDE-1234');
    expect(result.reference).toBe('RSV-ABCDE-1234');
  });

  it('reads a lapsed window as EXPIRED without needing a job to run', async () => {
    const { service, prisma } = build();
    prisma.pawnReservation.findUnique.mockResolvedValue(
      stored({ expiresAt: new Date(Date.now() - 1000) }),
    );
    prisma.pawnReservation.update.mockResolvedValue(
      stored({ status: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) }),
    );

    const result = await service.findByReference('RSV-ABCDE-1234');

    expect(result.status).toBe('EXPIRED');
  });

  it('reports an unknown reference as not found', async () => {
    const { service, prisma } = build();
    prisma.pawnReservation.findUnique.mockResolvedValue(null);

    await expect(service.findByReference('RSV-NOPE-0000')).rejects.toThrow(
      /no application matches/i,
    );
  });

  it('never returns the identity document URLs', async () => {
    const { service, prisma } = build();
    prisma.pawnReservation.findUnique.mockResolvedValue(
      stored({ idFrontUrl: 'https://example.test/id-front.jpg' }),
    );

    const result = await service.findByReference('RSV-ABCDE-1234');
    expect(JSON.stringify(result)).not.toContain('id-front.jpg');
  });
});
