import { SecurityEmailService } from './security-email.service';

describe('SecurityEmailService', () => {
  const originalEnv = { ...process.env };
  let service: SecurityEmailService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.BREVO_API_KEY = '';
    process.env.BREVO_FROM_EMAIL = '';
    process.env.RESEND_API_KEY = '';
    process.env.RESEND_FROM_EMAIL = '';
    process.env.SMTP_HOST = '';
    process.env.SMTP_PORT = '';
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    process.env.SMTP_FROM_EMAIL = '';
    process.env.SMTP_FROM_NAME = '';
    process.env.SMTP_PROVIDER = '';
    process.env.SMTP_IP_FAMILY = '4';
    process.env.SMTP_RESOLVE_IP_CANDIDATES = 'false';
    service = new SecurityEmailService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('uses Brevo first and sends the internal code to the configured recipient', async () => {
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.BREVO_FROM_EMAIL = 'security@example.com';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'security@example.com';
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.send({
      email: 'person@example.com',
      purpose: 'MFA_LOGIN',
      code: '012345',
      expiresInMinutes: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual([{ email: 'person@example.com' }]);
    expect(body.textContent).toContain('012345');
    expect(body.htmlContent).toContain('012345');
  });

  it('falls through to Resend when Brevo is not configured', async () => {
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.RESEND_FROM_EMAIL = 'security@example.com';
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.sendMfaCode({
      email: 'person@example.com',
      purpose: 'MFA_ENABLE',
      code: '654321',
      expiresInMinutes: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(fetchMock.mock.calls[0][1].body).toContain('654321');
  });

  it('does not expose the code in a provider failure', async () => {
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.BREVO_FROM_EMAIL = 'security@example.com';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });

    await expect(
      service.send({
        email: 'person@example.com',
        purpose: 'MFA_DISABLE',
        code: '987654',
        expiresInMinutes: 10,
      }),
    ).rejects.toThrow('Brevo API error (502)');
    expect(fetchMock.mock.calls[0][1].body).toContain('987654');
  });

  it('preserves the SMTP candidate environment and host fallback', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.SMTP_FROM_EMAIL = 'security@example.com';

    const candidates = await service.buildSmtpTransportCandidates();

    expect(candidates.length).toBe(2);
    expect(candidates[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      family: 4,
      auth: { user: 'smtp-user', pass: 'smtp-pass' },
    });
  });
});
