import { createHmac } from 'node:crypto';
import {
  MFA_ASSERTION_ERROR_CODES,
  MFA_ASSERTION_HEADER,
  MfaAssertionService,
} from './mfa-assertion.service';

const TEST_PEPPER = 'test-only-mfa-assertion-pepper-00000000000000000000';
const PROFILE_ID = '5b8e1a70-6d34-4c2f-9a15-3f7c8d9e0b1a';
const OTHER_SESSION_ID = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';

describe('MfaAssertionService', () => {
  const mfaSessionAssertion = {
    create: jest.fn(),
    findFirst: jest.fn(),
  };
  const prisma = { mfaSessionAssertion } as never;
  let service: MfaAssertionService;
  const originalPepper = process.env.MFA_CODE_HMAC_PEPPER;

  const storedRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'assertion-1',
    profileId: PROFILE_ID,
    sessionId: 'session-current',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  const hashFor = (token: string) =>
    createHmac('sha256', TEST_PEPPER).update(token).digest('hex');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MFA_CODE_HMAC_PEPPER = TEST_PEPPER;
    mfaSessionAssertion.create.mockResolvedValue(storedRow());
    mfaSessionAssertion.findFirst.mockResolvedValue(storedRow());
    service = new MfaAssertionService(prisma);
  });

  afterAll(() => {
    if (originalPepper === undefined) delete process.env.MFA_CODE_HMAC_PEPPER;
    else process.env.MFA_CODE_HMAC_PEPPER = originalPepper;
  });

  const serializedPrismaCalls = () => JSON.stringify({
    create: mfaSessionAssertion.create.mock.calls,
    findFirst: mfaSessionAssertion.findFirst.mock.calls,
  });

  describe('issue', () => {
    it('returns an opaque base64url assertion bound to the profile and session', async () => {
      const issued = await service.issue(PROFILE_ID, 'session-current');

      expect(issued.assertion).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('persists only the one-way hash of the assertion', async () => {
      const issued = await service.issue(PROFILE_ID, 'session-current');
      const data = mfaSessionAssertion.create.mock.calls[0][0].data;

      expect(data.profileId).toBe(PROFILE_ID);
      expect(data.sessionId).toBe('session-current');
      expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.tokenHash).not.toBe(issued.assertion);
      expect(data.tokenHash).toBe(hashFor(issued.assertion));
    });

    it('keeps the raw assertion out of every Prisma call', async () => {
      const issued = await service.issue(PROFILE_ID, 'session-current');

      expect(serializedPrismaCalls()).not.toContain(issued.assertion);
    });

    it('never repeats an assertion value', async () => {
      const first = await service.issue(PROFILE_ID, 'session-current');
      const second = await service.issue(PROFILE_ID, 'session-current');

      expect(first.assertion).not.toBe(second.assertion);
    });

    it('expires the assertion after fifteen minutes', async () => {
      const before = Date.now();
      const issued = await service.issue(PROFILE_ID, 'session-current');
      const ttl = issued.expiresAt.getTime() - before;

      expect(ttl).toBeGreaterThan(14 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
      expect(MfaAssertionService.TTL_MS).toBe(15 * 60 * 1000);
    });

    it.each([
      ['a missing profile', '', 'session-current'],
      ['a blank profile', '   ', 'session-current'],
      ['a missing session', PROFILE_ID, ''],
      ['a blank session', PROFILE_ID, '  '],
    ])('refuses to issue for %s', async (_label, profileId, sessionId) => {
      await expect(service.issue(profileId, sessionId)).rejects.toThrow(
        /profile and session are required/i,
      );
      expect(mfaSessionAssertion.create).not.toHaveBeenCalled();
    });

    it('keeps the binding failure free of server secrets', async () => {
      const failure = await service.issue('', '').then(
        () => null,
        (error: Error) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).not.toContain(TEST_PEPPER);
      expect(mfaSessionAssertion.create).not.toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    it('accepts the exact profile, session, and token tuple before expiry', async () => {
      const token = 'a'.repeat(43);
      mfaSessionAssertion.findFirst.mockResolvedValue(
        storedRow({ tokenHash: hashFor(token) }),
      );

      await expect(
        service.validate(PROFILE_ID, 'session-current', token),
      ).resolves.toBe(true);
    });

    it('queries the full binding tuple and an unexpired window', async () => {
      const token = 'b'.repeat(43);
      mfaSessionAssertion.findFirst.mockResolvedValue(
        storedRow({ tokenHash: hashFor(token) }),
      );

      await service.validate(PROFILE_ID, 'session-current', token);

      expect(mfaSessionAssertion.findFirst).toHaveBeenCalledWith({
        where: {
          profileId: PROFILE_ID,
          sessionId: 'session-current',
          tokenHash: hashFor(token),
          expiresAt: { gt: expect.any(Date) },
        },
        select: { id: true, tokenHash: true },
      });
    });

    it('keeps the presented assertion out of every Prisma call', async () => {
      const token = 'c'.repeat(43);

      await service.validate(PROFILE_ID, 'session-current', token);

      expect(serializedPrismaCalls()).not.toContain(token);
    });

    it.each([
      ['no assertion is presented', undefined],
      ['an empty assertion is presented', ''],
      ['a blank assertion is presented', '   '],
    ])('denies when %s', async (_label, presented) => {
      await expect(
        service.validate(PROFILE_ID, 'session-current', presented),
      ).resolves.toBe(false);
      expect(mfaSessionAssertion.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      ['no profile is resolved', '', 'session-current'],
      ['no session is resolved', PROFILE_ID, ''],
    ])('denies when %s', async (_label, profileId, sessionId) => {
      await expect(service.validate(profileId, sessionId, 'd'.repeat(43))).resolves.toBe(
        false,
      );
      expect(mfaSessionAssertion.findFirst).not.toHaveBeenCalled();
    });

    it('denies an assertion that belongs to another session', async () => {
      mfaSessionAssertion.findFirst.mockResolvedValue(null);

      await expect(
        service.validate(PROFILE_ID, OTHER_SESSION_ID, 'e'.repeat(43)),
      ).resolves.toBe(false);
      expect(mfaSessionAssertion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sessionId: OTHER_SESSION_ID }),
        }),
      );
    });

    it('denies an expired assertion', async () => {
      mfaSessionAssertion.findFirst.mockResolvedValue(null);

      await expect(
        service.validate(PROFILE_ID, 'session-current', 'f'.repeat(43)),
      ).resolves.toBe(false);
    });

    it('denies a wrong token', async () => {
      mfaSessionAssertion.findFirst.mockResolvedValue(null);

      await expect(
        service.validate(PROFILE_ID, 'session-current', 'g'.repeat(43)),
      ).resolves.toBe(false);
    });

    it('denies instead of throwing when the assertion store is unavailable', async () => {
      mfaSessionAssertion.findFirst.mockRejectedValue(new Error('database unavailable'));

      await expect(
        service.validate(PROFILE_ID, 'session-current', 'h'.repeat(43)),
      ).resolves.toBe(false);
    });

    it('denies a stored hash of an unexpected length without throwing', async () => {
      mfaSessionAssertion.findFirst.mockResolvedValue(storedRow({ tokenHash: 'short' }));

      await expect(
        service.validate(PROFILE_ID, 'session-current', 'i'.repeat(43)),
      ).resolves.toBe(false);
    });
  });

  describe('cross-client assertion contract', () => {
    it('names the assertion header and denial code the clients branch on', () => {
      expect(MFA_ASSERTION_HEADER).toBe('x-mfa-assertion');
      expect(MFA_ASSERTION_ERROR_CODES.VERIFICATION_REQUIRED).toBe(
        'MFA_VERIFICATION_REQUIRED',
      );
    });

    it('issues one opaque assertion per verified challenge so the raw value is single-use', async () => {
      const issued = await service.issue(PROFILE_ID, 'session-current');

      expect(issued.assertion).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(mfaSessionAssertion.create).toHaveBeenCalledTimes(1);
    });

    it('never returns the stored hash, the code, or the pepper alongside the assertion', async () => {
      const issued = await service.issue(PROFILE_ID, 'session-current');
      const data = mfaSessionAssertion.create.mock.calls[0][0].data;

      expect(Object.keys(issued).sort()).toEqual(['assertion', 'expiresAt']);
      expect(JSON.stringify(issued)).not.toContain(TEST_PEPPER);
      expect(JSON.stringify(issued)).not.toContain(data.tokenHash);
      expect(JSON.stringify(issued)).not.toMatch(/\b\d{6}\b/);
    });
  });

  describe('server-side secret requirement', () => {
    it('refuses to start when the pepper is missing', () => {
      delete process.env.MFA_CODE_HMAC_PEPPER;

      expect(() => new MfaAssertionService(prisma)).toThrow(
        /MFA_CODE_HMAC_PEPPER/,
      );
    });

    it('refuses to start when the pepper is too short', () => {
      process.env.MFA_CODE_HMAC_PEPPER = 'too-short-pepper';

      expect(() => new MfaAssertionService(prisma)).toThrow(/MFA_CODE_HMAC_PEPPER/);
    });
  });
});
