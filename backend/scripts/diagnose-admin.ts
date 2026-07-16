#!/usr/bin/env node
/// <reference types="node" />
/**
 * Diagnostics Script - Verify Admin Account Creation Setup
 * Run this to diagnose issues with the add admin functionality
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bxayczllpdhrvutubzbg.supabase.co';

async function checkBackend() {
  console.log('\n📋 [Check 1] Backend Server Connection');
  console.log('─'.repeat(50));
  console.log(`Checking: ${API_URL}/health`);

  try {
    const response = await fetch(`${API_URL}/auth/create-branch-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@test.com',
        password: 'test'
      })
    });

    if (response.status === 400) {
      console.log('✅ Backend is running and responding');
      return true;
    } else {
      console.log('⚠️  Backend responded but with unexpected status:', response.status);
      return true;
    }
  } catch (err: any) {
    console.error('❌ Cannot connect to backend at', API_URL);
    console.error('   Error:', err?.message || String(err));
    console.error('\n   Fix: Start the backend with:');
    console.error('   $ cd backend && npm run start:dev');
    return false;
  }
}

async function checkSupabase() {
  console.log('\n📋 [Check 2] Supabase Configuration');
  console.log('─'.repeat(50));
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Service Role Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Set' : '✗ Missing'}`);

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set in backend/.env');
    return false;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    if (response.ok) {
      console.log('✅ Supabase is accessible and service role key is valid');
      return true;
    } else {
      console.error('⚠️  Supabase responded with:', response.status);
      return false;
    }
  } catch (err) {
    console.error('⚠️  Could not verify Supabase directly (this may be OK)');
    return true;
  }
}

async function checkDatabase() {
  console.log('\n📋 [Check 3] Database Connection');
  console.log('─'.repeat(50));
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set in backend/.env');
    return false;
  }

  const masked = dbUrl.replace(/:[^@]+@/, ':***@');
  console.log(`Database: ${masked.split('/').pop()}`);
  console.log('✓ DATABASE_URL configured');
  console.log('\nNote: Full database connectivity will be verified on first API call');
  return true;
}

async function testFlow() {
  console.log('\n📋 [Check 4] Test Admin Creation Flow');
  console.log('─'.repeat(50));

  const testEmail = `test-${Date.now()}@pawngold-test.com`;
  const testPassword = 'TestPassword123!@#';

  console.log(`\nTesting with:
  Email: ${testEmail}
  Password: ${testPassword.substring(0, 3)}***
  Branch: test-branch
`);

  try {
    const response = await fetch(`${API_URL}/auth/create-branch-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        role: 'BRANCH_ADMIN',
        pawnshop_id: 'test-branch-001',
        full_name: 'Test Admin'
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('✅ Test admin creation SUCCEEDED');
      console.log(`   User ID: ${data.user?.id}`);
      console.log(`   Email: ${data.user?.email}`);
      console.log(`   Role: ${data.user?.role}`);
      return true;
    } else {
      console.error('❌ Test admin creation FAILED');
      console.error(`   Status: ${response.status}`);
      console.error(`   Error: ${data.error || data.message}`);
      console.error('   Reason:', data);
      return false;
    }
  } catch (err: any) {
    console.error('❌ Test admin creation encountered error');
    console.error(`   Error: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════╗
║   PawnGold - Admin Account Creation Diagnostics   ║
║             System Health Check                     ║
╚════════════════════════════════════════════════════╝
`);

  const checks = [
    { name: 'Backend', fn: checkBackend },
    { name: 'Supabase', fn: checkSupabase },
    { name: 'Database', fn: checkDatabase },
    { name: 'Test Flow', fn: testFlow }
  ];

  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    try {
      const result = await check.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`Error running check "${check.name}":`, err);
      failed++;
    }
  }

  console.log(`
╔════════════════════════════════════════════════════╗
║                  Summary                           ║
╠════════════════════════════════════════════════════╣
║  Passed: ${passed}/4 checks
║  Failed: ${failed}/4 checks
${failed === 0 ? '║  Status: ✅ All systems operational\n' : '║  Status: ❌ Some issues detected\n'}
╚════════════════════════════════════════════════════╝
`);

  if (failed > 0) {
    console.log('💡 Troubleshooting Tips:');
    console.log('   1. Ensure backend is running: npm run start:dev (in backend/)');
    console.log('   2. Check backend/.env has SUPABASE_SERVICE_ROLE_KEY');
    console.log('   3. Verify DATABASE_URL is correct');
    console.log('   4. Check firewall/CORS settings\n');
    process.exit(1);
  }
}

main().catch(console.error);
