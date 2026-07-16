/// <reference types="node" />
/**
 * Quick Validation - Admin Account Creation
 * Checks that all files are in place and properly configured
 */

const fs = require('fs');
const path = require('path');

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, condition: boolean, failMessage: string = ''): void {
  results.push({
    name,
    passed: condition,
    message: condition ? '✅ Pass' : `❌ ${failMessage}`
  });
}

// Check frontend files
const frontendRoot = path.join(__dirname, '../../frontend');
const modalFile = path.join(frontendRoot, 'src/components/modal/AddAdminModal.tsx');
const toastFile = path.join(frontendRoot, 'src/lib/toast.ts');
const frontendEnv = path.join(frontendRoot, '.env');

check('AddAdminModal.tsx exists', fs.existsSync(modalFile), 'File not found');
if (fs.existsSync(modalFile)) {
  const content = fs.readFileSync(modalFile, 'utf-8');
  check('AddAdminModal uses toast notifications', content.includes('toast.'), 'Toast import missing');
  check('AddAdminModal calls backend API', content.includes('/auth/create-branch-admin'), 'API endpoint call missing');
  check('AddAdminModal has validation', content.includes('validateInputs'), 'Input validation missing');
}

check('toast.ts exists', fs.existsSync(toastFile), 'Toast system not created');
if (fs.existsSync(toastFile)) {
  const content = fs.readFileSync(toastFile, 'utf-8');
  check('Toast has success method', content.includes('success:'), 'Success toast missing');
  check('Toast has error method', content.includes('error:'), 'Error toast missing');
}

check('Frontend .env exists', fs.existsSync(frontendEnv), 'Frontend .env not found');
if (fs.existsSync(frontendEnv)) {
  const content = fs.readFileSync(frontendEnv, 'utf-8');
  check('Frontend .env has VITE_BACKEND_URL', content.includes('VITE_BACKEND_URL'), 'VITE_BACKEND_URL not configured');
}

// Check backend files
const backendRoot = path.join(__dirname, '..');
const serviceFile = path.join(backendRoot, 'src/app.service.ts');
const controllerFile = path.join(backendRoot, 'src/app.controller.ts');
const mainFile = path.join(backendRoot, 'src/main.ts');
const backendEnv = path.join(backendRoot, '.env');

check('app.service.ts exists', fs.existsSync(serviceFile), 'Service file not found');
if (fs.existsSync(serviceFile)) {
  const content = fs.readFileSync(serviceFile, 'utf-8');
  check('Service has createBranchAdmin', content.includes('createBranchAdmin'), 'Method missing');
  check('Service uses Supabase admin client', content.includes('supabaseAdmin'), 'Admin client missing');
  check('Service has error logging', content.includes('console.error'), 'Error logging missing');
}

check('app.controller.ts exists', fs.existsSync(controllerFile), 'Controller file not found');
if (fs.existsSync(controllerFile)) {
  const content = fs.readFileSync(controllerFile, 'utf-8');
  check('Controller has create-branch-admin endpoint', content.includes('create-branch-admin'), 'Endpoint missing');
  check('Controller imports HttpException', content.includes('HttpException'), 'HttpException not imported');
}

check('main.ts exists', fs.existsSync(mainFile), 'Main file not found');
if (fs.existsSync(mainFile)) {
  const content = fs.readFileSync(mainFile, 'utf-8');
  check('main.ts has CORS enabled', content.includes('enableCors'), 'CORS not configured');
  check('main.ts reads PORT from env', content.includes('process.env.PORT'), 'PORT env not used');
}

check('Backend .env exists', fs.existsSync(backendEnv), 'Backend .env not found');
if (fs.existsSync(backendEnv)) {
  const content = fs.readFileSync(backendEnv, 'utf-8');
  check('Backend .env has SERVICE_ROLE_KEY', content.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Service role key missing');
  check('Backend .env has PORT set', content.includes('PORT='), 'PORT not configured');
  check('Backend .env has SUPABASE_URL', content.includes('VITE_SUPABASE_URL'), 'Supabase URL missing');
}

// Print results
console.log(`
╔════════════════════════════════════════════════════╗
║      Admin Account Creation - File Validation      ║
╚════════════════════════════════════════════════════╝
`);

console.log('Frontend:');
results.filter(r => r.name.includes('Frontend') || r.name.includes('AddAdmin') || r.name.includes('toast')).forEach(r => {
  console.log(`  ${r.message}  ${r.name}`);
});

console.log('\nBackend:');
results.filter(r => r.name.includes('Backend') || r.name.includes('app.') || r.name.includes('main')).forEach(r => {
  console.log(`  ${r.message}  ${r.name}`);
});

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`
╔════════════════════════════════════════════════════╗
║  Results: ${passed}/${results.length} checks passed${failed > 0 ? `, ${failed} failed` : ''}
╚════════════════════════════════════════════════════╝
`);

if (failed === 0) {
  console.log('\n✅ All files properly configured!\n');
  process.exit(0);
} else {
  console.log('\n❌ Some issues found. Please review above.\n');
  process.exit(1);
}
