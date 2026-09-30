import * as fs from 'fs';
import * as path from 'path';

const migrationsRoot = path.resolve(__dirname, '../../../prisma/migrations');
const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma');
const BASELINE = '20260731120000_v2_schema_baseline';

/**
 * Migration table names are `@@map` values, not Prisma model names, and the two
 * are easy to confuse. This one shipped a migration against `loan_contract` when
 * the table is `loan_contracts`, and the deploy failed with P3018 / 42P01,
 * `relation "loan_contract" does not exist`.
 *
 * Nothing caught it: the suite was green, the build was clean, and 1068 tests
 * passed. The mistake only exists in SQL, so it is checked here instead - against
 * `schema.prisma`, the one place the real names are written down.
 *
 * Migrations before the baseline are excluded by design. They were applied
 * successfully against older schemas and reference tables that have since been
 * renamed (`ActivityLog`, `Staff`, `Ticket`), so including them would report
 * history as breakage. What matters is that every migration added from here
 * forward names a table that exists.
 */

/** Every table `schema.prisma` declares, as `@@map` or as the model name. */
function prismaTableNames(): Map<string, string> {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const tables = new Map<string, string>();

  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelPattern.exec(schema)) !== null) {
    const modelName = match[1];
    const mapped = match[2].match(/@@map\("([^"]+)"\)/);
    tables.set(modelName, mapped ? mapped[1] : modelName.toLowerCase());
  }

  return tables;
}

/** Tables that exist in the database but are not Prisma models. */
const NON_MODEL_TABLES = new Set([
  '_prisma_migrations',
  'security_logs',
  'auth_audit_log',
  'spatial_ref_sys',
  'geography_columns',
  'geometry_columns',
  'pg_class',
  'pg_constraint',
  'pg_policies',
  'anon',
  'authenticated',
  'service_role',
  'public',
]);

/** SQL grammar words that follow a table keyword but are not table names. */
const SQL_NOISE = new Set([
  'select', 'only', 'lateral', 'values', 'set', 'returning', 'table', 'exists',
  'all', 'distinct', 'where', 'as', 'on', 'using', 'and', 'or', 'cascad',
  'restrict', 'no', 'action', 'deferrable', 'initially', 'to', 'as', 'derived',
]);

function forwardMigrations(): { name: string; sql: string }[] {
  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > BASELINE)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      sql: fs.readFileSync(path.join(migrationsRoot, entry.name, 'migration.sql'), 'utf8'),
    }));
}

/**
 * Remove comments and dollar-quoted bodies, then find table identifiers.
 *
 * Without the comment strip, prose like `FROM the same table` and
 * `ON DELETE CASCADE` read as table references. Without the `[ \t]` separator
 * below, stripping comments to spaces lets a trailing `FROM` capture an
 * identifier several statements later - which reported `grace_period_end`, a
 * column merely mentioned in a comment, as a missing table.
 */
function referencedTables(sql: string): Set<string> {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$[\w$]*\$[\s\S]*?\$[\w$]*\$/g, ' ');

  const S = '[ \\t]+';
  // Only statements that unambiguously take a table name. `FROM` and `JOIN` are
  // deliberately absent: `x IS DISTINCT FROM "expiry_date"` is a comparison, and
  // treating its right-hand side as a table name reported a column as missing.
  // A `SELECT` cannot produce a 42P01 anyway - only DDL and DML on a table can -
  // so nothing actionable is lost.
  const keywords = [
    `ALTER${S}TABLE(?:${S}IF${S}EXISTS)?`,
    `INSERT${S}INTO`,
    `CREATE${S}TABLE(?:${S}IF${S}NOT${S}EXISTS)?`,
    `DROP${S}TABLE(?:${S}IF${S}EXISTS)?`,
    `TRUNCATE(?:${S}TABLE)?`,
    // Not bare `UPDATE`: the `ON UPDATE CASCADE` of a foreign-key clause would
    // otherwise be read as a table called `CASCADE`.
    `(?<!ON${S})UPDATE`,
    `DELETE${S}FROM`,
  ].join('|');

  const pattern = new RegExp(
    `(?:${keywords})${S}(?:public${S}?\\.${S}?)?"?([A-Za-z_][A-Za-z0-9_]*)"?`,
    'g',
  );

  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stripped)) !== null) {
    const name = match[1];
    if (name && !SQL_NOISE.has(name.toLowerCase()) && !NON_MODEL_TABLES.has(name.toLowerCase())) {
      found.add(name);
    }
  }
  return found;
}

describe('migration SQL references real tables', () => {
  const tables = prismaTableNames();
  const tableNames = new Set(tables.values());

  it('reads a usable set of table names from the schema', () => {
    // A parser that silently matched nothing would make every assertion below
    // pass for the wrong reason.
    expect(tables.size).toBeGreaterThan(20);
    expect(tableNames.has('loan_contracts')).toBe(true);
    expect(tableNames.has('permissions')).toBe(true);
    expect(tableNames.has('role_permissions')).toBe(true);
    expect(tableNames.has('contract_templates')).toBe(true);
  });

  it('has forward migrations to check', () => {
    expect(forwardMigrations().length).toBeGreaterThan(0);
  });

  it('names only tables that exist in schema.prisma', () => {
    const unknown: string[] = [];
    for (const migration of forwardMigrations()) {
      for (const table of referencedTables(migration.sql)) {
        if (tableNames.has(table)) continue;
        unknown.push(`${migration.name}: ${table}`);
      }
    }

    // A failure here is a deploy that will die with 42P01.
    expect(unknown).toEqual([]);
  });

  it('never uses a Prisma model name where the table has a different name', () => {
    // The specific mistake. `loan_contract` is the model name lowercased; the
    // table is `loan_contracts`. The negative lookahead keeps the real table
    // from matching.
    const offenders: string[] = [];
    for (const migration of forwardMigrations()) {
      for (const [model, table] of tables) {
        if (model.toLowerCase() === table) continue;
        const asTable = new RegExp(
          `(?:ALTER[ \\t]+TABLE|INSERT[ \\t]+INTO|CREATE[ \\t]+TABLE|UPDATE)` +
            `[ \\t]+"?${model}"?(?!s\\b)`,
          'i',
        );
        if (asTable.test(migration.sql)) {
          offenders.push(`${migration.name}: model "${model}" used for table "${table}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
