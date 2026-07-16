#!/usr/bin/env node
/**
 * Test Admin Creation API
 * Comprehensive test of the entire flow
 */

const http = require('http');

const testEmail = `admin-${Date.now()}@pawngold.com`;
const testPassword = 'TestPassword123!';

const data = JSON.stringify({
  email: testEmail,
  password: testPassword,
  role: 'BRANCH_ADMIN',
  pawnshop_id: 'test-branch-001',
  full_name: 'Test Admin'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/auth/create-branch-admin',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  },
  timeout: 10000
};

console.log(`
╔════════════════════════════════════════════════════╗
║         Admin Account Creation - Live Test         ║
╚════════════════════════════════════════════════════╝

Testing with:
  Email: ${testEmail}
  Password: ${testPassword.substring(0, 4)}***
  Branch: test-branch-001
`);

const req = http.request(options, (res) => {
  let body = '';

  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log(`\n📊 Response Status: ${res.statusCode}`);
    console.log(`📊 Response Headers: ${JSON.stringify(res.headers, null, 2)}`);
    
    try {
      const response = JSON.parse(body);
      console.log(`\n📋 Response Body:`);
      console.log(JSON.stringify(response, null, 2));

      if (res.statusCode === 200 || res.statusCode === 201) {
        if (response.success) {
          console.log(`\n✅ SUCCESS! Admin created:`);
          console.log(`   ID: ${response.user?.id}`);
          console.log(`   Email: ${response.user?.email}`);
          console.log(`   Role: ${response.user?.role}`);
          console.log(`   Verified: ${response.user?.verified}`);
          process.exit(0);
        } else {
          console.log(`\n⚠️  Request succeeded but success=false`);
          console.log(`   Error: ${response.error}`);
          process.exit(1);
        }
      } else {
        console.log(`\n❌ Request failed with status ${res.statusCode}`);
        console.log(`   Error: ${response.error || response.message}`);
        process.exit(1);
      }
    } catch (err) {
      console.log(`\n❌ Failed to parse response`);
      console.log(`   Raw: ${body}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`\n❌ Request failed:`);
  console.error(`   ${err.message}`);
  console.error(`\n   Make sure backend is running: npm run start:dev`);
  process.exit(1);
});

req.on('timeout', () => {
  console.error(`\n❌ Request timed out`);
  console.error(`   Backend not responding`);
  req.destroy();
  process.exit(1);
});

console.log('⏳ Sending request...');
req.write(data);
req.end();
