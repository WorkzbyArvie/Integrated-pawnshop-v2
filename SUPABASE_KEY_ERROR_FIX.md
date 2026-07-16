# ❌ Error: "Supabase auth failed: Invalid API key" - SOLUTION

**Status**: 🔴 Service Role Key Issue  
**Severity**: High (blocks admin creation)  
**Time to Fix**: 2 minutes

---

## 🎯 What Happened

You clicked "Add Admin" and got:
```
❌ Supabase auth failed: Invalid API key
```

This means the backend tried to create a user in Supabase Auth but **the service role key is invalid**.

---

## ✅ The Fix (2 Steps)

### Step 1: Get Fresh Service Role Key from Supabase

**👉 READ**: [GET_SERVICE_ROLE_KEY.md](GET_SERVICE_ROLE_KEY.md)

This guide has:
- Exact steps to get the key
- Screenshots of where to find it
- Visual guide showing which key to copy

**TL;DR**:
1. Go to: https://app.supabase.com/projects
2. Select your project (bxayczllpdhrvutubzbg)
3. Settings → API
4. Look for **"service_role secret"**
5. Copy the key

### Step 2: Update backend/.env and Restart

1. Open: `backend/.env`
2. Replace the `SUPABASE_SERVICE_ROLE_KEY` value with the new key
3. Save file
4. Restart backend: `npm run start:dev`

**Done!** Now try creating admin again. 

---

## 🔍 Why This Happened

The service role key in your `.env` is either:

1. **Expired** - JWT tokens have expiration dates
2. **Malformed** - Accidentally edited or corrupted
3. **Wrong key** - Copied the anon key instead of service role key
4. **Not loaded** - Environment variables not being read properly

**I've fixed #4** by improving how the backend loads the .env file. But you still need to update the key (likely #1 - expired).

---

## 📋 What Was Updated

I improved the error handling and logging so you get better messages:

### Backend Changes
- ✅ `src/main.ts` - Now explicitly loads .env file at startup
- ✅ `src/app.service.ts` - Better Supabase client initialization
- ✅ Better error messages for "Invalid API key" issues
- ✅ Detailed logging showing what went wrong

### New Guides
- ✅ `GET_SERVICE_ROLE_KEY.md` - Step-by-step key retrieval guide
- ✅ `SUPABASE_KEY_FIX.md` - Troubleshooting guide
- ✅ `scripts/fix-service-key.js` - Diagnostic script

---

## 🚀 Next Steps

1. **Get new key** → Read [GET_SERVICE_ROLE_KEY.md](GET_SERVICE_ROLE_KEY.md)
2. **Update .env** → Replace `SUPABASE_SERVICE_ROLE_KEY=...`
3. **Restart backend** → `npm run start:dev`
4. **Try again** → Click "Add Admin" button
5. **Should work!** → ✅ Admin created successfully

---

## ✅ Verification

After restarting backend, you should see in the terminal:
```
📝 [Bootstrap] Service Role Key: ✓ Set
✅ [AppService] Initializing Supabase admin client
   URL: https://bxayczllpdhrvutubzbg.supabase.co
   Service Role Key: eyJhbGc...shc
```

If you see `✓ Set`, the key is loaded! Then try creating admin.

---

## 🆘 Still Getting Error?

### Check 1: Is the new key in the file?
```bash
cat backend/.env | grep SUPABASE_SERVICE_ROLE_KEY
```

You should see: `SUPABASE_SERVICE_ROLE_KEY=eyJ...`

### Check 2: Did you restart?
- Stop backend (Ctrl+C)
- Run: `npm run start:dev`
- Check logs appear

### Check 3: Is it the SERVICE_ROLE key?
- NOT the ANON key (won't work)
- NOT some random string (invalid)
- Should start with `eyJ` (JWT format)

### Check 4: No special characters?
- Make sure key is copied exactly
- No spaces before or after
- On a single line

---

## 📞 Diagnostic Commands

**Check if key is loaded:**
```bash
cd backend
npm run start:dev 2>&1 | grep "Service Role Key"
```

**Check key format:**
```bash
cd backend
node -e "require('dotenv').config(); const k = process.env.SUPABASE_SERVICE_ROLE_KEY; console.log('Format:', k && k.startsWith('eyJ') ? 'Valid JWT' : 'Invalid');"
```

**Get key info:**
```bash
cd backend
node scripts/fix-service-key.js
```

---

## 🎯 Summary

| Item | Status |
|------|--------|
| Problem identified | ✅ Invalid service role key |
| Error handling improved | ✅ Better logs now |
| Guide created | ✅ GET_SERVICE_ROLE_KEY.md |
| Your action needed | ⏳ Get new key from Supabase |
| Backend restart needed | ⏳ After updating .env |

---

**👉 START HERE**: [GET_SERVICE_ROLE_KEY.md](GET_SERVICE_ROLE_KEY.md)

Then come back and try admin creation! 🚀
