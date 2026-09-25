import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';

const backendRoot = path.resolve(__dirname, '../..');
const prismaRoot = path.join(backendRoot, 'prisma');
const migrationsRoot = path.join(prismaRoot, 'migrations');
const schemaPath = path.join(prismaRoot, 'schema.prisma');
const schemaSource = fs.readFileSync(schemaPath, 'utf8');

function migrationFiles(suffix: string): string[] {
  if (!fs.existsSync(migrationsRoot)) return [];

  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.endsWith(`_${suffix}`),
    )
    .map((entry) => path.join(migrationsRoot, entry.name, 'migration.sql'))
    .filter((file) => fs.existsSync(file));
}

function migrationTimestamp(file: string): number {
  return Number(path.basename(path.dirname(file)).split('_')[0]);
}

function modelSource(model: string): string {
  const match = schemaSource.match(
    new RegExp(`model ${model} \\{[\\s\\S]*?^\\}`, 'm'),
  );
  return match?.[0] ?? '';
}

function runtimeSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(fullPath);
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) return [];
    if (/\.spec\.ts$/.test(entry.name)) return [];
    return [fullPath];
  });
}

const retirementMigrationFiles = migrationFiles('retire_legacy_password_hash');
const retirementMigration = retirementMigrationFiles.length === 1
  ? fs.readFileSync(retirementMigrationFiles[0], 'utf8')
  : '';

describe('legacy password mirror retirement contract', () => {
  it('removes passwordHash from the generated Profile client contract', () => {
    const profileModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'Profile',
    );

    expect(profileModel).toBeDefined();
    expect(profileModel?.fields.map((field) => field.name)).not.toContain(
      'passwordHash',
    );
    expect(modelSource('Profile')).not.toMatch(
      /passwordHash\s+String\?\s+@map\("password_hash"\)/,
    );
  });

  it('orders the cleanup after the runtime and credential-schema migrations', () => {
    expect(retirementMigrationFiles).toHaveLength(1);
    const retirementTimestamp = migrationTimestamp(retirementMigrationFiles[0]);

    for (const suffix of [
      'add_backend_native_auth',
      'add_credential_state',
      'add_mfa_challenges',
    ]) {
      const files = migrationFiles(suffix);
      expect(files).toHaveLength(1);
      expect(retirementTimestamp).toBeGreaterThan(migrationTimestamp(files[0]));
    }
  });

  it('nulls the physical mirror idempotently without destructive DDL', () => {
    expect(retirementMigration).toMatch(
      /UPDATE\s+"public"\."profiles"\s+SET\s+"password_hash"\s*=\s*NULL\s+WHERE\s+"password_hash"\s+IS\s+NOT\s+NULL;/i,
    );
    expect(retirementMigration).not.toMatch(
      /DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i,
    );
  });

  it('keeps tracked runtime source free of alternate password access', () => {
    const sourceRoot = path.join(backendRoot, 'src');
    const hits: string[] = [];

    for (const file of runtimeSourceFiles(sourceRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      if (/passwordHash|password_hash|bcrypt\.compare|bcrypt/i.test(source)) {
        hits.push(path.relative(backendRoot, file));
      }
    }

    expect(hits).toEqual([]);
  });
});
