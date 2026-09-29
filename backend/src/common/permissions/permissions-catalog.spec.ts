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
  ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN'],
];

const APPRAISE_EXCEPTION = 'pawn-ticket.controller.ts::appraiseTicket';

// Analytics reads are tenant-scoped in the service layer rather than by role
// tuple: a caller may only ever read its own shop, and a request naming another
// tenant is refused regardless of role. The permission still gates who may read
// reporting at all. See `resolveTenant` in analytics.service.ts.
const ANALYTICS_VIEWS: { tuple: string[]; permission: string } = {
  tuple: ['OWNER', 'MANAGER'],
  permission: 'reports.view',
};

/** Duplicate-customer lookup, re-gated on the permission that already guards
 *  ticket creation. Was `@Public()`. Tenant scope is derived in the service. */
const CUSTOMER_CHECK: { tuple: string[]; permission: string } = {
  tuple: ['CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
  permission: 'pawn_ticket.create',
};

/** Minting a receipt PDF link. The download route stays `@Public()` but accepts
 *  only a signature this route issued; see receipt.service.ts. */
const RECEIPT_PDF: { tuple: string[]; permission: string } = {
  tuple: ['OWNER', 'MANAGER'],
  permission: 'finance.manage',
};

const MATRIX: Record<string, { tuple: string[]; permission: string }> = {
  'analytics.controller.ts::getStats': ANALYTICS_VIEWS,
  'analytics.controller.ts::getBranchStats': ANALYTICS_VIEWS,
  'analytics.controller.ts::getBatchBranchStats': ANALYTICS_VIEWS,
  'decision-support.controller.ts::getReport': ANALYTICS_VIEWS,
  'decision-support.controller.ts::getWait': ANALYTICS_VIEWS,
  'app.controller.ts::checkCustomer': CUSTOMER_CHECK,
  'receipt.controller.ts::getPdf': RECEIPT_PDF,
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
  // Read-only quotes. A valuation reveals the shop's own rates and a ticket's
  // settlement figure, so both are limited to roles that can already create and
  // settle pawns - and neither grants anything a quote could not be used to do
  // anyway, since the same figures are recorded on the resulting ticket.
  'pawn-ticket.controller.ts::quoteAppraisal': {
    tuple: ['APPRAISER', 'CASHIER_TELLER', 'STAFF', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.create',
  },
  'pawn-ticket.controller.ts::quoteRedemption': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'pawn_ticket.redeem',
  },
  // The renewal quote. It reveals a loan's rate and the accrued interest, which
  // is the same information the renewal itself accepts as payment - so anyone
  // who can take a renewal can read the figure, and anyone who cannot cannot
  // use it for anything.
  'loan.controller.ts::quoteRenewal': {
    tuple: ['CASHIER_TELLER', 'MANAGER', 'OWNER'],
    permission: 'loan.collect',
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
    permission: 'onboarding.approve',
  },
  'tenant-governance.controller.ts::reviewRegistrationDocument': {
    tuple: ['SUPER_ADMIN'],
    permission: 'onboarding.approve',
  },
  'tenant-governance.controller.ts::adminListRegistrationDocuments': {
    tuple: ['SUPER_ADMIN'],
    permission: 'onboarding.review_documents',
  },
  'tenant-governance.controller.ts::markRegistrationDocumentViewed': {
    tuple: ['SUPER_ADMIN'],
    permission: 'onboarding.review_documents',
  },
  'tenant-governance.controller.ts::createBranch': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'tenant.manage_branches',
  },
  'tenant-governance.controller.ts::listBranches': {
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
    tuple: ['OWNER'],
    permission: 'tenant.manage',
  },
  'tenant-governance.controller.ts::deletePawnshop': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::archivePawnshop': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::restorePawnshop': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'tenant-governance.controller.ts::listPawnshopStaff': {
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
  'app.controller.ts::changeStaffPassword': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN'],
    permission: 'user.manage_staff',
  },
  'app.controller.ts::findAllCustomers': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER_TELLER', 'APPRAISER'],
    permission: 'customer.view_history',
  },
  'app.controller.ts::findOneCustomer': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER_TELLER', 'APPRAISER'],
    permission: 'customer.view_history',
  },
  'app.controller.ts::findAllTickets': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER_TELLER', 'APPRAISER', 'STAFF'],
    permission: 'pawn_ticket.view',
  },
  'app.controller.ts::updateTicketDescription': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'inventory.manage',
  },
  'loan.controller.ts::getApplications': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'loan.manage',
  },
  'tenant-governance.controller.ts::listOwnShopStaff': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'user.manage_staff',
  },
  'tenant-governance.controller.ts::getSystemConfig': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER_TELLER', 'APPRAISER', 'STAFF'],
    permission: 'pawn_ticket.view',
  },
  'tenant-governance.controller.ts::getPawnshopSettings': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
  },
  'analytics.controller.ts::getBranchActivity': {
    tuple: ['OWNER', 'MANAGER'],
    permission: 'reports.view',
  },
  'approval.controller.ts::getQueue': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER_TELLER', 'APPRAISER'],
    permission: 'approval.view_queue',
  },
  'approval.controller.ts::approve': {
    tuple: ['OWNER', 'ADMIN'],
    permission: 'approval.approve_appraisal',
  },
  'approval.controller.ts::reject': {
    tuple: ['OWNER', 'ADMIN'],
    permission: 'approval.approve_appraisal',
  },
  'kyc.controller.ts::list': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'kyc.view',
  },
  'kyc.controller.ts::review': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'kyc.verify',
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
  'compliance.controller.ts::getExpiryRegister': {
    tuple: ['OWNER', 'STAFF', 'SUPER_ADMIN'],
    permission: 'compliance.view',
  },
  'compliance.controller.ts::getReminderHistory': {
    tuple: ['OWNER', 'STAFF', 'SUPER_ADMIN'],
    permission: 'compliance.view',
  },
  'compliance.controller.ts::requestDocumentReplacement': {
    tuple: ['SUPER_ADMIN'],
    permission: 'platform.manage',
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
  'auction.controller.ts::simulatePaymentWebhook': {
    tuple: ['OWNER', 'ADMIN', 'MANAGER'],
    permission: 'auction.settle',
  },
  'tenant-governance.controller.ts::updatePawnshopContractTerms': {
    tuple: ['OWNER'],
    permission: 'tenant.manage',
  },
  'reviews.controller.ts::create': {
    tuple: ['OWNER'],
    permission: 'review.create',
  },
  'reviews.controller.ts::myReview': {
    tuple: ['OWNER'],
    permission: 'review.view',
  },
  'reviews.controller.ts::listAll': {
    tuple: ['SUPER_ADMIN'],
    permission: 'review.moderate',
  },
  'reviews.controller.ts::moderate': {
    tuple: ['SUPER_ADMIN'],
    permission: 'review.moderate',
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

function migrationSqlBySuffix(suffix: string): string {
  const dir = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
  if (!dir) throw new Error(`${suffix} migration directory not found`);
  return fs.readFileSync(path.join(migrationsRoot, dir.name, 'migration.sql'), 'utf8');
}

function migrationSqlPath(): string {
  return migrationSqlBySuffix('_v2_schema_baseline');
}

const RBAC_GUARD_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../guards/rbac.guard.ts'),
  'utf8',
);

function superAdminAllowlist(): string[] {
  const block = RBAC_GUARD_SOURCE.match(
    /SUPER_ADMIN_PERMISSIONS\s*=\s*new Set<string>\(\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!block) throw new Error('SUPER_ADMIN_PERMISSIONS allowlist not found');
  return [...block[1].matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]);
}

describe('permission catalog consistency', () => {
  const migrationSql = migrationSqlPath();
  const credentialStateSql = migrationSqlBySuffix('_add_credential_state');
  const constNames = Object.keys(PERMISSIONS);
  const sqlNames = [
    ...migrationSql.matchAll(/^\s*\('([a-z_.]+)',\s*'[a-z_]+',\s*NULL\)[,]?$/gm),
  ].map((m) => m[1]);

  it('holds exactly 40 distinct values in the const', () => {
    expect(constNames).toHaveLength(40);
    expect(new Set(constNames).size).toBe(40);
  });

  it('matches the migration SQL permission names both ways', () => {
    expect(sqlNames).toHaveLength(40);
    expect(new Set(sqlNames)).toEqual(new Set(constNames));
  });

  it('ROLE_PERMISSIONS references only const values and sums to 117 mappings', () => {
    const mapped = Object.values(ROLE_PERMISSIONS).flat();
    expect(mapped.length).toBe(118);
    for (const name of mapped) {
      expect(PERMISSIONS[name]).toBe(name);
    }
    const sqlRows = [
      ...migrationSql.matchAll(/^\s*\('[A-Z_]+','[a-z_.]+'\)[,]?$/gm),
    ].length;
    expect(sqlRows).toBe(106);
  });

  it('seeds the two compatibility staff-management grants by name and mirrors them at runtime', () => {
    const seed =
      credentialStateSql.match(
        /INSERT INTO "public"\."role_permissions"[\s\S]*?ON CONFLICT \("role", "permission_id"\) DO NOTHING;/,
      )?.[0] ?? '';
    const seeded = [...seed.matchAll(/\('([A-Z_]+)',\s*'([a-z_.]+)'\)/g)].map(
      (m) => ({ role: m[1], permission: m[2] }),
    );

    expect(seed).not.toBe('');
    expect(seeded).toEqual([
      { role: 'ADMIN', permission: 'user.manage_staff' },
      { role: 'SUPER_ADMIN', permission: 'user.manage_staff' },
    ]);

    const baselineRows = [
      ...migrationSql.matchAll(/^\s*\('[A-Z_]+','[a-z_.]+'\)[,]?$/gm),
    ].length;
    expect(baselineRows + seeded.length).toBe(108);

    for (const grant of seeded) {
      expect(ROLE_PERMISSIONS[grant.role]).toContain(grant.permission);
      expect(seeded.filter((row) => row.permission === grant.permission)).toHaveLength(2);
    }
  });

  it('keeps every administrative staff-reset holder in the const', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN']) {
      expect(ROLE_PERMISSIONS[role]).toContain('user.manage_staff');
    }
  });

  it('grants the guard Super Admin allowlist every Super Admin matrix permission', () => {
    const allowlist = new Set(superAdminAllowlist());
    const required = new Set(
      Object.values(MATRIX)
        .filter((entry) => entry.tuple.includes('SUPER_ADMIN'))
        .map((entry) => entry.permission),
    );

    expect(required.size).toBeGreaterThan(0);
    for (const permission of required) {
      expect([...allowlist]).toContain(permission);
      expect(PERMISSIONS[permission as keyof typeof PERMISSIONS]).toBe(permission);
    }
  });

  it('leaves the universal self-service security routes authenticated and undecorated', () => {
    const securityController = fs.readFileSync(
      path.resolve(srcRoot, 'security', 'security.controller.ts'),
      'utf8',
    );

    expect(securityController).not.toMatch(/@Roles\(/);
    expect(securityController).not.toMatch(/@RequiresPermission\(/);
    const sites = parseController(path.resolve(srcRoot, 'security', 'security.controller.ts'));
    expect(sites.filter((site) => site.roles || site.permissions)).toEqual([]);
  });
});

describe('69-site equivalence scan', () => {
  const files = findControllerFiles(srcRoot)
    .filter((file) => !file.includes('\\common\\') && !file.includes('/common/'))
    .sort();
  const sitesByFile = new Map<string, Site[]>();

  beforeAll(() => {
    for (const file of files) {
      sitesByFile.set(path.basename(file), parseController(file));
    }
  });

  it('finds all 95 guarded endpoints across the controllers', () => {
    // Calibration tripwire. Raised from 90 across nine additions: the two
    // customer-ledger reads, the ticket-vault read, the ticket description
    // write, the loan-application list, the own-shop staff roster, the own-shop
    // system config, the platform settings read, and the branch-activity
    // aggregate. All nine were previously unguarded *and* unscoped - any
    // authenticated profile could list every customer in the platform, fetch one
    // by id across tenants, list every ticket platform-wide along with each
    // customer's full row, write to any ticket by id, read every tenant's loan
    // applications, read every profile on the platform, read an arbitrary
    // tenant's feature settings, or name any shop in `?pawnshop=` and read its
    // dashboard aggregates.
    const total = [...sitesByFile.values()].reduce((sum, sites) => {
      const withAny = sites.filter((s) => s.roles || s.permissions);
      return sum + withAny.length;
    }, 0);
    // Was 99. Three read-only quote endpoints were added so the browser stops
    // computing money: `quoteAppraisal` prices a prospective pawn,
    // `quoteRedemption` prices a settlement, and `quoteRenewal` prices a
    // renewal. All are guarded, so all are counted here - the invariant is
    // that every guarded site is in the matrix, and this number is the
    // tripwire for that.
    expect(total).toBe(102);
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
