import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SECRET_IDENTIFIER =
  /\b(pass(?:word|code|phrase)|auth_?code|confirm_?password|new_?password|otp|verification_?code|recovery_?token|access_?token|refresh_?token|secret)\b/i;

const RAW_PASSWORD_INPUT = /type\s*=\s*(?:"password"|'password'|\{\s*['"]password['"]\s*\})/;

const LOCAL_POLICY_DUPLICATE = [
  /\/\[A-Z\]\\\//,
  /\/\[a-z\]\\\//,
  /\/\[0-9\]\\\//,
  /\/\[A-Za-z0-9\]\\\//,
  /\.length\s*<\s*8\b/,
];

const SECRET_STORAGE_ASSIGNMENT = /type\s*:\s*string[^;]*password/i;

type Surface = {
  name: string;
  file: string;
  requires: string[];
  literals?: string[];
};

const SURFACES: Surface[] = [
  {
    name: 'owner signup',
    file: 'pages/LandingPage.tsx',
    requires: ['PasswordField', 'PasswordConfirmField', 'PasswordErrorSummary', 'getPasswordRuleFailures'],
    literals: ['new-password', 'current-password'],
  },
  {
    name: 'dashboard login',
    file: 'components/Auth/Login.tsx',
    requires: ['PasswordField'],
    literals: ['current-password', 'showRequirements={false}'],
  },
  {
    name: 'password recovery',
    file: 'components/Auth/ResetPassword.tsx',
    requires: ['PasswordField', 'PasswordConfirmField', 'PasswordErrorSummary', 'getPasswordRuleFailures'],
    literals: ['new-password'],
  },
  {
    name: 'staff creation and staff reset',
    file: 'components/StaffMatrix.tsx',
    requires: ['PasswordField', 'PasswordErrorSummary', 'getPasswordRuleFailures'],
    literals: ['new-password'],
  },
  {
    name: 'branch admin provisioning',
    file: 'components/MultiBranchManagement.tsx',
    requires: ['PasswordField', 'getPasswordRuleFailures'],
    literals: ['new-password'],
  },
  {
    name: 'admin provisioning',
    file: 'components/Dashboard.tsx',
    requires: ['PasswordField', 'getPasswordRuleFailures'],
    literals: ['new-password'],
  },
  {
    name: 'account password change',
    file: 'pages/AccountSecurityPage.tsx',
    requires: ['PasswordField', 'PasswordConfirmField', 'PasswordErrorSummary', 'getPasswordRuleFailures'],
    literals: ['new-password', 'current-password'],
  },
];

function readSurfaceSource(surface: Surface): string {
  const absolute = path.join(sourceRoot, surface.file);
  expect(
    existsSync(absolute),
    `${surface.name} (${surface.file}) is a tracked source file that the usage matrix must read`,
  ).toBe(true);
  const relative = path.relative(sourceRoot, absolute);
  expect(
    !relative.startsWith('..') && !path.isAbsolute(relative),
    `${surface.name} (${surface.file}) must resolve inside frontend/src so the scan cannot read a mirror or generated output`,
  ).toBe(true);
  return readFileSync(absolute, 'utf8');
}

function storageSetItemCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /(?:localStorage|sessionStorage)\.setItem\s*\(/g;
  let match = pattern.exec(source);
  while (match !== null) {
    let depth = 1;
    let index = pattern.lastIndex;
    for (; index < source.length && depth > 0; index += 1) {
      if (source[index] === '(') depth += 1;
      if (source[index] === ')') depth -= 1;
    }
    calls.push(source.slice(pattern.lastIndex, index - 1));
    match = pattern.exec(source);
  }
  return calls;
}

describe('dashboard credential form usage matrix', () => {
  it('reads every claimed active surface from tracked frontend source', () => {
    for (const surface of SURFACES) {
      expect(readSurfaceSource(surface).length).toBeGreaterThan(0);
    }
  });

  it('requires the shared password contract in every claimed active surface', () => {
    const missing: string[] = [];
    for (const surface of SURFACES) {
      const source = readSurfaceSource(surface);
      const absent = [
        ...surface.requires,
        ...(surface.literals ?? []),
      ].filter((token) => !source.includes(token));
      if (absent.length > 0) {
        missing.push(`${surface.name} (${surface.file}) is missing ${absent.join(', ')}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('retains no raw production password input outside the shared field', () => {
    const raw: string[] = [];
    for (const surface of SURFACES) {
      if (RAW_PASSWORD_INPUT.test(readSurfaceSource(surface))) {
        raw.push(surface.name);
      }
    }
    expect(raw).toEqual([]);
  });

  it('retains no local duplicate of the server-owned password policy', () => {
    const duplicates: string[] = [];
    for (const surface of SURFACES) {
      const source = readSurfaceSource(surface);
      if (LOCAL_POLICY_DUPLICATE.some((pattern) => pattern.test(source))) {
        duplicates.push(surface.name);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('writes no secret into local or session storage', () => {
    const leaks: string[] = [];
    for (const surface of SURFACES) {
      for (const call of storageSetItemCalls(readSurfaceSource(surface))) {
        const secretInCall = SECRET_IDENTIFIER.test(call);
        const wholeStateSerialized = /JSON\.stringify\(\s*[A-Za-z_$][\w$]*\s*\)/.test(call);
        if (secretInCall || wholeStateSerialized) {
          leaks.push(`${surface.name} (${surface.file}) persists a credential draft: ${call.trim()}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('never returns a temporary password as an administrative success artifact', () => {
    const artifacts: string[] = [];
    for (const surface of SURFACES) {
      const source = readSurfaceSource(surface);
      if (SECRET_STORAGE_ASSIGNMENT.test(source) || /label:\s*'Password'/.test(source)) {
        artifacts.push(surface.name);
      }
    }
    expect(artifacts).toEqual([]);
  });
});
