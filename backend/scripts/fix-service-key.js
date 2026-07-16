#!/usr/bin/env node
/**
 * Fix Supabase Service Role Key
 * The current key may be expired - get a new one from Supabase dashboard
 */

const fs = require('fs');
const path = require('path');

console.log(`
╔════════════════════════════════════════════════════╗
║    Supabase Service Role Key - Recovery Guide     ║
╚════════════════════════════════════════════════════╝
`);

const backendEnvPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(backendEnvPath, 'utf-8');

// Check if service role key exists
if (envContent.includes('SUPABASE_SERVICE_ROLE_KEY')) {
  const match = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
  if (match) {
    const key = match[1];
    console.log('📝 Current Service Role Key Found');
    console.log(`   Length: ${key.length} characters`);
    
    // Try to decode JWT to check expiration
    try {
      const parts = key.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const expiryDate = new Date(payload.exp * 1000);
        const now = new Date();
        
        console.log(`   Expires: ${expiryDate.toISOString()}`);
        console.log(`   Status: ${expiryDate > now ? '✅ VALID' : '❌ EXPIRED'}`);
        
        if (expiryDate <= now) {
          console.log('\n⚠️  KEY IS EXPIRED! You need a new one.\n');
        }
      }
    } catch (err) {
      console.log('   Could not decode token');
    }
  }
} else {
  console.log('❌ No SUPABASE_SERVICE_ROLE_KEY found in backend/.env\n');
}

console.log(`
📋 To Get a New Service Role Key:

1. Open: https://app.supabase.com
2. Select your project (bxayczllpdhrvutubzbg)
3. Go to: Settings → API
4. Copy the "Service Role" key (labeled "service_role secret")
5. Replace SUPABASE_SERVICE_ROLE_KEY in backend/.env
6. Restart the backend

⚠️  IMPORTANT:
  - Never share this key publicly
  - Keep it secure (not in version control)
  - Regenerate if accidentally exposed

Then try creating an admin again!
`);
