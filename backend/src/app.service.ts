import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { FinanceService } from './finance/finance.service';
import { LegalProofService } from './loan/legal-proof.service';
import { ReceiptService } from './receipt/receipt.service';
import { StateMachineService } from './common/state-machine/state-machine.service';
import { LedgerEntryType, LedgerCategory, KycIdType } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { createTransport, type Transporter } from 'nodemailer';
import { isIP } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';
import { calculatePawnCharges } from './finance/pawn-charge-calculator';
import {
  assertValidKycDocumentUrl,
  assertValidSelfieCaptureTimestamp,
  assertNameNotSuspicious,
  normalizeAndValidateKycIdNumber,
  normalizeAndValidatePhoneNumber,
  normalizeKycFullName,
  normalizeKycIdNumberForCompare,
  parseAndValidateDateOfBirth,
} from './kyc/kyc-validation';
import { PawnTicketService, assertCustomerKycVerified } from './loan/pawn-ticket.service';

@Injectable()
export class AppService {
  private supabaseAdmin = this.initializeSupabaseClient();
  private readonly pendingAuthCodes = new Map<
    string,
    {
      email: string;
      purpose: string;
      codeHash: string;
      expiresAt: number;
      attempts: number;
    }
  >();

  private readonly verifiedAuthTokens = new Map<
    string,
    {
      email: string;
      purpose: string;
      expiresAt: number;
      consumed: boolean;
    }
  >();

  private initializeSupabaseClient() {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('❌ [AppService] Missing Supabase configuration');
      console.error(
        `   VITE_SUPABASE_URL: ${supabaseUrl ? '✓ Set' : '✗ Missing'}`,
      );
      console.error(
        `   SUPABASE_SERVICE_ROLE_KEY: ${serviceRoleKey ? '✓ Set' : '✗ Missing'}`,
      );

      // Return a client anyway so the app doesn't crash at startup
      return createClient(
        supabaseUrl || 'https://bxayczllpdhrvutubzbg.supabase.co',
        serviceRoleKey || 'INVALID_KEY',
      );
    }

    console.log('✅ [AppService] Initializing Supabase admin client');

    return createClient(supabaseUrl, serviceRoleKey);
  }

  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private legalProofService: LegalProofService,
    private receiptService: ReceiptService,
    private stateMachine: StateMachineService,
    private pawnTicketService: PawnTicketService,
  ) {
    // Validate service role key configuration on startup
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(
        '⚠️  SUPABASE_SERVICE_ROLE_KEY not configured. Branch admin creation will fail.',
      );
    } else {
      console.log('✅ [AppService] Supabase admin client ready');
    }
  }

  // --- Helper: verify JWT and return user ID ---
  async getUserIdFromToken(token: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabaseAdmin.auth.getUser(token);
      if (error || !data?.user?.id) return null;
      return data.user.id;
    } catch {
      return null;
    }
  }

  private hashAuthCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private getAuthCodeEmailSubject(purpose: string): string {
    if (purpose === 'BIDDER_REGISTRATION') {
      return 'PawnGold verification code for registration';
    }
    if (purpose === 'STAFF_ACCOUNT_CREATE') {
      return 'PawnGold verification code for staff account setup';
    }
    return 'PawnGold verification code';
  }

  private getAuthCodeEmailText(params: {
    purpose: string;
    code: string;
    expiresInMinutes: number;
  }): string {
    const actionLabel =
      params.purpose === 'BIDDER_REGISTRATION'
        ? 'complete your registration'
        : params.purpose === 'OWNER_REGISTRATION'
          ? 'create your owner account'
          : 'create the staff/admin account';

    return [
      'PawnGold Authentication Code',
      '',
      `Use this code to ${actionLabel}:`,
      '',
      `Code: ${params.code}`,
      '',
      `This code expires in ${params.expiresInMinutes} minutes.`,
      'If you did not request this code, you can ignore this email.',
    ].join('\n');
  }

  private buildAuthCodeEmailHtml(params: {
    purpose: string;
    code: string;
    expiresInMinutes: number;
  }): string {
    const actionLabel =
      params.purpose === 'BIDDER_REGISTRATION'
        ? 'complete your registration'
        : params.purpose === 'OWNER_REGISTRATION'
          ? 'create your owner account'
          : 'create the staff/admin account';

    return `
      <div style="font-family: Arial, sans-serif; background:#f6f8fc; padding:24px;">
        <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:12px; padding:24px; border:1px solid #e8edf7;">
          <h2 style="margin:0 0 8px; color:#1f2a44;">PawnGold Authentication Code</h2>
          <p style="margin:0 0 20px; color:#4b5b78;">Use this code to ${actionLabel}.</p>
          <div style="font-size:32px; letter-spacing:6px; font-weight:700; color:#1e4fff; margin:16px 0 20px;">${params.code}</div>
          <p style="margin:0; color:#4b5b78;">This code expires in ${params.expiresInMinutes} minutes.</p>
          <p style="margin:16px 0 0; color:#7a869c; font-size:13px;">If you did not request this code, you can ignore this email.</p>
        </div>
      </div>
    `;
  }

  private async sendAuthCodeEmailViaResend(params: {
    email: string;
    purpose: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<boolean> {
    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(
      process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || process.env.MAIL_FROM_EMAIL || '',
    ).trim();
    const resendFromName = String(
      process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || 'PawnGold Security',
    ).trim();

    if (!resendApiKey || !resendFromEmail) {
      return false;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `"${resendFromName}" <${resendFromEmail}>`,
        to: [params.email],
        subject: this.getAuthCodeEmailSubject(params.purpose),
        text: this.getAuthCodeEmailText({
          purpose: params.purpose,
          code: params.code,
          expiresInMinutes: params.expiresInMinutes,
        }),
        html: this.buildAuthCodeEmailHtml({
          purpose: params.purpose,
          code: params.code,
          expiresInMinutes: params.expiresInMinutes,
        }),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown resend error');
      throw new Error(`Resend API error (${response.status}): ${errorBody}`);
    }

    return true;
  }

  private async sendAuthCodeEmailViaBrevo(params: {
    email: string;
    purpose: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<boolean> {
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

    if (!brevoApiKey || !fromEmail) {
      return false;
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: fromName,
          email: fromEmail,
        },
        to: [{ email: params.email }],
        subject: this.getAuthCodeEmailSubject(params.purpose),
        textContent: this.getAuthCodeEmailText({
          purpose: params.purpose,
          code: params.code,
          expiresInMinutes: params.expiresInMinutes,
        }),
        htmlContent: this.buildAuthCodeEmailHtml({
          purpose: params.purpose,
          code: params.code,
          expiresInMinutes: params.expiresInMinutes,
        }),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown brevo error');
      throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
    }

    return true;
  }

  private async buildSmtpTransportCandidates(): Promise<any[]> {
    const provider = String(
      process.env.SMTP_PROVIDER || process.env.MAIL_PROVIDER || '',
    )
      .trim()
      .toLowerCase();
    const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
    const configuredPort = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || '587');
    const user = process.env.SMTP_USER || process.env.MAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.MAIL_PASS;
    const configuredSecure =
      String(process.env.SMTP_SECURE || process.env.MAIL_SECURE || 'false').toLowerCase() ===
      'true';
    const configuredRequireTLS =
      String(process.env.SMTP_REQUIRE_TLS || process.env.MAIL_REQUIRE_TLS || (configuredPort === 587 ? 'true' : 'false'))
        .toLowerCase() === 'true';
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
          (provider === 'gmail' ? 'true' : 'true'),
      )
        .trim()
        .toLowerCase() !== 'false';

    const defaultHost = provider === 'gmail' ? 'smtp.gmail.com' : host;

    if (!defaultHost || !configuredPort || !user || !pass) {
      throw new Error(
        'Email delivery is not configured on backend. Set SMTP_HOST/MAIL_HOST, SMTP_PORT/MAIL_PORT, SMTP_USER/MAIL_USER, SMTP_PASS/MAIL_PASS.',
      );
    }

    // Build host candidates with IP targets first to avoid unreachable IPv6
    // SMTP routes in cloud runtimes when IPv4 is explicitly requested.
    const candidateHosts: string[] = [];

    // Resolve host to preferred IP family first so we avoid IPv6-only routes
    // in environments where outbound IPv6 SMTP is unreachable.
    if (resolveIpCandidates && !isIP(defaultHost)) {
      try {
        const records =
          ipFamily === 6
            ? await resolve6(defaultHost)
            : await resolve4(defaultHost);
        for (const record of records) {
          if (!candidateHosts.includes(record)) {
            candidateHosts.push(record);
          }
        }
      } catch {
        // Continue with hostname candidate if DNS lookup fails.
      }
    }

    // Keep hostname fallback optional, but always add hostname if no IP candidate
    // could be resolved so delivery can still attempt a direct host connection.
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

    // Common fallback profiles when one route is blocked by host/network policy.
    if (!transportProfiles.some((p) => p.port === 465)) {
      transportProfiles.push({
        port: 465,
        secure: true,
        requireTLS: false,
      });
    }

    if (!transportProfiles.some((p) => p.port === 587)) {
      transportProfiles.push({
        port: 587,
        secure: false,
        requireTLS: true,
      });
    }

    // For Gmail, prioritize 465 first because many hosts block outbound 587.
    if (provider === 'gmail') {
      transportProfiles.sort((a, b) => {
        const score = (p: { port: number; secure: boolean }) =>
          p.port === 465 && p.secure ? 0 : p.port === 587 ? 1 : 2;
        return score(a) - score(b);
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
          tls: {
            servername: defaultHost,
          },
          auth: {
            user,
            pass,
          },
          connectionTimeout: connectTimeoutMs,
          greetingTimeout: connectTimeoutMs,
          socketTimeout: connectTimeoutMs + 4000,
        });
      }
    }

    return candidates;
  }

  private async sendAuthCodeEmail(params: {
    email: string;
    purpose: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const sentViaBrevo = await this.sendAuthCodeEmailViaBrevo(params);
    if (sentViaBrevo) {
      return;
    }

    // Prefer HTTPS email API when configured because SMTP ports can be blocked in cloud environments.
    const sentViaResend = await this.sendAuthCodeEmailViaResend(params);
    if (sentViaResend) {
      return;
    }

    const transportCandidates = await this.buildSmtpTransportCandidates();
    const fromEmail =
      process.env.SMTP_FROM_EMAIL ||
      process.env.MAIL_FROM_EMAIL ||
      process.env.SMTP_USER ||
      process.env.MAIL_USER;
    const fromName = process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || 'PawnGold Security';

    if (!fromEmail) {
      throw new Error('SMTP_FROM_EMAIL (or MAIL_FROM_EMAIL) is not configured on backend.');
    }

    let lastError: any = null;

    for (const transportOptions of transportCandidates) {
      const transporter: Transporter = createTransport(transportOptions as any);
      try {
        await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to: params.email,
          subject: this.getAuthCodeEmailSubject(params.purpose),
          text: this.getAuthCodeEmailText({
            purpose: params.purpose,
            code: params.code,
            expiresInMinutes: params.expiresInMinutes,
          }),
          html: this.buildAuthCodeEmailHtml({
            purpose: params.purpose,
            code: params.code,
            expiresInMinutes: params.expiresInMinutes,
          }),
        });

        return;
      } catch (error: any) {
        lastError = error;
      } finally {
        transporter.close();
      }
    }

    throw new Error(lastError?.message || 'Failed to send authentication code email.');
  }

  private normalizePurpose(rawPurpose: unknown): string {
    return String(rawPurpose || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
  }

  private normalizeRole(rawRole: unknown): string {
    const normalized = String(rawRole || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    if (normalized === 'BRANCH_ADMIN') return 'ADMIN';
    if (normalized === 'SUPER') return 'SUPER_ADMIN';
    return normalized;
  }

  private hasAdminAccess(role: unknown): boolean {
    const normalizedRole = this.normalizeRole(role);
    return ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'ADMIN'].includes(
      normalizedRole,
    );
  }

  private readonly allowedStaffTypes = [
    'CASHIER_TELLER',
    'APPRAISER',
    'INVENTORY_CUSTODIAN',
    'AUDITOR',
  ] as const;

  private parseRoleAndStaffType(inputRole: unknown, inputStaffType?: unknown): {
    role: string;
    staffType: string | null;
  } {
    const requestedRole = this.normalizeRole(inputRole);
    const explicitStaffType = inputStaffType
      ? this.normalizeRole(inputStaffType)
      : null;

    const specializationAlias: Record<string, string> = {
      CASHIER: 'CASHIER_TELLER',
      TELLER: 'CASHIER_TELLER',
      CASHIER_TELLER: 'CASHIER_TELLER',
      APPRAISER: 'APPRAISER',
      INVENTORY: 'INVENTORY_CUSTODIAN',
      INVENTORY_CUSTODIAN: 'INVENTORY_CUSTODIAN',
      AUDITOR: 'AUDITOR',
    };

    if (specializationAlias[requestedRole]) {
      return {
        role: 'STAFF',
        staffType: specializationAlias[requestedRole],
      };
    }

    if (requestedRole === 'STAFF') {
      if (!explicitStaffType) {
        throw new Error(
          'Generic STAFF role is no longer allowed. Use CASHIER_TELLER, APPRAISER, INVENTORY_CUSTODIAN, or AUDITOR.',
        );
      }

      if (!this.allowedStaffTypes.includes(explicitStaffType as any)) {
        throw new Error(
          `Invalid staff_type. Allowed values: ${this.allowedStaffTypes.join(', ')}`,
        );
      }

      return {
        role: 'STAFF',
        staffType: explicitStaffType,
      };
    }

    if (explicitStaffType) {
      throw new Error('staff_type is only allowed when role is STAFF');
    }

    return {
      role: requestedRole,
      staffType: null,
    };
  }

  private buildCodeKey(email: string, purpose: string): string {
    return `${purpose}:${email}`;
  }

  private cleanupAuthCodeState(): void {
    const now = Date.now();
    for (const [key, value] of this.pendingAuthCodes.entries()) {
      if (value.expiresAt <= now) this.pendingAuthCodes.delete(key);
    }
    for (const [token, value] of this.verifiedAuthTokens.entries()) {
      if (value.expiresAt <= now || value.consumed) {
        this.verifiedAuthTokens.delete(token);
      }
    }
  }

  async requestAuthCode(data: any) {
    this.cleanupAuthCodeState();

    const email = String(data?.email || '')
      .trim()
      .toLowerCase();
    const purpose = this.normalizePurpose(data?.purpose);

    if (!email || !purpose) {
      throw new Error('Email and purpose are required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    const allowedPurposes = ['BIDDER_REGISTRATION', 'STAFF_ACCOUNT_CREATE', 'OWNER_REGISTRATION'];
    if (!allowedPurposes.includes(purpose)) {
      throw new Error(
        `Invalid auth code purpose. Allowed: ${allowedPurposes.join(', ')}`,
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const key = this.buildCodeKey(email, purpose);
    const expiresInSeconds = 10 * 60;
    const expiresInMinutes = Math.floor(expiresInSeconds / 60);

    this.pendingAuthCodes.set(key, {
      email,
      purpose,
      codeHash: this.hashAuthCode(code),
      expiresAt: Date.now() + expiresInSeconds * 1000,
      attempts: 0,
    });

    console.log(`[auth-code] ${purpose} for ${email}: [REDACTED]`);

    let deliveryMethod: 'EMAIL' | 'IN_APP' = 'EMAIL';
    let deliveryWarning: string | null = null;

    const attemptDelivery = () =>
      this.sendAuthCodeEmail({
        email,
        purpose,
        code,
        expiresInMinutes,
      });

    try {
      await attemptDelivery();
    } catch (error: any) {
      const fallbackDefault =
        purpose === 'BIDDER_REGISTRATION'
          ? 'true'
          : process.env.NODE_ENV === 'production'
            ? 'false'
            : 'true';
      const allowInAppFallback =
        String(
          process.env.ALLOW_INAPP_AUTH_CODE_FALLBACK ||
            process.env.ALLOW_AUTH_CODE_FALLBACK ||
            fallbackDefault,
        )
          .trim()
          .toLowerCase() !== 'false';

      if (!allowInAppFallback) {
        this.pendingAuthCodes.delete(key);
        throw new Error(
          error?.message ||
            'Failed to send authentication code email. Please try again later.',
        );
      }

      deliveryMethod = 'IN_APP';
      deliveryWarning =
        'Email delivery is unavailable. Use the code shown in app to continue signup.';
      console.warn(
        `[auth-code] Email delivery fallback enabled for ${email}: ${
          error?.message || 'unknown mail error'
        }`,
      );
    }

    return {
      success: true,
      message:
        deliveryMethod === 'EMAIL'
          ? 'Authentication code generated and sent successfully'
          : 'Authentication code generated. Check in-app code and continue signup.',
      sentTo: email,
      purpose,
      expiresInSeconds,
      deliveryMethod,
      ...(deliveryWarning ? { warning: deliveryWarning } : {}),
      ...(process.env.NODE_ENV !== 'production' || deliveryMethod === 'IN_APP'
        ? { authCode: code }
        : {}),
    };
  }

  async verifyAuthCode(data: any) {
    this.cleanupAuthCodeState();

    const email = String(data?.email || '')
      .trim()
      .toLowerCase();
    const purpose = this.normalizePurpose(data?.purpose);
    const authCode = String(data?.auth_code || data?.authCode || '').trim();

    if (!email || !purpose || !authCode) {
      throw new Error('Email, purpose, and auth_code are required');
    }

    const key = this.buildCodeKey(email, purpose);
    const pending = this.pendingAuthCodes.get(key);
    if (!pending) {
      throw new Error('No pending authentication code found for this email');
    }

    if (pending.expiresAt <= Date.now()) {
      this.pendingAuthCodes.delete(key);
      throw new Error('Authentication code has expired. Request a new one.');
    }

    if (pending.attempts >= 5) {
      this.pendingAuthCodes.delete(key);
      throw new Error('Too many invalid attempts. Request a new auth code.');
    }

    if (this.hashAuthCode(authCode) !== pending.codeHash) {
      pending.attempts += 1;
      this.pendingAuthCodes.set(key, pending);
      throw new Error('Invalid authentication code');
    }

    this.pendingAuthCodes.delete(key);

    const verificationToken = randomBytes(24).toString('hex');
    this.verifiedAuthTokens.set(verificationToken, {
      email,
      purpose,
      expiresAt: Date.now() + 10 * 60 * 1000,
      consumed: false,
    });

    return {
      success: true,
      message: 'Authentication code verified',
      verificationToken,
      expiresInSeconds: 600,
    };
  }

  private consumeAuthVerification(data: any, expectedPurpose: string) {
    this.cleanupAuthCodeState();

    const email = String(data?.email || '')
      .trim()
      .toLowerCase();
    const purpose = this.normalizePurpose(data?.purpose || expectedPurpose);
    const authCode = String(data?.auth_code || data?.authCode || '').trim();
    const verificationToken = String(
      data?.verification_token || data?.verificationToken || '',
    ).trim();

    if (!email) {
      throw new Error('Email is required for authentication code validation');
    }
    if (purpose !== expectedPurpose) {
      throw new Error('Invalid verification purpose for this request');
    }

    if (verificationToken) {
      const tokenState = this.verifiedAuthTokens.get(verificationToken);
      if (!tokenState) {
        throw new Error('Invalid verification token');
      }
      if (tokenState.expiresAt <= Date.now()) {
        this.verifiedAuthTokens.delete(verificationToken);
        throw new Error('Verification token has expired');
      }
      if (tokenState.consumed) {
        throw new Error('Verification token has already been used');
      }
      if (tokenState.email !== email || tokenState.purpose !== purpose) {
        throw new Error('Verification token does not match this account');
      }

      tokenState.consumed = true;
      this.verifiedAuthTokens.set(verificationToken, tokenState);
      return;
    }

    if (!authCode) {
      throw new Error(
        'Authentication code is required. Request a code and provide auth_code.',
      );
    }

    const key = this.buildCodeKey(email, purpose);
    const pending = this.pendingAuthCodes.get(key);
    if (!pending) {
      throw new Error('No pending authentication code found for this email');
    }
    if (pending.expiresAt <= Date.now()) {
      this.pendingAuthCodes.delete(key);
      throw new Error('Authentication code has expired. Request a new one.');
    }
    if (pending.attempts >= 5) {
      this.pendingAuthCodes.delete(key);
      throw new Error('Too many invalid attempts. Request a new auth code.');
    }

    if (this.hashAuthCode(authCode) !== pending.codeHash) {
      pending.attempts += 1;
      this.pendingAuthCodes.set(key, pending);
      throw new Error('Invalid authentication code');
    }

    this.pendingAuthCodes.delete(key);
  }

  // --- Helper: require admin role ---
  async requireAdmin(userId: string): Promise<void> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!profile || !this.hasAdminAccess(profile.role)) {
      throw new Error('Insufficient permissions — admin access required');
    }
  }

  async requireSuperAdmin(userId: string): Promise<void> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!profile || this.normalizeRole(profile.role) !== 'SUPER_ADMIN') {
      throw new Error('Insufficient permissions — Super Admin access required');
    }
  }

  async changeStaffPassword(
    actorUserId: string,
    staffId: string,
    newPassword: string,
  ) {
    const password = String(newPassword || '');
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (!hasUpper || !hasLower || !hasNumber) {
      throw new Error(
        'Password must include uppercase, lowercase, and number',
      );
    }

    const actor = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, pawnshopId: true },
    });

    const target = await this.prisma.profile.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, pawnshopId: true },
    });

    if (!actor) throw new Error('Requester profile not found');
    if (!target) throw new Error('Staff profile not found');

    const actorRole = this.normalizeRole(actor.role);
    const targetRole = this.normalizeRole(target.role);

    if (!this.hasAdminAccess(actorRole)) {
      throw new Error('Insufficient permissions — admin access required');
    }

    const isSuperAdmin = actorRole === 'SUPER_ADMIN';
    if (!isSuperAdmin && actor.pawnshopId !== target.pawnshopId) {
      throw new Error('Cannot change password for staff from another pawnshop');
    }

    if (!isSuperAdmin && targetRole === 'SUPER_ADMIN') {
      throw new Error('Cannot change password for super admin account');
    }

    const { error } = await this.supabaseAdmin.auth.admin.updateUserById(
      staffId,
      { password },
    );

    if (error) {
      throw new Error(error.message || 'Failed to update staff password');
    }

    return { success: true, message: 'Password changed successfully' };
  }

  async changeStaffRole(
    actorUserId: string,
    staffId: string,
    newRoleRaw: string,
  ) {
    if (!staffId) {
      throw new Error('Staff ID is required');
    }

    if (actorUserId === staffId) {
      throw new Error('You cannot change your own role');
    }

    const { role: requestedRole, staffType: requestedStaffType } =
      this.parseRoleAndStaffType(newRoleRaw);
    if (!['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'HR'].includes(requestedRole)) {
      throw new Error('Invalid role. Allowed roles: OWNER, ADMIN, MANAGER, HR, and staff specializations');
    }

    const actor = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, pawnshopId: true },
    });

    const target = await this.prisma.profile.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, pawnshopId: true, staffType: true },
    });

    if (!actor) throw new Error('Requester profile not found');
    if (!target) throw new Error('Staff profile not found');

    const actorRole = this.normalizeRole(actor.role);
    const targetRole = this.normalizeRole(target.role);
    const isSuperAdmin = actorRole === 'SUPER_ADMIN';

    if (!isSuperAdmin && !this.hasAdminAccess(actorRole)) {
      throw new Error('Insufficient permissions - admin access required');
    }

    if (!isSuperAdmin && actor.pawnshopId !== target.pawnshopId) {
      throw new Error('Cannot change role for staff from another pawnshop');
    }

    if (targetRole === 'SUPER_ADMIN') {
      throw new Error('Cannot change role of super admin account');
    }

    if (!isSuperAdmin) {
      if (actorRole === 'OWNER') {
        if (targetRole === 'OWNER') {
          throw new Error('Owner role cannot be reassigned by owner');
        }
        if (requestedRole === 'OWNER') {
          throw new Error('Only super admin can assign OWNER role');
        }
      } else if (actorRole === 'ADMIN') {
        if (['OWNER', 'ADMIN'].includes(targetRole)) {
          throw new Error('Admin cannot modify owner or admin accounts');
        }
        if (!['MANAGER', 'STAFF', 'HR'].includes(requestedRole)) {
          throw new Error('Admin can only assign MANAGER, HR, or staff specialization roles');
        }
      } else if (actorRole === 'MANAGER') {
        if (['OWNER', 'ADMIN', 'MANAGER'].includes(targetRole)) {
          throw new Error('Manager cannot modify owner/admin/manager accounts');
        }
        if (!['STAFF', 'HR'].includes(requestedRole)) {
          throw new Error('Manager can only assign HR or staff specialization roles');
        }
      } else {
        throw new Error('Insufficient permissions for role assignment');
      }
    }

    const currentStaffType = target.staffType
      ? this.normalizeRole(target.staffType)
      : null;

    if (
      requestedRole === targetRole &&
      ((requestedRole !== 'STAFF' && currentStaffType === null) ||
        (requestedRole === 'STAFF' && requestedStaffType === currentStaffType))
    ) {
      return { success: true, message: 'Role is already set to this value' };
    }

    if (requestedRole === 'OWNER') {
      const ownerCount = await this.prisma.profile.count({
        where: {
          pawnshopId: target.pawnshopId,
          role: 'OWNER',
          NOT: { id: target.id },
        },
      });
      if (ownerCount > 0) {
        throw new Error('Only one OWNER is allowed per pawnshop');
      }
    }

    await this.prisma.profile.update({
      where: { id: target.id },
      data: {
        role: requestedRole,
        staffType: requestedRole === 'STAFF' ? requestedStaffType : null,
      },
    });

    return {
      success: true,
      message:
        requestedRole === 'STAFF'
          ? `Role updated to STAFF (${requestedStaffType})`
          : `Role updated to ${requestedRole}`,
      role: requestedRole,
      staffType: requestedRole === 'STAFF' ? requestedStaffType : null,
    };
  }

  async removeStaffAccount(actorUserId: string, staffId: string) {
    if (!staffId) {
      throw new Error('Staff ID is required');
    }

    if (actorUserId === staffId) {
      throw new Error('You cannot remove your own account');
    }

    const actor = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, pawnshopId: true },
    });

    const target = await this.prisma.profile.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, pawnshopId: true },
    });

    if (!actor) throw new Error('Requester profile not found');
    if (!target) throw new Error('Staff profile not found');

    const actorRole = this.normalizeRole(actor.role);
    const targetRole = this.normalizeRole(target.role);

    if (!this.hasAdminAccess(actorRole)) {
      throw new Error('Insufficient permissions - admin access required');
    }

    const isSuperAdmin = actorRole === 'SUPER_ADMIN';
    if (!isSuperAdmin && actor.pawnshopId !== target.pawnshopId) {
      throw new Error('Cannot remove staff from another pawnshop');
    }

    if (!isSuperAdmin && targetRole === 'SUPER_ADMIN') {
      throw new Error('Cannot remove super admin account');
    }

    const { error } = await this.supabaseAdmin.auth.admin.deleteUser(staffId);
    if (error) {
      throw new Error(error.message || 'Failed to remove staff account');
    }

    await this.prisma.profile.deleteMany({ where: { id: staffId } });

    return { success: true, message: 'Staff account removed successfully' };
  }

  // --- LOCAL AUTH (Development Only) ---
  // This allows login without Supabase when credentials are invalid/expired
  async localLogin(data: any) {
    // Only available in development
    if (process.env.NODE_ENV === 'production') {
      return {
        success: false,
        message: 'Local auth is disabled in production',
      };
    }

    const { email, password } = data;

    if (!email || !password) {
      return {
        success: false,
        message: 'Email and password required',
      };
    }

    // Development-only: authenticate against Supabase instead of hardcoded creds
    try {
      const { data: authData, error } =
        await this.supabaseAdmin.auth.signInWithPassword({ email, password });
      if (error || !authData?.user) {
        return { success: false, message: 'Invalid email or password' };
      }
      const profile = await this.prisma.profile.findUnique({
        where: { id: authData.user.id },
      });
      return {
        success: true,
        profile: {
          role: profile?.role || 'STAFF',
          full_name: profile?.fullName || email.split('@')[0],
          pawnshop_id: profile?.pawnshopId || null,
        },
        message: 'Local auth succeeded (dev mode)',
      };
    } catch {
      return { success: false, message: 'Authentication failed' };
    }
  }

  // Register a public bidder account (used by Auction House + Mobile App)
  async registerBidder(data: any) {
    const email = String(data?.email || '')
      .trim()
      .toLowerCase();
    const password = String(data?.password || '');
    const full_name = String(data?.full_name || '')
      .trim()
      .replace(/\s+/g, ' ');
    const displayName = full_name || email.split('@')[0];

    console.log('📥 [registerBidder] Request received:', { email, full_name });

    if (!email || !password) {
      throw new Error('Email and password are required');
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    if (full_name.length > 100) {
      throw new Error('Full name is too long');
    }

    this.consumeAuthVerification(data, 'BIDDER_REGISTRATION');

    const syncBidderProfile = async (userId: string) => {
      try {
        await this.prisma.profile.upsert({
          where: { id: userId },
          update: {
            email,
            fullName: displayName,
            pawnshopId: null,
          },
          create: {
            id: userId,
            email,
            fullName: displayName,
            role: 'BIDDER',
            pawnshopId: null,
          },
        });
        console.log(`✅ [registerBidder] Profile synced for ${email}`);
      } catch (profileErr: any) {
        console.warn(
          `⚠️ [registerBidder] Profile sync failed but auth user exists: ${profileErr.message}`,
        );
      }
    };

    try {
      // Step 1: Create user in Supabase Auth
      const { data: authUser, error: authError } =
        await this.supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            fullName: displayName,
            role: 'BIDDER',
          },
        });

      if (authError) {
        console.error(
          '❌ [registerBidder] Supabase auth error:',
          authError.message,
        );
        if (authError.message?.includes('already been registered')) {
          // Idempotent recovery: if account already exists and password matches,
          // complete signup by signing in and syncing profile.
          const { data: signInData, error: signInError } =
            await this.supabaseAdmin.auth.signInWithPassword({
              email,
              password,
            });

          if (signInError || !signInData?.user?.id) {
            throw new Error(
              'An account with this email already exists. Please login instead.',
            );
          }

          await syncBidderProfile(signInData.user.id);

          return {
            success: true,
            recovered: true,
            user: {
              id: signInData.user.id,
              email: signInData.user.email,
              full_name: displayName,
              role: 'BIDDER',
            },
          };
        }
        throw new Error(`Registration failed: ${authError.message}`);
      }

      if (!authUser?.user?.id) {
        throw new Error('User creation succeeded but no user ID returned');
      }

      console.log(`✅ [registerBidder] Auth user created: ${authUser.user.id}`);

      // Step 2: Create profile record with BIDDER role
      await syncBidderProfile(authUser.user.id);

      return {
        success: true,
        user: {
          id: authUser.user.id,
          email: authUser.user.email,
          full_name: displayName,
          role: 'BIDDER',
        },
      };
    } catch (err: any) {
      console.error('❌ [registerBidder] Error:', err.message);
      throw err;
    }
  }

  async registerOwner(data: any) {
    const email = String(data?.email || '')
      .trim()
      .toLowerCase();
    const password = String(data?.password || '');
    const full_name = String(data?.full_name || '')
      .trim()
      .replace(/\s+/g, ' ');
    const displayName = full_name || email.split('@')[0];

    console.log('📥 [registerOwner] Request received:', { email, full_name });

    if (!email || !password) {
      throw new Error('Email and password are required');
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    if (full_name.length > 100) {
      throw new Error('Full name is too long');
    }

    this.consumeAuthVerification(data, 'OWNER_REGISTRATION');

    const syncOwnerProfile = async (userId: string) => {
      try {
        await this.prisma.profile.upsert({
          where: { id: userId },
          update: {
            email,
            fullName: displayName,
          },
          create: {
            id: userId,
            email,
            fullName: displayName,
            role: 'OWNER',
          },
        });
        console.log(`✅ [registerOwner] Profile synced for ${email}`);
      } catch (profileErr: any) {
        console.warn(
          `⚠️ [registerOwner] Profile sync failed but auth user exists: ${profileErr.message}`,
        );
      }
    };

    try {
      const { data: authUser, error: authError } =
        await this.supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            fullName: displayName,
            role: 'OWNER',
          },
        });

      if (authError) {
        console.error(
          '❌ [registerOwner] Supabase auth error:',
          authError.message,
        );
        if (authError.message?.includes('already been registered')) {
          const { data: signInData, error: signInError } =
            await this.supabaseAdmin.auth.signInWithPassword({
              email,
              password,
            });

          if (signInError || !signInData?.user?.id) {
            throw new Error(
              'An account with this email already exists. Please login instead.',
            );
          }

          await syncOwnerProfile(signInData.user.id);

          return {
            success: true,
            recovered: true,
            user: {
              id: signInData.user.id,
              email: signInData.user.email,
              full_name: displayName,
              role: 'OWNER',
            },
          };
        }
        throw new Error(`Registration failed: ${authError.message}`);
      }

      if (!authUser?.user?.id) {
        throw new Error('User creation succeeded but no user ID returned');
      }

      console.log(`✅ [registerOwner] Auth user created: ${authUser.user.id}`);

      await syncOwnerProfile(authUser.user.id);

      const { data: signInResult, error: signInErr } =
        await this.supabaseAdmin.auth.signInWithPassword({
          email,
          password,
        });

      if (signInErr || !signInResult?.session) {
        return {
          success: true,
          user: {
            id: authUser.user.id,
            email: authUser.user.email,
            full_name: displayName,
            role: 'OWNER',
          },
        };
      }

      return {
        success: true,
        user: {
          id: authUser.user.id,
          email: authUser.user.email,
          full_name: displayName,
          role: 'OWNER',
        },
        session: {
          access_token: signInResult.session.access_token,
          refresh_token: signInResult.session.refresh_token,
        },
      };
    } catch (err: any) {
      console.error('❌ [registerOwner] Error:', err.message);
      throw err;
    }
  }

  // Create a new tenant user in Supabase Auth + profile
  async createBranchAdmin(actorUserId: string, data: any) {
    const { email, password, role, pawnshop_id, full_name, branch_id, staff_type } = data;

    const { role: canonicalRole, staffType: normalizedStaffType } =
      this.parseRoleAndStaffType(role, staff_type);

    if (!['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'HR'].includes(canonicalRole)) {
      throw new Error('Invalid role. Allowed roles: OWNER, ADMIN, MANAGER, HR, and staff specialization roles');
    }

    const actor = await this.prisma.profile.findUnique({
      where: { id: actorUserId },
      select: { role: true, pawnshopId: true },
    });

    if (!actor) {
      throw new Error('Requester profile not found');
    }

    const actorRole = this.normalizeRole(actor.role);
    const isSuperAdmin = actorRole === 'SUPER_ADMIN';

    if (!isSuperAdmin && actor.pawnshopId !== pawnshop_id) {
      throw new Error('You can only create accounts for your own pawnshop');
    }

    const allowedTargetsByActor: Record<string, string[]> = {
      OWNER: ['ADMIN', 'MANAGER', 'STAFF', 'HR'],
      ADMIN: ['MANAGER', 'STAFF', 'HR'],
      MANAGER: ['STAFF', 'HR'],
    };

    if (!isSuperAdmin) {
      const allowed = allowedTargetsByActor[actorRole] || [];
      if (!allowed.includes(canonicalRole)) {
        throw new Error('Insufficient permissions for requested role assignment');
      }
    }

    console.log('📥 [createBranchAdmin] Request received:', {
      email,
      role: canonicalRole,
      staff_type: normalizedStaffType,
      pawnshop_id,
    });

    // Validation
    if (!email || !password || !role || !pawnshop_id) {
      const missing = [];
      if (!email) missing.push('email');
      if (!password) missing.push('password');
      if (!role) missing.push('role');
      if (!pawnshop_id) missing.push('pawnshop_id');
      const msg = `Missing required fields: ${missing.join(', ')}`;
      console.error('❌ [createBranchAdmin]', msg);
      throw new Error(msg);
    }

    if (password.length < 8) {
      const msg = 'Password must be at least 8 characters';
      console.error('❌ [createBranchAdmin]', msg);
      throw new Error(msg);
    }

    if (!email.includes('@')) {
      const msg = 'Invalid email format';
      console.error('❌ [createBranchAdmin]', msg);
      throw new Error(msg);
    }

    this.consumeAuthVerification(data, 'STAFF_ACCOUNT_CREATE');

    if (branch_id !== undefined && branch_id !== null && branch_id !== '') {
      const parsedBranchId = Number(branch_id);
      if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) {
        throw new Error('branch_id must be a valid positive integer');
      }

      const existingBranch = await this.prisma.branch.findFirst({
        where: {
          id: parsedBranchId,
          pawnshopId: pawnshop_id,
        },
        select: { id: true },
      });

      if (!existingBranch) {
        throw new Error('The selected branch does not belong to this pawnshop');
      }
    }

    try {
      // Verify service role key is configured
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const msg =
          'SUPABASE_SERVICE_ROLE_KEY not configured on backend. Cannot create Supabase auth users.';
        console.error('❌ [createBranchAdmin]', msg);
        throw new Error(msg);
      }

      console.log(
        `🔐 [createBranchAdmin] Service role key verified, proceeding...`,
      );
      console.log(
        `🔐 [createBranchAdmin] Attempting to create Supabase auth user for: ${email}`,
      );

      const { data: authUser, error: authError } =
        await this.supabaseAdmin.auth.admin.createUser({
          email: email.toLowerCase(),
          password,
          email_confirm: true, // ✅ Auto-verify email
          user_metadata: {
            fullName: full_name || email.split('@')[0],
            role: canonicalRole,
            staffType: normalizedStaffType,
            pawnshopId: pawnshop_id,
            pawnshop_id,
            branch_id:
              branch_id !== undefined && branch_id !== null && branch_id !== ''
                ? String(branch_id)
                : null,
          },
        });

      if (authError) {
        console.error('❌ [createBranchAdmin] Supabase API Error:', authError.message, authError.status);

        const msg = `Supabase auth failed: ${authError.message || 'Unknown error'}`;
        throw new Error(msg);
      }

      if (!authUser?.user?.id) {
        console.error(
          '❌ [createBranchAdmin] No user ID returned from Supabase',
        );
        throw new Error(
          'Supabase auth user creation succeeded but no user ID returned',
        );
      }

      console.log(`✅ [createBranchAdmin] Supabase auth user created:`, {
        userId: authUser.user.id,
        email: authUser.user.email,
        emailConfirmed: !!authUser.user.email_confirmed_at,
      });

      // Step 2: Create matching profile in database (using same ID as auth.users)
      try {
        console.log(`📝 [createBranchAdmin] Creating profile record...`);
        const profile = await this.prisma.profile.create({
          data: {
            id: authUser.user.id,
            email: email.toLowerCase(),
            fullName: full_name || email.split('@')[0],
            role: canonicalRole,
            staffType: normalizedStaffType,
            pawnshopId: pawnshop_id,
            branchId:
              branch_id !== undefined && branch_id !== null && branch_id !== ''
                ? String(branch_id)
                : null,
          } as any,
        });

        console.log(`✅ [createBranchAdmin] Profile record created:`, {
          userId: profile.id,
          email: profile.email,
          role: profile.role,
        });

        return {
          success: true,
          user: {
            id: authUser.user.id,
            email: authUser.user.email,
            role: canonicalRole,
            staffType: (profile as any).staffType ?? normalizedStaffType,
            pawnshopId: pawnshop_id,
            fullName: profile.fullName,
            verified: true,
            message: `${email} created successfully and auto-verified`,
          },
        };
      } catch (profileErr: any) {
        console.error('❌ [createBranchAdmin] Profile creation error:', {
          message: profileErr.message,
          code: profileErr.code,
          meta: profileErr.meta,
        });

        // If profile creation fails, the auth user is already created in Supabase
        // This is a sync issue - log it but don't fail the entire operation
        console.warn(
          `⚠️  Supabase user exists but profile sync failed. Auth ID: ${authUser.user.id}`,
        );

        return {
          success: true,
          warning: 'User created in Supabase but profile sync failed',
          user: {
            id: authUser.user.id,
            email: authUser.user.email,
            role: canonicalRole,
            staffType: normalizedStaffType,
            verified: true,
            message: 'Auth user created, profile pending sync',
          },
        };
      }
    } catch (err: any) {
      console.error('❌ [createBranchAdmin] Fatal error:', {
        message: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  // --- TICKET LOGIC ---
  async createMobileTicket(userId: string, data: any) {
    // Get bidder profile for name/contact
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    if (!profile) throw new Error('Profile not found');

    // Find or create a Customer record for this bidder
    let customer = await this.prisma.customer.findFirst({
      where: { id: userId },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          id: userId,
          fullName: profile.fullName || 'Bidder',
          contactNumber: 'N/A',
          address: 'N/A',
        },
      });
    }

    assertCustomerKycVerified(customer);

    // Generate ticket number
    const ticketNumber = `MOB-${Date.now().toString(36).toUpperCase()}`;

    // Create the ticket
    const ticket = await this.prisma.ticket.create({
      data: {
        ticketNumber,
        customerId: customer.id,
        category: data.category || 'Others',
        description: data.description || '',
        loanAmount: data.estimatedValue ?? 0,
        expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        status: 'PENDING',
        pawnshopId: data.pawnshopId ?? null,
      },
    });

    return { success: true, data: ticket };
  }

  async createTicket(data: any) {
    const ticket = await this.prisma.ticket.create({
      data: {
        ticketNumber: data.ticketNumber,
        category: data.category,
        description: data.description,
        loanAmount: data.loanAmount,
        expiryDate: new Date(data.expiryDate),
        status: 'ACTIVE',
        // Connect to the existing Customer
        customer: {
          connect: { id: data.customerId },
        },
        // NEW: Connect to the Branch
        // Ensure your frontend sends 'branchId' (Number or String depending on your schema)
        branch: {
          connect: { id: data.branchId },
        },
      },
    });

    // Record loan disbursement in the finance ledger
    const pawnshopId = data.pawnshopId;
    if (pawnshopId && data.loanAmount > 0) {
      try {
        await this.financeService.createEntry(pawnshopId, {
          entryType: LedgerEntryType.DEBIT,
          category: LedgerCategory.LOAN_DISBURSEMENT,
          amount: data.loanAmount,
          description: `Loan disbursement for ticket #${data.ticketNumber} (${data.category})`,
          performedBy: data.staffId || 'system',
          referenceType: 'TICKET',
          referenceId: String(ticket.id),
          counterparty: data.customerName || undefined,
        });
      } catch (err) {
        console.error('Failed to create finance ledger entry for ticket:', err);
      }
    }

    return ticket;
  }

  async redeemTicket(ticketId: number, pawnshopId: string, userId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, pawnshopId },
      include: { customer: true },
    });

    if (!ticket) throw new Error('Ticket not found');

    const charges = calculatePawnCharges({
      principal: ticket.loanAmount,
      monthlyInterestRatePercent: ticket.interestRate,
      serviceFee: 50,
    });

    return this.pawnTicketService.redeemTicket(
      ticketId,
      { amountPaid: charges.totalDue, paymentMethod: 'CASH' },
      userId,
    );
  }

  async getAllTickets() {
    return await this.prisma.ticket.findMany({
      include: {
        customer: true,
        branch: true, // Included branch details for the UI
      },
      orderBy: { pawnDate: 'desc' },
    });
  }

  async deleteTicket(id: number) {
    return await this.prisma.ticket.delete({
      where: { id: id },
    });
  }

  // --- CUSTOMER / CRM LOGIC ---

  // --- PAWNSHOPS ---
  async getAllPawnshops() {
    return await this.prisma.pawnshop.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isActive: true,
        address: true,
        latitude: true,
        longitude: true,
        contactEmail: true,
        contactPhone: true,
        logoUrl: true,
        status: true,
      },
    });
  }

  async updatePawnshopLocation(
    pawnshopId: string,
    data: { latitude: number; longitude: number; address?: string },
  ) {
    if (data.latitude < -90 || data.latitude > 90) {
      throw new Error('Invalid latitude: must be between -90 and 90');
    }
    if (data.longitude < -180 || data.longitude > 180) {
      throw new Error('Invalid longitude: must be between -180 and 180');
    }

    const updateData: any = {
      latitude: data.latitude,
      longitude: data.longitude,
    };
    if (data.address) {
      updateData.address = data.address;
    }

    return await this.prisma.pawnshop.update({
      where: { id: pawnshopId },
      data: updateData,
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        status: true,
      },
    });
  }

  async getNearbyPawnshops(userLat: number, userLng: number, radiusKm: number) {
    const pawnshops = await this.prisma.pawnshop.findMany({
      where: {
        isActive: true,
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        contactPhone: true,
        status: true,
      },
    });

    return pawnshops
      .map((shop) => ({
        ...shop,
        distanceKm: this.haversineDistance(
          userLat,
          userLng,
          shop.latitude,
          shop.longitude,
        ),
      }))
      .filter((shop) => shop.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }

  async getAllCustomers() {
    return await this.prisma.customer.findMany({
      include: {
        _count: {
          select: { tickets: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async getCustomerById(id: string) {
    return await this.prisma.customer.findUnique({
      where: { id },
      include: { tickets: true },
    });
  }

  async createCustomer(data: any) {
    return await this.prisma.customer.create({
      data: {
        id: require('crypto').randomUUID(),
        fullName: data.fullName,
        contactNumber: data.contactNumber,
        address: data.address,
        loyaltyTier: data.loyaltyTier || 'Standard',
      },
    });
  }

  // --- KYC (Know Your Customer) ---

  async getKycStatus(userId: string) {
    let kyc = await this.prisma.bidderKyc.findUnique({
      where: { profileId: userId },
      select: {
        id: true,
        status: true,
        fullName: true,
        address: true,
        phoneNumber: true,
        idType: true,
        rejectionReason: true,
        createdAt: true,
        reviewedAt: true,
      },
    });

    // Auto-approval mode: legacy pending rows should no longer block access.
    // REMOVED: KYC now requires manual admin review for security.

    return {
      kycStatus: kyc?.status ?? 'NOT_SUBMITTED',
      kyc: kyc ?? null,
    };
  }

  async submitKyc(userId: string, data: any) {
    const fullName = String(data?.fullName || '');
    const dateOfBirth = String(data?.dateOfBirth || '').trim();
    const address = String(data?.address || '').trim();
    const phoneNumber = String(data?.phoneNumber || '').trim();
    const idType = String(data?.idType || '')
      .trim()
      .toUpperCase();
    const idNumber = String(data?.idNumber || '').trim();
    const idFrontUrl = String(data?.idFrontUrl || '').trim();
    const idBackUrlRaw = String(data?.idBackUrl || '').trim();
    const idBackUrl = idBackUrlRaw || null;
    const selfieUrl = String(data?.selfieUrl || '').trim();
    const liveSelfieUrl = String(data?.liveSelfieUrl || '').trim();
    const selfieCaptureMode = String(data?.selfieCaptureMode || '')
      .trim()
      .toUpperCase();
    const selfieCapturedAt = String(data?.selfieCapturedAt || '').trim();

    // Validate required fields
    const missing: string[] = [];
    if (!fullName) missing.push('fullName');
    if (!dateOfBirth) missing.push('dateOfBirth');
    if (!address) missing.push('address');
    if (!phoneNumber) missing.push('phoneNumber');
    if (!idType) missing.push('idType');
    if (!idNumber) missing.push('idNumber');
    if (!idFrontUrl) missing.push('idFrontUrl');
    if (!selfieUrl) missing.push('selfieUrl');
    if (!liveSelfieUrl) missing.push('liveSelfieUrl');
    if (!selfieCaptureMode) missing.push('selfieCaptureMode');
    if (!selfieCapturedAt) missing.push('selfieCapturedAt');

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    if (selfieCaptureMode !== 'LIVE') {
      throw new Error('Selfie must be captured live from camera');
    }

    const allowedIdTypes = new Set([
      'NATIONAL_ID',
      'PASSPORT',
      'DRIVERS_LICENSE',
      'SSS_ID',
      'PHILHEALTH_ID',
      'TIN_ID',
      'VOTERS_ID',
      'POSTAL_ID',
      'OTHER',
    ]);
    if (!allowedIdTypes.has(idType)) {
      throw new Error('Invalid idType value');
    }

    const normalizedFullName = normalizeKycFullName(fullName);
    assertNameNotSuspicious(normalizedFullName);
    const normalizedPhoneNumber = normalizeAndValidatePhoneNumber(phoneNumber);
    const normalizedIdNumber = normalizeAndValidateKycIdNumber(idType, idNumber);

    if (address.length < 10 || address.length > 255) {
      throw new Error('Address must be between 10 and 255 characters');
    }

    const parsedDateOfBirth = parseAndValidateDateOfBirth(dateOfBirth);
    assertValidKycDocumentUrl(idFrontUrl, 'ID front');
    assertValidKycDocumentUrl(selfieUrl, 'Selfie');
    assertValidKycDocumentUrl(liveSelfieUrl, 'Live selfie');
    if (idBackUrl) {
      assertValidKycDocumentUrl(idBackUrl, 'ID back');
    }

    assertValidSelfieCaptureTimestamp(selfieCapturedAt);

    if (liveSelfieUrl !== selfieUrl) {
      throw new Error('Selfie validation failed. Please capture a live selfie again.');
    }

    const normalizedCompareIdNumber = normalizeKycIdNumberForCompare(normalizedIdNumber);
    const existingKycWithSameId = await this.prisma.bidderKyc.findMany({
      where: {
        idType: idType as KycIdType,
        profileId: { not: userId },
        status: { in: ['PENDING', 'VERIFIED'] },
      },
      select: {
        idNumber: true,
      },
    });

    const idAlreadyUsed = existingKycWithSameId.some((record) => {
      const compareExisting = normalizeKycIdNumberForCompare(record.idNumber);
      return compareExisting.length > 0 && compareExisting === normalizedCompareIdNumber;
    });

    if (idAlreadyUsed) {
      throw new Error('This ID number is already associated with another account');
    }

    // Check if already submitted
    const existing = await this.prisma.bidderKyc.findUnique({
      where: { profileId: userId },
    });

    if (existing && existing.status === 'VERIFIED') {
      throw new Error('Your KYC is already verified');
    }

    const ocrNameMatch = data?.ocrNameMatch === true;
    const ocrConfidence = Math.min(100, Math.max(0, Number(data?.ocrConfidence) || 0));
    const faceMatched = data?.faceMatched === true;
    const faceMatchScore = Math.min(1, Math.max(0, Number(data?.faceMatchScore) || 0));
    const tamperClean = data?.tamperClean === true;

    const verificationData = {
      ocr: {
        nameMatch: ocrNameMatch,
        idNumberMatch: data?.ocrIdNumberMatch === true,
        confidence: ocrConfidence,
        extractedName: String(data?.ocrExtractedName || ''),
        extractedIdNumber: String(data?.ocrExtractedIdNumber || ''),
      },
      face: {
        matched: faceMatched,
        score: faceMatchScore,
      },
      tamper: {
        clean: tamperClean,
        flags: Array.isArray(data?.tamperFlags) ? data.tamperFlags : [],
      },
      submittedAt: new Date().toISOString(),
      clientIp: null,
    };

    const kycData = {
      fullName: normalizedFullName,
      dateOfBirth: parsedDateOfBirth,
      address,
      phoneNumber: normalizedPhoneNumber,
      idType: idType as KycIdType,
      idNumber: normalizedIdNumber,
      idFrontUrl,
      idBackUrl,
      selfieUrl,
      verificationData: JSON.parse(JSON.stringify(verificationData)),
      status: 'PENDING' as 'PENDING',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    };

    if (existing) {
      const updated = await this.prisma.bidderKyc.update({
        where: { profileId: userId },
        data: kycData,
      });
      return { success: true, kyc: updated };
    }

    const created = await this.prisma.bidderKyc.create({
      data: {
        ...kycData,
        profile: {
          connect: { id: userId },
        },
      },
    });

    return { success: true, kyc: created };
  }

  async listPendingKyc() {
    return this.prisma.bidderKyc.findMany({
      where: { status: 'PENDING' },
      include: {
        profile: {
          select: { email: true, fullName: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listAllKyc() {
    return this.prisma.bidderKyc.findMany({
      include: {
        profile: {
          select: { email: true, fullName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewKyc(
    kycId: string,
    reviewerId: string,
    decision: 'VERIFIED' | 'REJECTED',
    rejectionReason?: string,
  ) {
    if (decision === 'REJECTED' && !rejectionReason) {
      throw new Error('Rejection reason is required when rejecting KYC');
    }

    const kyc = await this.prisma.bidderKyc.findUnique({
      where: { id: kycId },
    });
    if (!kyc) throw new Error('KYC record not found');
    if (kyc.status !== 'PENDING')
      throw new Error(`Cannot review KYC in status: ${kyc.status}`);

    const updated = await this.prisma.bidderKyc.update({
      where: { id: kycId },
      data: {
        status: decision,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: decision === 'REJECTED' ? rejectionReason : null,
      },
    });

    return { success: true, kyc: updated };
  }
}
