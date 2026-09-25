import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { FinanceService } from '../src/finance/finance.service';
import { LegalProofService } from '../src/loan/legal-proof.service';
import { ReceiptService } from '../src/receipt/receipt.service';
import { StateMachineService } from '../src/common/state-machine/state-machine.service';
import { PawnTicketService } from '../src/loan/pawn-ticket.service';
import { PrismaService } from '../src/prisma.service';
import { StorageService } from '../src/common/storage/storage.service';
import { SupabaseAdminService } from '../src/common/supabase-admin.service';
import { PasswordPolicyService } from '../src/security/password-policy.service';
import { CredentialStateService } from '../src/security/credential-state.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from '../src/common/interceptors/response-transform.interceptor';

type Row = Record<string, any>;

describe('credential security HTTP tracer (e2e)', () => {
  let app: INestApplication;
  let profiles: Map<string, Row>;
  let credentialStates: Map<string, Row>;
  let authUsers: Map<string, Row>;
  let prisma: Row;
  let supabase: Row;
  let appService: AppService;
  let previousEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    previousEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_INAPP_AUTH_CODE_FALLBACK = 'true';
    process.env.JWT_SECRET = 'credential-security-e2e-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-role';

    profiles = new Map();
    credentialStates = new Map();
    authUsers = new Map();

    prisma = {
      profile: {
        findFirst: jest.fn(async ({ where }: { where: Row }) => {
          const match = [...profiles.values()].find((profile) => {
            if (where.email && profile.email !== where.email) return false;
            if (where.role && profile.role !== where.role) return false;
            return true;
          });
          return match ?? null;
        }),
        findUnique: jest.fn(async ({ where }: { where: Row }) => {
          if (where.id) return profiles.get(where.id) ?? null;
          if (where.email) {
            return [...profiles.values()].find((profile) => profile.email === where.email) ?? null;
          }
          return null;
        }),
        upsert: jest.fn(async ({ where, update, create }: { where: Row; update: Row; create: Row }) => {
          const existing = profiles.get(where.id);
          const next = existing ? { ...existing, ...update } : { ...create };
          profiles.set(next.id, next);
          return next;
        }),
        update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
          const next = { ...(profiles.get(where.id) ?? {}), ...data };
          profiles.set(where.id, next);
          return next;
        }),
        create: jest.fn(async ({ data }: { data: Row }) => {
          profiles.set(data.id, { ...data });
          return data;
        }),
      },
      credentialState: {
        upsert: jest.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
          const existing = credentialStates.get(where.profileId);
          const next = existing ? { ...existing, ...update } : { ...create };
          credentialStates.set(next.profileId, next);
          return next;
        }),
        findUnique: jest.fn(async ({ where }: { where: Row }) => credentialStates.get(where.profileId) ?? null),
      },
    };

    supabase = {
      auth: {
        admin: {
          createUser: jest.fn(async ({ email, password, user_metadata }: Row) => {
            const existing = [...authUsers.values()].find((user) => user.email === email);
            if (existing) return { data: null, error: { message: 'User already registered' } };
            const user = {
              id: `owner-${authUsers.size + 1}`,
              email,
              password,
              user_metadata,
            };
            authUsers.set(user.id, user);
            return { data: { user }, error: null };
          }),
          updateUserById: jest.fn(async (id: string, data: Row) => {
            const user = authUsers.get(id);
            if (!user) return { data: null, error: { message: 'User not found' } };
            Object.assign(user, data);
            return { data: { user }, error: null };
          }),
        },
        signInWithPassword: jest.fn(async ({ email, password }: Row) => {
          const user = [...authUsers.values()].find((candidate) => candidate.email === email);
          if (!user || user.password !== password) {
            return { data: null, error: { message: 'Invalid login credentials' } };
          }
          return {
            data: {
              user,
              session: {
                access_token: `access-${user.id}`,
                refresh_token: `refresh-${user.id}`,
              },
            },
            error: null,
          };
        }),
        getUser: jest.fn(async (token: string) => {
          const id = token.replace(/^access-/, '');
          const user = authUsers.get(id);
          return user ? { data: { user }, error: null } : { data: null, error: { message: 'Invalid token' } };
        }),
      },
    };

    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        PasswordPolicyService,
        CredentialStateService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseAdminService, useValue: { client: supabase } },
        { provide: StorageService, useValue: {} },
        { provide: FinanceService, useValue: { createEntry: jest.fn() } },
        { provide: LegalProofService, useValue: { createProof: jest.fn() } },
        { provide: ReceiptService, useValue: { generateReceipt: jest.fn() } },
        { provide: StateMachineService, useValue: { transition: jest.fn() } },
        { provide: PawnTicketService, useValue: { redeemTicket: jest.fn() } },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.init();

    appService = module.get(AppService);
    jest.spyOn(appService as any, 'sendAuthCodeEmail').mockRejectedValue(new Error('test mail transport disabled'));
  });

  afterAll(async () => {
    await app.close();
    process.env = previousEnv;
  });

  beforeEach(() => {
    profiles.clear();
    credentialStates.clear();
    authUsers.clear();
    jest.clearAllMocks();
    jest.spyOn(appService as any, 'sendAuthCodeEmail').mockRejectedValue(new Error('test mail transport disabled'));
  });

  async function getVerificationToken(email: string, purpose: string): Promise<string> {
    const codeResponse = await request(app.getHttpServer())
      .post('/auth/request-auth-code')
      .send({ email, purpose })
      .expect(201);
    const authCode = codeResponse.body.data.authCode as string;
    expect(authCode).toMatch(/^\d{6}$/);

    const verifyResponse = await request(app.getHttpServer())
      .post('/auth/verify-auth-code')
      .send({ email, purpose, auth_code: authCode })
      .expect(201);
    return verifyResponse.body.data.verificationToken as string;
  }

  it('creates an owner profile and self-selected state, then exposes its status', async () => {
    const email = 'owner.tracer@example.com';
    const password = 'S9!riverstone';
    const verificationToken = await getVerificationToken(email, 'OWNER_REGISTRATION');

    const registration = await request(app.getHttpServer())
      .post('/auth/register-owner')
      .send({
        email,
        password,
        full_name: 'Lia Navarro',
        purpose: 'OWNER_REGISTRATION',
        verification_token: verificationToken,
      })
      .expect(201);

    expect(registration.body.data.user).toMatchObject({ email, role: 'OWNER' });
    expect(registration.body.data.session.access_token).toBeTruthy();
    expect(JSON.stringify(registration.body)).not.toContain(password);
    expect(profiles.get('owner-1')).toMatchObject({ email, role: 'OWNER' });
    expect(credentialStates.get('owner-1')).toMatchObject({
      profileId: 'owner-1',
      mustChangePassword: false,
    });

    const status = await request(app.getHttpServer())
      .get('/auth/credential-status')
      .set('Authorization', `Bearer ${registration.body.data.session.access_token}`)
      .expect(200);
    expect(status.body.data).toMatchObject({ mustChangePassword: false });

    const login = await request(app.getHttpServer())
      .post('/auth/login-native')
      .send({ email, password })
      .expect(201);
    expect(login.body.data.access_token).toBeTruthy();
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('rejects a policy failure with safe machine rule data and no password echo', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register-owner')
      .send({
        email: 'invalid.owner@example.com',
        password: 'Ab1!efgh',
        full_name: 'Lia Navarro',
        purpose: 'OWNER_REGISTRATION',
        verification_token: 'unused-token',
      })
      .expect(400);

    expect(response.body.error).toBe('PASSWORD_POLICY_FAILED');
    expect(response.body.data.failed).toEqual(expect.arrayContaining(['minLength']));
    expect(JSON.stringify(response.body)).not.toContain('Ab1!efgh');
  });
});
