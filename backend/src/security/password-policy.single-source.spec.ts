import * as fs from 'fs';
import * as path from 'path';

const sourceRoot = path.resolve(__dirname, '..');
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
});
