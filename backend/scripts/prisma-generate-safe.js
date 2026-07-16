const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const command =
  process.platform === 'win32'
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'npx prisma generate'] }
    : { file: 'npx', args: ['prisma', 'generate'] };

const result = spawnSync(command.file, command.args, {
  stdio: 'pipe',
  encoding: 'utf8',
  env: process.env,
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status === 0) {
  process.exit(0);
}

const combinedOutput = [
  result.error ? String(result.error.message || result.error) : '',
  result.stdout ? String(result.stdout) : '',
  result.stderr ? String(result.stderr) : '',
].join('\n');

const isWindowsEngineLock =
  process.platform === 'win32' &&
  /EPERM|operation not permitted/i.test(combinedOutput) &&
  /query_engine-windows\.dll\.node/i.test(combinedOutput);

const prismaClientIndex = path.join(
  process.cwd(),
  'node_modules',
  '.prisma',
  'client',
  'index.js',
);

// If Prisma Client already exists, continue build and avoid failing on a transient Windows file lock.
if (isWindowsEngineLock && existsSync(prismaClientIndex)) {
  console.warn(
    '[prisma-generate-safe] Skipping Prisma engine refresh due to Windows file lock (EPERM). Using existing generated Prisma Client.',
  );
  process.exit(0);
}

if (result.error) {
  console.error('[prisma-generate-safe] Prisma generate failed:', result.error.message);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
