import * as fs from 'fs';
import * as path from 'path';

import { PERMISSIONS, ROLE_PERMISSIONS } from './permissions.const';

const srcRoot = path.resolve(__dirname, '../../');
const migrationsRoot = path.resolve(__dirname, '../../../prisma/migrations');

interface Site {
  method: string;
  roles?: string[];
  permissions?: string[];
}

const KNOWN_TUPLES: string[][] = [
  ['SUPER_ADMIN'],
  ['OWNER', 'MANAGER'],
  ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
  ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
  ['OWNER', 'STAFF', 'SUPER_ADMIN'],
  ['OWNER', 'ADMIN', 'MANAGER'],
  ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
  ['OWNER', 'STAFF'],
  ['APPRAISER', 'STAFF', 'MANAGER', 'OWNER'],
  ['OWNER'],
  ['OWNER', 'ADMIN'],
];

const APPRAISE_EXCEPTION = 'pawn-ticket.controller.ts::appraiseTicket';

const MATRIX: Record<string, { tuple: string[]; permission: string }> = {
  'pawn-ticket.controller.ts::createTicket': {
    tuple: ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.create',
  },
  'pawn-ticket.controller.ts::submitForApproval': {
    tuple: ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.submit_approval',
  },
  'pawn-ticket.controller.ts::managerApproveTicket': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'pawn_ticket.approve',
  },
  'pawn-ticket.controller.ts::declineTicket': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'pawn_ticket.decline',
  },
  'pawn-ticket.controller.ts::getPendingApproval': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'pawn_ticket.approve',
  },
  'pawn-ticket.controller.ts::approveTicket': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'pawn_ticket.approve',
  },
  'pawn-ticket.controller.ts::appraiseTicket': {
    tuple: ['APPRAISER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.appraise',
  },
  'pawn-ticket.controller.ts::redeemTicket': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.redeem',
  },
  'pawn-ticket.controller.ts::getCustomerTier': {
    tuple: ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.view',
  },
  'pawn-ticket.controller.ts::sendToAuction': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'pawn_ticket.send_to_auction',
  },
  'loan.controller.ts::createApplication': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'loan.collect',
  },
  'loan.controller.ts::updateApplicationStatus': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::deleteApplication': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::checkEligibility': {
    tuple: ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'loan.create',
  },
  'loan.controller.ts::generateSchedule': {
    tuple: ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'loan.create',
  },
  'loan.controller.ts::updateSchedulePayment': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::calculatePenalties': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'loan.collect',
  },
  'loan.controller.ts::waivePenalty': {
    tuple: ['MANAGER', 'OWNER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::applyManualPenalty': {
    tuple: ['MANAGER', 'OWNER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::processForfeitures': {
    tuple: ['MANAGER', 'OWNER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::queueForAuction': {
    tuple: ['MANAGER', 'OWNER'],
    permission: 'pawn_ticket.send_to_auction',
  },
  'loan.controller.ts::disburseLoan': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'loan.collect',
  },
  'loan.controller.ts::renewLoan': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'loan.collect',
  },
  'loan.controller.ts::recordPayment': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'loan.collect',
  },
  'loan.controller.ts::generateContract': {
    tuple: ['MANAGER', 'OWNER'],
    permission: 'loan.manage',
  },
  'loan.controller.ts::signContractByStaff': {
    tuple: ['MANAGER', 'OWNER'],
    permission: 'contract.sign',
  },
  'tenant-governance.controller.ts::getPawnshopMetadata': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::requestSupportAccess': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::approveSupportAccess': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::revokeSupportAccess': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::getSupportAccessAudit': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::getTenantAuditHistory': {
    tuple: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    permission: 'tenant.view_audit',
  },
  'tenant-governance.controller.ts::getSupportAccessStatus': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::listSupportAccessRequests': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::configureOnboarding': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::updateBranding': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::reviewClientRegistration': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::reviewRegistrationDocument': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::createBranch': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'tenant.manage_branches',
  },
  'tenant-governance.controller.ts::updateBranch': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'tenant.manage_branches',
  },
  'tenant-governance.controller.ts::togglePawnshopStatus': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::updatePawnshopSettings': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::deletePawnshop': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::createPawnshopDirect': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::inviteOwner': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::getPlatformAnalytics': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::extendTrial': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::upgradeTier': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::adjustSubscriptionStatus': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::requestTrialExtension': {
    tuple: ['OWNER'],
    permission: 'tenant.manage',
  },
  'app.controller.ts::findAllPawnshops': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'compliance.controller.ts::uploadDocument': {
    tuple: ['OWNER', 'STAFF', 'SUPER_ADMIN'],
    permission: 'compliance.manage_documents',
  },
  'compliance.controller.ts::getDocuments': {
    tuple: ['OWNER', 'STAFF', 'SUPER_ADMIN'],
    permission: 'compliance.view',
  },
  'compliance.controller.ts::verifyDocument': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'compliance.controller.ts::renewDocument': {
    tuple: ['OWNER', 'STAFF'],
    permission: 'compliance.manage_documents',
  },
  'compliance.controller.ts::root': {
    tuple: ['OWNER', 'STAFF', 'SUPER_ADMIN'],
    permission: 'compliance.view',
  },
  'compliance.controller.ts::getComplianceScore': {
    tuple: ['OWNER', 'STAFF', 'SUPER_ADMIN'],
    permission: 'compliance.view',
  },
  'compliance.controller.ts::getPendingReviews': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'compliance.controller.ts::getAllPawnshopCompliance': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'compliance.controller.ts::getSuperAdminOverview': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'auction.controller.ts::listSettlements': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'auction.settle',
  },
  'auction.controller.ts::releaseCompliance': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'auction.settle',
  },
  'auction.controller.ts::manualSettle': {
    tuple: ['OWNER', 'ADMIN'],
    permission: 'auction.manual_settle',
  },
};

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findControllerFiles(full));
    } else if (entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseArgs(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const constMatch = part.match(/^PERMISSIONS\['([^']+)'\]$/);
      if (constMatch) return constMatch[1];
      return part.replace(/^['"]|['"]$/g, '');
    });
}

function findMethodName(lines: string[], start: number): string | undefined {
  for (let i = start; i < Math.min(start + 8, lines.length); i++) {
    const match = lines[i].match(/^\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/);
    if (match) return match[1];
  }
  return undefined;
}

function parseController(file: string): Site[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rolesMatch = lines[i].match(/@Roles\(\s*([^)]*)\)/);
    const permMatch = lines[i].match(/@RequiresPermission\(\s*([^)]*)\)/);
    if (!rolesMatch && !permMatch) continue;
    const method = findMethodName(lines, i + 1);
    if (!method) continue;
    let site = sites.find((s) => s.method === method);
    if (!site) {
      site = { method };
      sites.push(site);
    }
    if (rolesMatch) site.roles = parseArgs(rolesMatch[1]);
    if (permMatch) site.permissions = parseArgs(permMatch[1]);
  }
  return sites;
}

function migrationSqlPath(): string {
  const dir = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith('_v2_schema_baseline'));
  if (!dir) throw new Error('v2_schema_baseline migration directory not found');
  return path.join(migrationsRoot, dir.name, 'migration.sql');
}

describe('permission catalog consistency', () => {
  const migrationSql = fs.readFileSync(migrationSqlPath(), 'utf8');
  const constNames = Object.keys(PERMISSIONS);
  const sqlNames = [
    ...migrationSql.matchAll(/^\s*\('([a-z_.]+)',\s*'[a-z_]+',\s*NULL\)[,]?$/gm),
  ].map((m) => m[1]);

  it('holds exactly 37 distinct values in the const', () => {
    expect(constNames).toHaveLength(37);
    expect(new Set(constNames).size).toBe(37);
  });

  it('matches the migration SQL permission names both ways', () => {
    expect(sqlNames).toHaveLength(37);
    expect(new Set(sqlNames)).toEqual(new Set(constNames));
  });

  it('ROLE_PERMISSIONS references only const values and sums to 101 mappings', () => {
    const mapped = Object.values(ROLE_PERMISSIONS).flat();
    expect(mapped.length).toBe(101);
    for (const name of mapped) {
      expect(PERMISSIONS[name]).toBe(name);
    }
    const sqlRows = [
      ...migrationSql.matchAll(/^\s*\('[A-Z_]+','[a-z_.]+'\)[,]?$/gm),
    ].length;
    expect(sqlRows).toBe(101);
  });
});

describe('63-site equivalence scan', () => {
  const files = findControllerFiles(srcRoot)
    .filter((file) => !file.includes('\\common\\') && !file.includes('/common/'))
    .sort();
  const sitesByFile = new Map<string, Site[]>();

  beforeAll(() => {
    for (const file of files) {
      sitesByFile.set(path.basename(file), parseController(file));
    }
  });

  it('finds all 63 migrated endpoints across the 6 controllers', () => {
    const total = [...sitesByFile.values()].reduce((sum, sites) => {
      const withAny = sites.filter((s) => s.roles || s.permissions);
      return sum + withAny.length;
    }, 0);
    expect(total).toBe(63);
  });

  it('matrix tuples match the current @Roles tuples (RED-phase calibration)', () => {
    for (const [file, sites] of sitesByFile) {
      for (const site of sites) {
        if (!site.roles) continue;
        const key = `${file}::${site.method}`;
        const entry = MATRIX[key];
        expect(entry).toBeDefined();
        expect([...site.roles].sort()).toEqual([...entry.tuple].sort());
      }
    }
  });

  it('every @Roles tuple is one of the known tuples', () => {
    for (const [, sites] of sitesByFile) {
      for (const site of sites) {
        if (!site.roles) continue;
        const normalized = [...site.roles].sort();
        const known = KNOWN_TUPLES.some(
          (tuple) => JSON.stringify([...tuple].sort()) === JSON.stringify(normalized),
        );
        expect(known).toBe(true);
      }
    }
  });

  it('zero endpoints carry @Roles without @RequiresPermission (one-pass completeness)', () => {
    for (const [, sites] of sitesByFile) {
      for (const site of sites) {
        if (site.roles) {
          expect(site.permissions).toBeDefined();
        }
      }
    }
  });

  it('every @RequiresPermission site matches the migration matrix and preserves holder coverage', () => {
    for (const [file, sites] of sitesByFile) {
      for (const site of sites) {
        if (!site.permissions) continue;
        const key = `${file}::${site.method}`;
        const entry = MATRIX[key];
        expect(entry).toBeDefined();
        expect(site.permissions).toEqual([entry.permission]);
        if (key === APPRAISE_EXCEPTION) continue;
        for (const role of entry.tuple) {
          if (role === 'SUPER_ADMIN') continue;
          expect(ROLE_PERMISSIONS[role]).toContain(entry.permission);
        }
      }
    }
  });
});
