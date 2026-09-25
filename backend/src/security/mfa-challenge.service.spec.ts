import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MfaEnableChallengeDto } from './dto/mfa-enable-challenge.dto';
import { MfaLoginChallengeDto } from './dto/mfa-login-challenge.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { MfaChallengeService } from './mfa-challenge.service';
import { SecurityEmailService } from './security-email.service';

const TEST_PEPPER = 'test-pepper-with-more-than-32-characters-123456';

async function validateDto<T extends object>(
  cls: new () => T,
  value: Record<string, unknown>,
) {
  return validate(plainToInstance(cls, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('MfaChallengeService', () => {
  const originalPepper = process.env.MFA_CODE_HMAC_PEPPER;
  let tx: any;
  let prisma: any;
  let emailService: { send: jest.Mock };
  let service: MfaChallengeService;

  beforeEach(() => {
    process.env.MFA_CODE_HMAC_PEPPER = TEST_PEPPER;
    tx = {
      mfaEmailChallenge: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
      mfaEmailChallenge: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    service = new MfaChallengeService(prisma, emailService as unknown as SecurityEmailService);
  });

  afterAll(() => {
    if (originalPepper === undefined) delete process.env.MFA_CODE_HMAC_PEPPER;
    else process.env.MFA_CODE_HMAC_PEPPER = originalPepper;
  });

  it('refuses construction without a sufficiently long pepper', () => {
    const previous = process.env.MFA_CODE_HMAC_PEPPER;
    process.env.MFA_CODE_HMAC_PEPPER = 'too-short';
    expect(
      () => new MfaChallengeService(prisma, emailService as unknown as SecurityEmailService),
    ).toThrow('MFA_CODE_HMAC_PEPPER');
    process.env.MFA_CODE_HMAC_PEPPER = previous;
  });

  it('issues a CSPRNG code, stores only an HMAC, and returns no code', async () => {
    const created = {
      id: 'challenge-1',
      expiresAt: new Date(Date.now() + 600000),
    };
    tx.mfaEmailChallenge.create.mockResolvedValue(created);
    const randomInt = jest.spyOn(require('node:crypto'), 'randomInt').mockReturnValue(7);

    const result = await service.issue({
      profileId: 'profile-1',
      email: 'person@example.com',
      purpose: 'MFA_ENABLE',
      sessionId: 'session-1',
    });

    expect(randomInt).toHaveBeenCalledWith(0, 1000000);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: '000007', email: 'person@example.com' }),
    );
    const createData = tx.mfaEmailChallenge.create.mock.calls[0][0].data;
    expect(createData.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createData.codeHash).not.toContain('000007');
    expect(createData).toMatchObject({
      profileId: 'profile-1',
      purpose: 'MFA_ENABLE',
      sessionId: 'session-1',
      attempts: 0,
      maxAttempts: 5,
    });
    expect(result).toEqual({
      challengeId: 'challenge-1',
      expiresAt: created.expiresAt,
      maskedEmail: expect.stringContaining('@example.com'),
    });
    expect(JSON.stringify(result)).not.toContain('000007');
  });

  it('does not expose provider error details when delivery fails', async () => {
    const created = {
      id: 'challenge-1',
      expiresAt: new Date(Date.now() + 600000),
    };
    tx.mfaEmailChallenge.create.mockResolvedValue(created);
    emailService.send.mockRejectedValue(new Error('smtp password leaked'));

    await expect(
      service.issue({
        profileId: 'profile-1',
        email: 'person@example.com',
        purpose: 'MFA_ENABLE',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.issue({
        profileId: 'profile-1',
        email: 'person@example.com',
        purpose: 'MFA_ENABLE',
      }),
    ).rejects.toMatchObject({
      response: { error: 'MFA_EMAIL_DELIVERY_UNAVAILABLE' },
    });
    expect(prisma.mfaEmailChallenge.updateMany).toHaveBeenCalled();
  });

  it('increments attempts and returns a stable safe invalid error', async () => {
    tx.mfaEmailChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      profileId: 'profile-1',
      purpose: 'MFA_ENABLE',
      codeHash: 'a'.repeat(64),
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 600000),
      consumedAt: null,
    });

    await expect(
      service.verify({
        profileId: 'profile-1',
        challengeId: 'challenge-1',
        code: '123456',
        purpose: 'MFA_ENABLE',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'MFA_CHALLENGE_INVALID' }),
    });
    expect(tx.mfaEmailChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
    expect(JSON.stringify(await service.verify({
      profileId: 'profile-1',
      challengeId: 'challenge-1',
      code: '123456',
      purpose: 'MFA_ENABLE',
    }).catch((error) => error.response))).not.toContain('123456');
  });

  it('locks a challenge after five failed attempts', async () => {
    tx.mfaEmailChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      profileId: 'profile-1',
      purpose: 'MFA_ENABLE',
      codeHash: 'a'.repeat(64),
      attempts: 5,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 600000),
      consumedAt: null,
    });

    await expect(
      service.verify({
        profileId: 'profile-1',
        challengeId: 'challenge-1',
        code: '123456',
        purpose: 'MFA_ENABLE',
      }),
    ).rejects.toMatchObject({ response: { error: 'MFA_CHALLENGE_LOCKED' } });
    expect(tx.mfaEmailChallenge.updateMany).not.toHaveBeenCalled();
  });

  it('does not consume an expired or already consumed challenge', async () => {
    for (const challenge of [
      { expiresAt: new Date(Date.now() - 1000), consumedAt: null },
      { expiresAt: new Date(Date.now() + 600000), consumedAt: new Date() },
    ]) {
      tx.mfaEmailChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        profileId: 'profile-1',
        purpose: 'MFA_ENABLE',
        codeHash: 'a'.repeat(64),
        attempts: 0,
        maxAttempts: 5,
        ...challenge,
      });
      await expect(
        service.verify({
          profileId: 'profile-1',
          challengeId: 'challenge-1',
          code: '123456',
          purpose: 'MFA_ENABLE',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('consumes a matching challenge with a conditional update', async () => {
    const expiresAt = new Date(Date.now() + 600000);
    const codeHash = require('node:crypto')
      .createHmac('sha256', TEST_PEPPER)
      .update('profile-1:123456')
      .digest('hex');
    tx.mfaEmailChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      profileId: 'profile-1',
      purpose: 'MFA_ENABLE',
      codeHash,
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      consumedAt: null,
    });
    tx.mfaEmailChallenge.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.verify({
        profileId: 'profile-1',
        challengeId: 'challenge-1',
        code: '123456',
        purpose: 'MFA_ENABLE',
      }),
    ).resolves.toEqual({ challengeId: 'challenge-1' });
    expect(tx.mfaEmailChallenge.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'challenge-1', consumedAt: null }),
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects malformed DTOs and unknown fields', async () => {
    await expect(validateDto(MfaVerifyDto, { challengeId: 'not-a-uuid', code: '12345' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'challengeId' }),
        expect.objectContaining({ property: 'code' }),
      ]),
    );
    await expect(validateDto(MfaEnableChallengeDto, { currentPassword: 'x', extra: true })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'extra' })]),
    );
    await expect(validateDto(MfaLoginChallengeDto, { email: 'invalid', purpose: 'MFA_LOGIN' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'email' }),
        expect.objectContaining({ property: 'purpose' }),
      ]),
    );
    await expect(validateDto(MfaDisableDto, { currentPassword: 'x', challengeId: 'bad', code: '12a' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'challengeId' }),
        expect.objectContaining({ property: 'code' }),
      ]),
    );
  });
});
