import * as fs from 'fs';
import * as path from 'path';

import { CREDENTIAL_AUDIT_METADATA_KEYS } from './security.service';

const sourceRoot = path.resolve(__dirname, '..');
const CREDENTIAL_AUDIT_WRITERS = [
  path.join('security', 'security.service.ts'),
  path.join('app.service.ts'),
];
const policyFiles = new Set([
  path.join(sourceRoot, 'security', 'password-policy.constants.ts'),
  path.join(sourceRoot, 'security', 'password-policy.service.ts'),
]);

function runtimeSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(fullPath);
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) return [];
    if (/\.spec\.ts$/.test(entry.name) || entry.name === 'credential-schema.spec.ts') return [];
    return [fullPath];
  });
}

function methodSource(source: string, method: string, nextMethod: string): string {
  const start = source.indexOf(method);
  const end = source.indexOf(nextMethod, start + method.length);
  return source.slice(start, end === -1 ? source.length : end);
}

describe('password policy and credential authority source contract', () => {
  const files = runtimeSourceFiles(sourceRoot);
  const appService = fs.readFileSync(path.join(sourceRoot, 'app.service.ts'), 'utf8');
  const appController = fs.readFileSync(path.join(sourceRoot, 'app.controller.ts'), 'utf8');
  const policyService = fs.readFileSync(
    path.join(sourceRoot, 'security', 'password-policy.service.ts'),
    'utf8',
  );
  const credentialState = fs.readFileSync(
    path.join(sourceRoot, 'security', 'credential-state.service.ts'),
    'utf8',
  );

  it('keeps password character rules in the single policy source', () => {
    const alternatePolicyHits: string[] = [];
    const forbiddenPatterns = [
      /\/\[A-Z\]\//,
      /\/\[a-z\]\//,
      /\/\[0-9\]\//,
      /\/\[A-Za-z0-9\]\//,
    ];

    for (const file of files) {
      if (policyFiles.has(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (forbiddenPatterns.some((pattern) => pattern.test(source))) {
        alternatePolicyHits.push(path.relative(sourceRoot, file));
      }
    }

    expect(alternatePolicyHits).toEqual([]);
    expect(policyService).toContain('evaluate');
    expect(policyService).toContain('assert');
  });

  it('removes alternate local password hash verification and backfill', () => {
    expect(appService).not.toMatch(/bcrypt/i);
    expect(appService).not.toMatch(/passwordHash/);
    expect(appService).not.toMatch(/password_hash/);

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/bcrypt\.compare|passwordHash|password_hash/);
    }

    const loginNative = methodSource(appService, 'async loginNative', '// --- LOCAL AUTH');
    expect(loginNative).toContain('signInWithPassword');
    expect(loginNative).not.toContain('passwordHash');
    expect(loginNative).not.toContain('bcrypt');
    expect(loginNative).not.toContain('profile.update');
  });

  it('routes every named account-creation path through the policy service', () => {
    const methods = [
      methodSource(appService, 'async registerBidder', 'async registerOwner'),
      methodSource(appService, 'async registerOwner', '// Create a new tenant user'),
      methodSource(appService, 'async createBranchAdmin', '// --- TICKET LOGIC ---'),
      methodSource(appService, 'async changeStaffPassword', 'async changeStaffRole'),
    ];

    for (const source of methods) {
      expect(source).toContain('this.passwordPolicy.assert');
    }
  });

  it('uses the account registration DTO at every public account boundary', () => {
    expect(appController).toContain('AccountRegistrationDto');
    expect((appController.match(/@Body\(\) body: AccountRegistrationDto/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the typed credential-state seam for downstream guards', () => {
    expect(credentialState).toContain('CREDENTIAL_STATE_UNAVAILABLE');
    expect(credentialState).toContain('initializeSelfSelected');
    expect(credentialState).toContain('initializeProvisioned');
    expect(credentialState).toContain('getForUser');
  });

  it('rejects every local password-hash verifier in tracked runtime source', () => {
    const forbiddenPasswordHashers = [
      /bcrypt/i,
      /argon2/i,
      /scryptSync|scrypt\(/,
      /pbkdf2/i,
      /timingSafeEqual/,
      /createCipher/i,
    ];
    const passwordBearingFiles = files.filter((file) =>
      /password/i.test(fs.readFileSync(file, 'utf8')),
    );
    const offending: string[] = [];

    for (const file of passwordBearingFiles) {
      const source = fs.readFileSync(file, 'utf8');
      if (forbiddenPasswordHashers.some((pattern) => pattern.test(source))) {
        offending.push(path.relative(sourceRoot, file));
      }
    }

    expect(offending).toEqual([]);
  });

  it('keeps the assertion HMAC owner free of any password handling', () => {
    const mfaAssertion = fs.readFileSync(
      path.join(sourceRoot, 'security', 'mfa-assertion.service.ts'),
      'utf8',
    );

    expect(mfaAssertion).toMatch(/createHmac/);
    expect(mfaAssertion).not.toMatch(/password/i);
  });

  it('keeps Supabase Auth the only accepting password verifier', () => {
    const verificationFiles = files.filter((file) =>
      /signInWithPassword|verifyCurrentPassword/.test(
        fs.readFileSync(file, 'utf8'),
      ),
    );
    const localComparisons: string[] = [];

    expect(verificationFiles.length).toBeGreaterThan(0);
    for (const file of verificationFiles) {
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/signInWithPassword/g, '')
        .replace(/verifyCurrentPassword/g, '');
      if (/password\s*===|===\s*password/.test(source)) {
        localComparisons.push(path.relative(sourceRoot, file));
      }
    }

    expect(localComparisons).toEqual([]);
    expect(appService).toContain('signInWithPassword');
  });

  it('routes every password write through Supabase Auth', () => {
    const passwordWriters = files.filter((file) =>
      /password\s*:\s*[A-Za-z_$][\w$.]*\s*[,}]/.test(
        fs.readFileSync(file, 'utf8'),
      ),
    );
    const unprovenWriters: string[] = [];

    expect(passwordWriters.length).toBeGreaterThan(0);
    for (const file of passwordWriters) {
      const source = fs.readFileSync(file, 'utf8');
      if (!/updateUserById|signUp|admin\.createUser|signInWithPassword/.test(source)) {
        unprovenWriters.push(path.relative(sourceRoot, file));
      }
    }

    expect(unprovenWriters).toEqual([]);
  });

  it('routes every credential audit write through the shared allowlisted envelope', () => {
    const badWriters: string[] = [];

    for (const relative of CREDENTIAL_AUDIT_WRITERS) {
      const source = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');

      if (!/securityLog\.(create|update)/.test(source)) {
        badWriters.push(`${relative}:no-writer`);
        continue;
      }
      if (!/buildCredentialAuditEnvelope/.test(source)) {
        badWriters.push(`${relative}:unshared-envelope`);
      }
      if (!/sanitizeCredentialAuditMetadata/.test(source)) {
        badWriters.push(`${relative}:unshared-metadata`);
      }
      for (const [, literal] of source.matchAll(
        /(?<![A-Za-z_$])metadata:\s*\{([^}]*)\}/g,
      )) {
        for (const [, key] of literal.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
          if (!CREDENTIAL_AUDIT_METADATA_KEYS.includes(key as never)) {
            badWriters.push(`${relative}:inline-metadata:${key}`);
          }
        }
      }
    }

    expect(badWriters).toEqual([]);
  });

  it('never interpolates a credential secret into a credential-path log line', () => {
    const secretIdentifier =
      /^(password|newPassword|currentPassword|confirmPassword|authCode|otpCode|code|assertion|refreshToken|accessToken|serviceRoleToken|codeHash|secret|token)$/i;
    const offendingLines: string[] = [];

    for (const relative of CREDENTIAL_AUDIT_WRITERS) {
      const lines = fs
        .readFileSync(path.join(sourceRoot, relative), 'utf8')
        .split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (
          !/console\.(log|warn|error|info|debug)\(|this\.logger\.(log|warn|error|debug)\(/.test(
            line,
          )
        ) {
          continue;
        }

        const interpolated = [...line.matchAll(/\$\{([^}]*)\}/g)].map(
          (match) => match[1].trim().split('.').pop() ?? '',
        );
        const withoutTemplateText = line
          .replace(/`(?:[^`\\]|\\.)*`/g, (segment) =>
            segment.replace(/\$\{[^}]*\}/g, ' '),
          )
          .replace(/'(?:[^'\\]|\\.)*'/g, "''")
          .replace(/"(?:[^"\\]|\\.)*"/g, '""');
        const shorthand = [
          ...withoutTemplateText.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*[,}]/g),
        ].map((match) => match[1]);

        for (const identifier of [...interpolated, ...shorthand]) {
          if (secretIdentifier.test(identifier)) {
            offendingLines.push(`${relative}:${index + 1}:${identifier}`);
          }
        }
      }
    }

    expect(offendingLines).toEqual([]);
  });
});
