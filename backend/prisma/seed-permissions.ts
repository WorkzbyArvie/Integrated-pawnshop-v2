import { PrismaClient } from '@prisma/client';

import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/common/permissions/permissions.const';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.permission.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((p) => p.name));
  const created = Object.keys(PERMISSIONS).filter((name) => !existingNames.has(name)).length;
  for (const name of Object.keys(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, group: name.split('.')[0] },
    });
  }
  const permissions = await prisma.permission.findMany({ select: { id: true, name: true } });
  const idByName = new Map(permissions.map((p) => [p.name, p.id]));
  const rows = Object.entries(ROLE_PERMISSIONS).flatMap(([role, names]) =>
    names
      .map((name) => idByName.get(name))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ role, permissionId })),
  );
  const result = await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
  console.log(`permissions upserted: ${Object.keys(PERMISSIONS).length} (${created} new)`);
  console.log(`role_permissions mapped: ${rows.length} (${result.count} new)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
