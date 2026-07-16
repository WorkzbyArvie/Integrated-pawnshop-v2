# 🔧 Supabase Auth Failed: Invalid API Key - QUICK FIX

**Error**: "Supabase auth failed: Invalid API key"  
**Cause**: Service role key is missing, expired, or invalid  
**Fix Time**: 2 minutes

---

## ✅ Solution

### Step 1: Check Your Service Role Key
The error says **"Invalid API key"**, which typically means:
- ❌ Key is expired
- ❌ Key is malformed
- ❌ Key wasn't loaded properly

### Step 2: Get New Service Role Key

1. **Open Supabase Dashboard**
   ```
   https://app.supabase.com
   ```

2. **Select Your Project**
   - Project ID: `bxayczllpdhrvutubzbg`
   - Project Name: Look for your pawnshop project

3. **Navigate to Settings → API**
   - Look for the section with different keys
   - Find the **"Service Role"** key (labeled as `service_role secret`)
   - This is different from the anon key

4. **Copy the Service Role Key**
   - It's a long JWT token starting with `eyJh...`

### Step 3: Update Your .env File

Open `backend/.env` and replace:
```dotenv
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4YXljemxscGRocnZ1dHV6YnpiZyIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE2OTMyNjk1OTIsImV4cCI6MTcwODg2NzU5Mn0.6p8RXJY-5KQuF0vBqKqyBP8GqLdvf0Aw4n_eFfG2shc
```

With the new key you copied from Supabase:
```dotenv
SUPABASE_SERVICE_ROLE_KEY=YOUR_NEW_KEY_HERE
```

### Step 4: Restart Backend
```bash
cd backend
npm run start:dev
```

You should see in the logs:
```
✅ [Bootstrap] Service Role Key: ✓ Set
✅ [AppService] Initializing Supabase admin client
```

### Step 5: Try Creating Admin Again
1. Fill the form with email and password
2. Click "Grant Admin Privileges"
3. Should work now! ✅

---

## 🔍 How to Find the Service Role Key

**In Supabase Dashboard:**
1. Go to Project Settings (gear icon)
2. Click "API" in left menu
3. You'll see:
   - **`ANON_PUBLIC`** ← Don't use this
   - **`service_role secret`** ← This is what you need!

The service role key is usually in the "Project API keys" section.

---

## ⚠️ Common Mistakes

❌ **Using ANON key instead of SERVICE_ROLE key**
- The anon key can't create users
- You need the service role key

❌ **Key expired**
- JWT tokens have expiration dates
- Check if your key needs renewal

❌ **Typo in the key**
- Make sure you copied it exactly
- No spaces before/after

❌ **Not restarting backend**
- Must restart for .env changes to take effect

---

## ✅ Verification

After restarting, check the backend logs should show:
```
🚀 [Bootstrap] Backend running on http://localhost:3000
📝 [Bootstrap] Supabase URL: https://bxayczllpdhrvutubzbg.supabase.co
📝 [Bootstrap] Service Role Key: ✓ Set
✅ [AppService] Initializing Supabase admin client
   URL: https://bxayczllpdhrvutubzbg.supabase.co
   Service Role Key: eyJhbGciOi...eFfG2shc
```

If you see that, the key is loaded correctly! ✅

---

## 🆘 Still Not Working?

### Run Diagnostic
```bash
cd backend
node scripts/fix-service-key.js
```

### Check Environment Variables
```bash
# In backend directory, run:
node -e "require('dotenv').config(); console.log('Service Role Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Set' : '✗ Not Set')"
```

### Manual Test
```bash
# From backend directory:
node -e "
const fetch = require('node-fetch');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('Key length:', key.length);
console.log('Key valid:', key && key.startsWith('eyJ'));
"
```

---

## 📞 Need More Help?

1. **Check logs** - Look at backend terminal output
2. **Verify .env** - Make sure file is saved
3. **Restart backend** - Sometimes needed after changes
4. **Regenerate key** - If still failing, get a fresh one from Supabase

---

**Next**: Once fixed, try creating admin again! 🚀
