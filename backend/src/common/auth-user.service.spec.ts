import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthUserService } from './auth-user.service';

const NATIVE_JWT_SECRET = 'auth-user-spec-native-secret';
const SUPABASE_PROFILE_ID = '7c1f1a52-2f0b-4a1e-9d3c-5b6e8f0a1b2c';
const SUPABASE_SESSION_ID = '9d2c4e77-51ab-4f30-b8c6-2e1d0a4f6b93';

function supabaseStyleToken(claims: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ aud: 'authenticated', role: 'authenticated', ...claims }),
    'not-verified-locally',
  ].join('.');
}

describe('AuthUserService', () => {
  const getUser = jest.fn();
  const supabaseAdmin = { client: { auth: { getUser } } };
  let service: AuthUserService;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = NATIVE_JWT_SECRET;
    service = new AuthUserService(supabaseAdmin as never);
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  describe('getAuthContextFromAuthHeader', () => {
    it('returns the profile and session carried by a verified native token', async () => {
      const token = jwt.sign(
        { sub: 'profile-native', sessionId: 'session-native' },
        NATIVE_JWT_SECRET,
      );

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).resolves.toEqual({
        userId: 'profile-native',
        sessionId: 'session-native',
      });
      expect(getUser).not.toHaveBeenCalled();
    });

    it.each([
      ['session_id', { session_id: 'session-snake' }],
      ['sid', { sid: 'session-sid' }],
      ['sessionId', { sessionId: 'session-camel' }],
    ])('reads the session from the %s claim', async (_label, claim) => {
      const token = jwt.sign({ sub: 'profile-native', ...claim }, NATIVE_JWT_SECRET);

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).resolves.toEqual({
        userId: 'profile-native',
        sessionId: Object.values(claim)[0],
      });
    });

    it('rejects a verified native token that carries no session claim', async () => {
      const token = jwt.sign({ sub: 'profile-native' }, NATIVE_JWT_SECRET);

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(getUser).not.toHaveBeenCalled();
    });

    it('resolves the session of a Supabase-validated token', async () => {
      const token = supabaseStyleToken({
        sub: SUPABASE_PROFILE_ID,
        session_id: SUPABASE_SESSION_ID,
      });
      getUser.mockResolvedValue({ data: { user: { id: SUPABASE_PROFILE_ID } }, error: null });

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).resolves.toEqual({
        userId: SUPABASE_PROFILE_ID,
        sessionId: SUPABASE_SESSION_ID,
      });
      expect(getUser).toHaveBeenCalledWith(token);
    });

    it('takes the profile from the Supabase-validated user, not the token sub claim', async () => {
      const token = supabaseStyleToken({
        sub: 'attacker-chosen-profile',
        session_id: SUPABASE_SESSION_ID,
      });
      getUser.mockResolvedValue({ data: { user: { id: SUPABASE_PROFILE_ID } }, error: null });

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).resolves.toEqual({
        userId: SUPABASE_PROFILE_ID,
        sessionId: SUPABASE_SESSION_ID,
      });
    });

    it('rejects a Supabase-validated token that carries no session claim', async () => {
      const token = supabaseStyleToken({ sub: SUPABASE_PROFILE_ID });
      getUser.mockResolvedValue({ data: { user: { id: SUPABASE_PROFILE_ID } }, error: null });

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token Supabase refuses', async () => {
      const token = supabaseStyleToken({ sub: SUPABASE_PROFILE_ID, session_id: SUPABASE_SESSION_ID });
      getUser.mockResolvedValue({ data: null, error: { message: 'bad jwt' } });

      await expect(
        service.getAuthContextFromAuthHeader(`Bearer ${token}`),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a missing authorization header', async () => {
      await expect(service.getAuthContextFromAuthHeader()).rejects.toThrow(
        'Missing authorization header',
      );
    });

    it('rejects a non-bearer authorization header', async () => {
      await expect(
        service.getAuthContextFromAuthHeader('Basic dXNlcjpwYXNz'),
      ).rejects.toThrow('Invalid authorization format');
    });
  });

  describe('getUserIdFromAuthHeader regression', () => {
    it('still resolves only the profile id for a verified native token', async () => {
      const token = jwt.sign(
        { sub: 'profile-native', sessionId: 'session-native' },
        NATIVE_JWT_SECRET,
      );

      await expect(service.getUserIdFromAuthHeader(`Bearer ${token}`)).resolves.toBe(
        'profile-native',
      );
    });

    it('still resolves the profile id for a Supabase-validated token', async () => {
      const token = supabaseStyleToken({ sub: SUPABASE_PROFILE_ID, session_id: SUPABASE_SESSION_ID });
      getUser.mockResolvedValue({ data: { user: { id: SUPABASE_PROFILE_ID } }, error: null });

      await expect(service.getUserIdFromAuthHeader(`Bearer ${token}`)).resolves.toBe(
        SUPABASE_PROFILE_ID,
      );
    });

    it('still rejects a missing header', async () => {
      await expect(service.getUserIdFromAuthHeader()).rejects.toThrow(
        'Missing authorization header',
      );
    });
  });
});
