import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { isIP } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';

export interface SecurityEmailMessage {
  email: string;
  purpose: string;
  code: string;
  expiresInMinutes: number;
}

@Injectable()
export class SecurityEmailService {
  async send(params: SecurityEmailMessage): Promise<void> {
    const sentViaBrevo = await this.sendViaBrevo(params);
    if (sentViaBrevo) return;

    const sentViaResend = await this.sendViaResend(params);
    if (sentViaResend) return;

    const transportCandidates = await this.buildSmtpTransportCandidates();
    const fromEmail =
      process.env.SMTP_FROM_EMAIL ||
      process.env.MAIL_FROM_EMAIL ||
      process.env.SMTP_USER ||
      process.env.MAIL_USER;
    const fromName =
      process.env.SMTP_FROM_NAME ||
      process.env.MAIL_FROM_NAME ||
      'PawnGold Security';

    if (!fromEmail) {
      throw new Error(
        'SMTP_FROM_EMAIL (or MAIL_FROM_EMAIL) is not configured on backend.',
      );
    }

    let lastError: unknown;
    for (const transportOptions of transportCandidates) {
      const transporter: Transporter = createTransport(transportOptions as any);
      try {
        await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to: params.email,
          subject: this.getSubject(params.purpose),
          text: this.getText(params),
          html: this.getHtml(params),
        });
        return;
      } catch (error) {
        lastError = error;
      } finally {
        transporter.close();
      }
    }

    const detail = lastError instanceof Error ? lastError.message : '';
    throw new Error(
      detail || 'Failed to send authentication code email.',
    );
  }

  async sendMfaCode(params: SecurityEmailMessage): Promise<void> {
    return this.send(params);
  }

  async sendAuthCodeEmail(params: SecurityEmailMessage): Promise<void> {
    return this.send(params);
  }

  async sendEmail(params: SecurityEmailMessage): Promise<void> {
    return this.send(params);
  }

  async sendViaResend(params: SecurityEmailMessage): Promise<boolean> {
    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(
      process.env.RESEND_FROM_EMAIL ||
        process.env.SMTP_FROM_EMAIL ||
        process.env.MAIL_FROM_EMAIL ||
        '',
    ).trim();
    const resendFromName = String(
      process.env.RESEND_FROM_NAME ||
        process.env.SMTP_FROM_NAME ||
        process.env.MAIL_FROM_NAME ||
        'PawnGold Security',
    ).trim();

    if (!resendApiKey || !resendFromEmail) return false;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `"${resendFromName}" <${resendFromEmail}>`,
        to: [params.email],
        subject: this.getSubject(params.purpose),
        text: this.getText(params),
        html: this.getHtml(params),
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend API error (${response.status})`);
    }

    return true;
  }

  async sendViaBrevo(params: SecurityEmailMessage): Promise<boolean> {
    const brevoApiKey = String(process.env.BREVO_API_KEY || '').trim();
    const fromEmail = String(
      process.env.BREVO_FROM_EMAIL ||
        process.env.SMTP_FROM_EMAIL ||
        process.env.MAIL_FROM_EMAIL ||
        '',
    ).trim();
    const fromName = String(
      process.env.BREVO_FROM_NAME ||
        process.env.SMTP_FROM_NAME ||
        process.env.MAIL_FROM_NAME ||
        'PawnGold Security',
    ).trim();

    if (!brevoApiKey || !fromEmail) return false;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: params.email }],
        subject: this.getSubject(params.purpose),
        textContent: this.getText(params),
        htmlContent: this.getHtml(params),
      }),
    });

    if (!response.ok) {
      throw new Error(`Brevo API error (${response.status})`);
    }

    return true;
  }

  async buildSmtpTransportCandidates(): Promise<any[]> {
    const provider = String(
      process.env.SMTP_PROVIDER || process.env.MAIL_PROVIDER || '',
    )
      .trim()
      .toLowerCase();
    const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
    const configuredPort = Number(
      process.env.SMTP_PORT || process.env.MAIL_PORT || '587',
    );
    const user = process.env.SMTP_USER || process.env.MAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.MAIL_PASS;
    const configuredSecure =
      String(process.env.SMTP_SECURE || process.env.MAIL_SECURE || 'false').toLowerCase() ===
      'true';
    const configuredRequireTLS =
      String(
        process.env.SMTP_REQUIRE_TLS ||
          process.env.MAIL_REQUIRE_TLS ||
          (configuredPort === 587 ? 'true' : 'false'),
      ).toLowerCase() === 'true';
    const ipFamilyRaw = String(
      process.env.SMTP_IP_FAMILY || process.env.MAIL_IP_FAMILY || '4',
    ).trim();
    const ipFamily: 4 | 6 = ipFamilyRaw === '6' ? 6 : 4;
    const allowHostnameFallback =
      String(
        process.env.SMTP_ALLOW_HOSTNAME_FALLBACK ||
          process.env.MAIL_ALLOW_HOSTNAME_FALLBACK ||
          (provider === 'gmail' ? 'true' : 'false'),
      )
        .trim()
        .toLowerCase() === 'true';
    const connectTimeoutMs = Number(
      process.env.SMTP_CONNECTION_TIMEOUT_MS ||
        process.env.SMTP_CONNECT_TIMEOUT_MS ||
        process.env.MAIL_CONNECT_TIMEOUT_MS ||
        '20000',
    );
    const resolveIpCandidates =
      String(
        process.env.SMTP_RESOLVE_IP_CANDIDATES ||
          process.env.MAIL_RESOLVE_IP_CANDIDATES ||
          'true',
      )
        .trim()
        .toLowerCase() !== 'false';
    const defaultHost = provider === 'gmail' ? 'smtp.gmail.com' : host;

    if (!defaultHost || !configuredPort || !user || !pass) {
      throw new Error(
        'Email delivery is not configured on backend. Set SMTP_HOST/MAIL_HOST, SMTP_PORT/MAIL_PORT, SMTP_USER/MAIL_USER, SMTP_PASS/MAIL_PASS.',
      );
    }

    const candidateHosts: string[] = [];
    if (resolveIpCandidates && !isIP(defaultHost)) {
      try {
        const records =
          ipFamily === 6 ? await resolve6(defaultHost) : await resolve4(defaultHost);
        for (const record of records) {
          if (!candidateHosts.includes(record)) candidateHosts.push(record);
        }
      } catch {
        candidateHosts.length = 0;
      }
    }

    if (
      (allowHostnameFallback || ipFamily === 6 || candidateHosts.length === 0) &&
      !candidateHosts.includes(defaultHost)
    ) {
      candidateHosts.push(defaultHost);
    }

    if (candidateHosts.length === 0) {
      throw new Error(
        `No SMTP host candidates resolved for ${defaultHost} with IPv${ipFamily}.`,
      );
    }

    const transportProfiles: Array<{
      port: number;
      secure: boolean;
      requireTLS: boolean;
    }> = [
      {
        port: configuredPort,
        secure: configuredSecure,
        requireTLS: configuredRequireTLS,
      },
    ];
    if (!transportProfiles.some((profile) => profile.port === 465)) {
      transportProfiles.push({ port: 465, secure: true, requireTLS: false });
    }
    if (!transportProfiles.some((profile) => profile.port === 587)) {
      transportProfiles.push({ port: 587, secure: false, requireTLS: true });
    }
    if (provider === 'gmail') {
      transportProfiles.sort((left, right) => {
        const score = (profile: { port: number; secure: boolean }) =>
          profile.port === 465 && profile.secure ? 0 : profile.port === 587 ? 1 : 2;
        return score(left) - score(right);
      });
    }

    const candidates: any[] = [];
    for (const candidateHost of candidateHosts) {
      for (const profile of transportProfiles) {
        candidates.push({
          host: candidateHost,
          port: profile.port,
          secure: profile.secure,
          requireTLS: profile.requireTLS,
          family: ipFamily,
          tls: { servername: defaultHost },
          auth: { user, pass },
          connectionTimeout: connectTimeoutMs,
          greetingTimeout: connectTimeoutMs,
          socketTimeout: connectTimeoutMs + 4000,
        });
      }
    }
    return candidates;
  }

  private getSubject(purpose: string): string {
    if (purpose === 'BIDDER_REGISTRATION') {
      return 'PawnGold verification code for registration';
    }
    if (purpose === 'STAFF_ACCOUNT_CREATE') {
      return 'PawnGold verification code for staff account setup';
    }
    if (purpose === 'MFA_LOGIN' || purpose === 'LOGIN') {
      return 'PawnGold sign-in verification code';
    }
    if (purpose === 'MFA_ENABLE' || purpose === 'ENABLE') {
      return 'PawnGold email MFA setup code';
    }
    if (purpose === 'MFA_DISABLE' || purpose === 'DISABLE') {
      return 'PawnGold email MFA disablement code';
    }
    return 'PawnGold verification code';
  }

  private getActionLabel(purpose: string): string {
    if (purpose === 'BIDDER_REGISTRATION') return 'complete your registration';
    if (purpose === 'OWNER_REGISTRATION') return 'create your owner account';
    if (purpose === 'MFA_LOGIN' || purpose === 'LOGIN') return 'verify your sign-in';
    if (purpose === 'MFA_ENABLE' || purpose === 'ENABLE') return 'turn on email MFA';
    if (purpose === 'MFA_DISABLE' || purpose === 'DISABLE') return 'turn off email MFA';
    return 'create the staff/admin account';
  }

  private getText(params: SecurityEmailMessage): string {
    return [
      'PawnGold Authentication Code',
      '',
      `Use this code to ${this.getActionLabel(params.purpose)}:`,
      '',
      `Code: ${params.code}`,
      '',
      `This code expires in ${params.expiresInMinutes} minutes.`,
      'If you did not request this code, you can ignore this email.',
    ].join('\n');
  }

  private getHtml(params: SecurityEmailMessage): string {
    return `
      <div style="font-family: Arial, sans-serif; background:#f6f8fc; padding:24px;">
        <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:12px; padding:24px; border:1px solid #e8edf7;">
          <h2 style="margin:0 0 8px; color:#1f2a44;">PawnGold Authentication Code</h2>
          <p style="margin:0 0 20px; color:#4b5b78;">Use this code to ${this.getActionLabel(params.purpose)}.</p>
          <div style="font-size:32px; letter-spacing:6px; font-weight:700; color:#1e4fff; margin:16px 0 20px;">${params.code}</div>
          <p style="margin:0; color:#4b5b78;">This code expires in ${params.expiresInMinutes} minutes.</p>
          <p style="margin:16px 0 0; color:#7a869c; font-size:13px;">If you did not request this code, you can ignore this email.</p>
        </div>
      </div>
    `;
  }
}
