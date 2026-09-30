import { AppService } from './app.service';

/**
 * Identity evidence must not carry a claim the server cannot support.
 *
 * `ocrNameMatch`, `faceMatched` and `tamperClean` arrived in the request body.
 * The status still went to PENDING and a human decided, so this was never a
 * bypass — but anything reading the stored record was shown a green tick that
 * the server had established nothing, and anyone could POST one. The server
 * performs no OCR, no face match and no document forensics, so it must not
 * record that it did.
 */
const VALID = {
  fullName: 'Juan Dela Cruz',
  dateOfBirth: '1990-05-17',
  address: '123 Mabini Street, Imus, Cavite',
  phoneNumber: '09171234567',
  idType: 'NATIONAL_ID',
  idNumber: '1234-5678-9012-3456',
  idFrontUrl: 'https://example.test/id-front.jpg',
  selfieUrl: 'https://example.test/selfie.jpg',
  liveSelfieUrl: 'https://example.test/selfie.jpg',
  selfieCaptureMode: 'LIVE',
  selfieCapturedAt: new Date().toISOString(),
};

const build = () => {
  const create = jest.fn().mockImplementation(({ data }: any) => {
    void data;
    return Promise.resolve({ id: 'kyc-1' });
  });
  const prisma = {
    bidderKyc: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create,
      update: jest.fn(),
    },
  };
  const service = Object.create(AppService.prototype) as AppService;
  (service as any).prisma = prisma;
  return { service, prisma, create };
};

const storedData = (create: jest.Mock) => create.mock.calls[0][0].data;

describe('submitKyc: the server records no check it did not perform', () => {
  it('never claims a face match, even when the client asserts one', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', { ...VALID, faceMatched: true, faceMatchScore: 0.99 });

    const data = storedData(create);
    expect(data.verificationData.face).toBeUndefined();
    expect(data.verificationData.automatedChecks.face.performed).toBe(false);
  });

  it('never claims OCR ran, even when the client reports a name match', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', {
      ...VALID,
      ocrNameMatch: true,
      ocrConfidence: 98,
      ocrExtractedName: 'JUAN DELA CRUZ',
    });

    const data = storedData(create);
    expect(data.verificationData.ocr).toBeUndefined();
    expect(data.verificationData.automatedChecks.ocr.performed).toBe(false);
  });

  it('never claims a document was clean, even when the client says so', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', { ...VALID, tamperClean: true, tamperFlags: [] });

    const data = storedData(create);
    expect(data.verificationData.tamper).toBeUndefined();
    expect(data.verificationData.automatedChecks.tamper.performed).toBe(false);
  });

  it('keeps a client assertion as an assertion, marked untrusted', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', { ...VALID, faceMatched: true });

    const { clientAsserted } = storedData(create).verificationData;
    expect(clientAsserted.faceMatched).toBe(true);
    expect(clientAsserted.trusted).toBe(false);
  });

  it('records the evidence it actually received', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', {
      ...VALID,
      idBackUrl: 'https://example.test/id-back.jpg',
    });

    const { evidence } = storedData(create).verificationData;
    expect(evidence).toEqual({
      idFrontUrl: true,
      idBackUrl: true,
      selfieUrl: true,
    });
  });

  it('does not report a back-of-ID it never received', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', VALID);

    expect(storedData(create).verificationData.evidence.idBackUrl).toBe(false);
  });

  it('still requires a human decision', async () => {
    const { service, create } = build();

    await service.submitKyc('user-1', { ...VALID, faceMatched: true });

    // A green tick on forged input is bad; auto-verifying on it would be worse.
    expect(storedData(create).status).toBe('PENDING');
    expect(storedData(create).reviewedBy).toBeNull();
  });

  it('rejects a non-live selfie whatever the client asserts', async () => {
    const { service } = build();

    await expect(
      service.submitKyc('user-1', { ...VALID, selfieCaptureMode: 'UPLOAD', faceMatched: true }),
    ).rejects.toThrow(/live/i);
  });
});
